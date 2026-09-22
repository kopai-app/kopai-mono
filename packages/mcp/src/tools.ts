import { kopaiQuery, kopaiQueryCompiler, type datasource } from "@kopai/core";

import {
  LIMITS,
  MAX_RESULT_CHARACTERS,
  SIZE_REMEDIES,
  UNORDERED_OVERFLOW_REMEDIES,
} from "./limits.js";
import {
  errorResult,
  okResult,
  prefixIssuePaths,
  type ToolResult,
} from "./results.js";
import type { ToolCallOutcome } from "./types.js";

export interface ToolContext {
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  /** Whatever the host application attached to the request; passed through. */
  requestContext?: unknown;
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
 * unrecognised surfaces a generic string with the detail left to the log.
 */
function fromThrown(error: unknown): ToolRun {
  if (error instanceof kopaiQueryCompiler.KopaiQueryValidationError) {
    return invalidInput(error.message);
  }
  return {
    result: errorResult({
      error: "upstream_error",
      message: "The query could not be completed.",
    }),
    outcome: "upstream_error",
  };
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

  const parsed = kopaiQueryCompiler.parseKopaiQuery(
    (input as { query?: unknown }).query
  );
  if (!parsed.ok) {
    return invalidInput(
      "The query is not valid.",
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
    return fromThrown(error);
  }

  if (isAggregate) {
    const rows = (payload as { data?: unknown[] }).data ?? [];
    if (rows.length > limit) {
      // WHY an unordered overflow is refused rather than truncated: the
      // aggregate compiler emits no ORDER BY when `orderBy` is absent, so a
      // LIMIT drops an arbitrary subset. For a time series — whose rows are
      // groups times buckets — that yields a scatter of (group, bucket) pairs
      // that reads as real data and is not. `bucket_start` cannot rescue it:
      // it is a computed SELECT alias, neither a dimension nor a measure, so
      // a time series cannot be sorted by time at all.
      if (query.orderBy === undefined || query.orderBy.length === 0) {
        return tooLarge(
          `The query returned more than ${limit} rows with no \`orderBy\`, so there is no defined way to choose which to keep.`,
          UNORDERED_OVERFLOW_REMEDIES
        );
      }
      // Ordered: the caller chose which rows matter, so truncation is defined.
      payload = {
        ...(payload as Record<string, unknown>),
        data: rows.slice(0, limit),
        truncated: true,
      };
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

export async function runMetricsDiscoverTool(
  ctx: ToolContext
): Promise<ToolRun> {
  try {
    const payload = await ctx.readTelemetryDatasource.discoverMetrics({
      requestContext: ctx.requestContext,
    });
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
      rowCount: payload.metrics.length,
    };
  } catch (error) {
    return fromThrown(error);
  }
}
