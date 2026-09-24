import { kopaiQuery, kopaiQueryCompiler, type datasource } from "@kopai/core";

import {
  DISCOVERY_SIZE_REMEDIES,
  LIMITS,
  MAX_RESULT_CHARACTERS,
  overflowRemedies,
  SIZE_REMEDIES,
} from "./limits.js";
import {
  errorResult,
  okResult,
  prefixIssuePaths,
  type ToolResult,
} from "./results.js";
import type { ToolCallOutcome, ToolLogger } from "./types.js";

export interface ToolContext {
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  /** Whatever the host application attached to the request; passed through. */
  requestContext?: unknown;
  /** Where an upstream failure is written. See {@link fromThrown}. */
  logger?: ToolLogger;
}

/**
 * A completed tool run. The outcome is returned rather than inferred from the
 * result so that the observer and any counter read the same value the caller
 * sees, with no second classification step to drift.
 */
export interface ToolRun {
  result: ToolResult;
  outcome: ToolCallOutcome;
  rowCount?: number;
}

function invalidInput(
  message: string,
  issues?: { path: string; message: string }[]
): ToolRun {
  return {
    result: errorResult({ error: "invalid_input", message, issues }),
    outcome: "invalid_input",
  };
}

function tooLarge(message: string, remedies: readonly string[]): ToolRun {
  return {
    result: errorResult({
      error: "result_too_large",
      message,
      remedies: [...remedies],
    }),
    outcome: "result_too_large",
  };
}

/**
 * Maps a thrown error onto an outcome, mirroring the REST error handler:
 * a recognised validation error surfaces its own message, and anything
 * unrecognised surfaces a generic string with the detail written to the log.
 *
 * WHY the log matters as much as the result: "The query could not be
 * completed." is the whole of what a model can act on, and it is also the
 * whole of what anyone got. A datasource that was refusing connections
 * produced that one string for the caller and not a line for whoever runs the
 * server — in a product whose purpose is making failures visible. The REST
 * side has always logged this class of error (`error-handler.ts`); this is the
 * same thing at the other entry point.
 *
 * A validation error is not logged: it is the caller's mistake, it is reported
 * back in full, and logging every malformed query would bury the outages.
 */
export function fromThrown(error: unknown, logger?: ToolLogger): ToolRun {
  if (error instanceof kopaiQueryCompiler.KopaiQueryValidationError) {
    return invalidInput(error.message);
  }
  logger?.error(error, "MCP tool call failed");
  return {
    result: errorResult({
      error: "upstream_error",
      message: "The query could not be completed.",
    }),
    outcome: "upstream_error",
  };
}

/**
 * The branch a query was judged against, when the pair selects one.
 *
 * WHY the message names it: the issues name fields, and the six shapes share
 * field names — `measures` is on three of them, `filters` on all six. A caller
 * told only `query.measures.0.column` does not know which shape its query was
 * read as, and the `signal`/`mode` pair that decides that is the one thing it
 * can get wrong without any issue pointing at it. Where the pair itself is
 * wrong there is no branch to name, and the issues on `signal` and `mode` say
 * so instead.
 */
function branchOf(query: unknown): string | undefined {
  const { signal, mode } = (query ?? {}) as {
    signal?: unknown;
    mode?: unknown;
  };
  return kopaiQuery.isSignal(signal) && kopaiQuery.isQueryMode(mode)
    ? `${signal}/${mode}`
    : undefined;
}

/** Rows in a payload, for the observer. Aggregate and raw both key on `data`. */
function rowsOf(payload: unknown): number | undefined {
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? data.length : undefined;
}

export async function runQueryTool(
  input: unknown,
  ctx: ToolContext
): Promise<ToolRun> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalidInput("Expected an object with a `query` property.", [
      { path: "query", message: "Expected a query object." },
    ]);
  }

  // `query` is the only argument, and the handler reads nothing else, so an
  // extra key would be dropped without a word. The slip that produces one is
  // writing a query field at the top level — `limit` beside `query` rather
  // than inside it — and dropping that ran a different query than the caller
  // described and then answered `ok`. The pass-through validator means no
  // layer above this one will catch it either.
  const extraArgs = Object.keys(input as Record<string, unknown>).filter(
    (key) => key !== "query"
  );
  if (extraArgs.length > 0) {
    return invalidInput(
      `${extraArgs.map((key) => `\`${key}\``).join(", ")} ${
        extraArgs.length > 1 ? "are not arguments" : "is not an argument"
      } of this tool. \`query\` is the only one.`,
      extraArgs.map((key) => ({
        path: key,
        message: `Unknown argument. If it is a query field, it belongs at \`query.${key}\`.`,
      }))
    );
  }

  const query_ = (input as { query?: unknown }).query;
  const parsed = kopaiQueryCompiler.parseKopaiQuery(query_);
  if (!parsed.ok) {
    const branch = branchOf(query_);
    return invalidInput(
      branch ? `The ${branch} query is not valid.` : "The query is not valid.",
      prefixIssuePaths(parsed.issues)
    );
  }

  const query = parsed.data;
  const { fallback, max } = LIMITS[query.mode];

  // Rejected, never clamped: a caller that asked for 500 raw rows and
  // silently received 200 would read the result as complete.
  if (query.limit !== undefined && query.limit > max) {
    return invalidInput(
      `\`limit\` must be at most ${max} in ${query.mode} mode.`,
      [
        {
          path: "query.limit",
          message: `Expected at most ${max}, received ${query.limit}.`,
        },
      ]
    );
  }

  const limit = query.limit ?? fallback;

  // Aggregate runs one row over the cap so that an overflow is detectable.
  // Raw does not need this: the backend already fetches limit + 1 and reports
  // the remainder as `nextCursor`, so a truncated raw result is both visible
  // and resumable.
  const isAggregate = query.mode === "aggregate";
  const probeLimit = isAggregate ? limit + 1 : limit;

  let payload: unknown;
  try {
    payload = await ctx.readTelemetryDatasource.query({
      ...query,
      limit: probeLimit,
      requestContext: ctx.requestContext,
    } as kopaiQuery.KopaiQuery & { requestContext?: unknown });
  } catch (error) {
    return fromThrown(error, ctx.logger);
  }

  if (isAggregate) {
    const rows = (payload as { data?: unknown[] }).data ?? [];
    if (rows.length > limit) {
      // An aggregate that overruns its cap is refused outright, with no rows,
      // whether or not it carries an `orderBy`.
      //
      // WHY refuse rather than truncate, even when an ordering makes the
      // truncation well defined: a live page cannot act on a remedy. Its query
      // was fixed when the page was authored and its viewer did not write it,
      // so a partial result would simply be drawn as though it were the whole
      // set — the top N groups rendered as if they were all the groups.
      // ADR-059 requires a page to show an explicit "outgrew its query" state
      // and never draw a partial chart, and refusing is what makes that hold
      // without every page having to check a flag it may not know about.
      //
      // Without an ordering it would be worse still: the aggregate compiler
      // emits no ORDER BY when `orderBy` is absent, so a LIMIT drops an
      // arbitrary subset — and for a time series, whose rows are groups times
      // buckets, that is a scatter of (group, bucket) pairs that reads as real
      // data. `bucket_start` cannot rescue it either: it is a computed SELECT
      // alias, neither a dimension nor a measure, so a time series cannot be
      // sorted by time at all.
      return tooLarge(
        `The query returned more than the ${limit} rows it asked for.`,
        overflowRemedies(query, limit, max)
      );
    }
  }

  // Measured after serialization, on one copy: the result carries the same
  // JSON twice, but a client forwards one channel or the other.
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_RESULT_CHARACTERS) {
    return tooLarge(
      `The result serialized to ${serialized.length.toLocaleString("en-US")} characters, above the ${MAX_RESULT_CHARACTERS.toLocaleString("en-US")} the host will accept.`,
      SIZE_REMEDIES
    );
  }

  return {
    result: okResult(payload),
    outcome: "ok",
    rowCount: rowsOf(payload),
  };
}

/** A metric with its attribute values dropped, keys kept. */
interface MetricWithAttributeKeys {
  name: string;
  type: string;
  unit?: string;
  description?: string;
  attributeKeys: string[];
  resourceAttributeKeys: string[];
}

/** A metric stripped to what cannot be guessed or derived. */
type MetricIdentityOnly = Omit<
  MetricWithAttributeKeys,
  "attributeKeys" | "resourceAttributeKeys"
>;

function identityOf(metric: datasource.DiscoveredMetric): MetricIdentityOnly {
  const { name, type, unit, description } = metric;
  return {
    name,
    type,
    ...(unit === undefined ? {} : { unit }),
    ...(description === undefined ? {} : { description }),
  };
}

/**
 * The discovery listing, given up a piece at a time until it fits.
 *
 * WHY degrade rather than refuse: `metrics_discover` takes no arguments, so a
 * caller handed `result_too_large` has nothing to change and no way to learn a
 * metric name — which the `query` tool's own description tells them to do
 * first. The values seen on each attribute are the bulk of the document and
 * the metric names are the part that cannot be guessed, so they are given up in
 * that order, and the response says which step was taken rather than leaving a
 * thinner answer to pass as the whole one.
 */
function degradations(
  full: datasource.MetricsDiscoveryResult
): { payload: Record<string, unknown>; omitted?: string }[] {
  return [
    { payload: { ...full } },
    {
      omitted: "attributeValues",
      payload: {
        metrics: full.metrics.map((metric): MetricWithAttributeKeys => ({
          ...identityOf(metric),
          attributeKeys: Object.keys(metric.attributes?.values ?? {}),
          resourceAttributeKeys: Object.keys(
            metric.resourceAttributes?.values ?? {}
          ),
        })),
        omitted: "attributeValues",
        note: "The full listing was above the size limit, so the values seen on each attribute were dropped. The attribute keys are complete; query a metric grouped by a key to see its values.",
      },
    },
    {
      omitted: "attributes",
      payload: {
        metrics: full.metrics.map(identityOf),
        omitted: "attributes",
        note: "The listing was above the size limit even without attribute values, so the attributes were dropped too. Every metric present is named; query one to see its attributes.",
      },
    },
  ];
}

export async function runMetricsDiscoverTool(
  ctx: ToolContext
): Promise<ToolRun> {
  let full: datasource.MetricsDiscoveryResult;
  try {
    full = await ctx.readTelemetryDatasource.discoverMetrics({
      requestContext: ctx.requestContext,
    });
  } catch (error) {
    return fromThrown(error, ctx.logger);
  }

  // Serialization is outside the try: a payload this cannot stringify is not an
  // upstream failure, and reporting it as one blamed the datasource for a bug
  // here.
  let serialized = "";
  for (const stage of degradations(full)) {
    serialized = JSON.stringify(stage.payload);
    if (serialized.length <= MAX_RESULT_CHARACTERS) {
      return {
        result: okResult(stage.payload),
        outcome: "ok",
        rowCount: full.metrics.length,
      };
    }
  }

  return tooLarge(
    `The listing of ${full.metrics.length.toLocaleString("en-US")} metrics serialized to ${serialized.length.toLocaleString("en-US")} characters even without their attributes, above the ${MAX_RESULT_CHARACTERS.toLocaleString("en-US")} the host will accept.`,
    DISCOVERY_SIZE_REMEDIES
  );
}
