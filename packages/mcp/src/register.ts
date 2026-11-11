import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";

import {
  isResourceLimitError,
  LIMITS,
  MAX_RESULT_CHARACTERS,
  RESOURCE_LIMIT_REMEDIES,
} from "./limits.js";
import {
  METRICS_DISCOVER_TOOL_INPUT_SCHEMA,
  QUERY_TOOL_INPUT_SCHEMA,
} from "./schema.js";
import { errorResult, type ToolResult } from "./results.js";
import {
  fromThrown,
  runMetricsDiscoverTool,
  runQueryTool,
  tooExpensive,
  type ToolContext,
} from "./tools.js";
import {
  TOOL_CALL_OUTCOMES,
  type ToolCallOutcome,
  type ToolLogger,
} from "./types.js";
import { passThroughValidator } from "./validator.js";

/**
 * Both tools read and never write, always return the same answer for the same
 * arguments and window, and reach nothing outside this deployment.
 *
 * Each tool repeats its `title` inside `annotations`: the 2025-03-26 spec has
 * no top-level tool `title`, so clients and checks built on it (including the
 * Claude connector directory check) read it only from there.
 */
const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Descriptions are deliberately flat: what the tool does, the shape of its
 * input, and the limits. They carry no instructions aimed at the model —
 * these strings are read by Directory review, and a tool description is not a
 * place to steer behaviour.
 */
const QUERY_DESCRIPTION = [
  "Query this workspace's OpenTelemetry traces, logs and metrics.",
  "Takes one KopaiQuery object under `query`, keyed on `signal` (traces, logs, metrics) and `mode` (raw, aggregate); the rest of the shape follows from that pair.",
  `Row caps are ${LIMITS.raw.max} in raw mode and ${LIMITS.aggregate.max} in aggregate mode, and a result above ${MAX_RESULT_CHARACTERS.toLocaleString("en-US")} characters is refused rather than truncated.`,
  "Aggregate is the compact shape; raw returns whole records and is for inspecting individual spans, logs or data points.",
  // What decides whether a query fits. Stated here because the cost is a
  // product of two fields, and a field-level description can only speak for
  // one of them.
  "An aggregate returns one row per distinct grouping, multiplied by the number of time buckets when `output` is a time series; that product is what the row cap applies to, not the number of records scanned.",
  "Ranking over time takes two calls: a `summary` ordered by the measure to find the top groups, then a `timeSeries` filtered to those groups with `in`. One query cannot do both, because the ordering that picks them and the bucketing that draws them compete for the same `limit`.",
  "For metrics, `metrics_discover` lists each metric's attribute keys and the values seen on them, which is how to judge a grouping column's cardinality before querying.",
].join(" ");

const METRICS_DISCOVER_DESCRIPTION = [
  "List the metrics present in this workspace, with each metric's type, unit, description and the attribute keys and values seen on it.",
  "Takes no arguments.",
  // Stated because the tool promises attribute values above, and a caller that
  // gets a response without them is owed the reason in the description as well
  // as in the response.
  `A listing above ${MAX_RESULT_CHARACTERS.toLocaleString("en-US")} characters is returned without its attribute values, or without its attributes, and the response names what was omitted.`,
].join(" ");

/** The tools this package registers itself. A host tool may not reuse them. */
export const BUILT_IN_TOOL_NAMES = ["query", "metrics_discover"] as const;

export interface RegisterToolsOptions extends ToolContext {
  /**
   * Called once per completed tool call, after the result is built and before
   * it is returned.
   */
  onToolCall?: (event: {
    tool: string;
    outcome: ToolCallOutcome;
    durationMs: number;
    rowCount?: number;
  }) => void;
}

/** A completed run of any tool, built-in or host. */
interface Run<R> {
  result: R;
  outcome: ToolCallOutcome;
  rowCount?: number;
}

/**
 * Returns the function that runs one tool call and reports it, whatever
 * happens. Shared by the built-in and the host tools, so every tool on the
 * server reaches `onToolCall` through this one place.
 *
 * WHY the catch: a throw out of a tool used to skip `observe` altogether, so
 * the host's counter lost exactly the calls most worth seeing — and the SDK
 * turned it into a bare message with no `structuredContent`, which is the
 * one error shape a page cannot read. Nothing in the tools is expected to
 * throw; that is the reason to handle it here rather than to assume it, and
 * converting it gives an unexpected failure the same contract as an expected
 * one: a structured payload, a logged cause, and one observer event.
 */
function observedCall(opts: RegisterToolsOptions) {
  const observe = (
    tool: string,
    startedAt: number,
    outcome: ToolCallOutcome,
    rowCount?: number
  ): void => {
    if (!opts.onToolCall) return;
    // Guarded: an observer that throws is the host application's problem and
    // must not turn a successful query into a failed tool call.
    try {
      opts.onToolCall({
        tool,
        outcome,
        durationMs: Date.now() - startedAt,
        ...(rowCount !== undefined ? { rowCount } : {}),
      });
    } catch {
      // deliberately swallowed
    }
  };

  return async <R>(
    tool: string,
    execute: () => Promise<Run<R>>
  ): Promise<R | ToolResult> => {
    const startedAt = Date.now();
    let run: Run<R | ToolResult>;
    try {
      run = await execute();
    } catch (error) {
      run = fromThrown(error, opts.logger);
    }
    observe(tool, startedAt, run.outcome, run.rowCount);
    return run.result;
  };
}

/**
 * Registers the `query` and `metrics_discover` tools on `server`.
 *
 * Every call reports to `opts.onToolCall` exactly once, including a call whose
 * tool throws, which is returned as a structured error rather than rethrown.
 */
export function registerTools(
  server: McpServer,
  opts: RegisterToolsOptions
): void {
  const call = observedCall(opts);

  server.registerTool(
    "query",
    {
      title: "Query telemetry",
      description: QUERY_DESCRIPTION,
      inputSchema: fromJsonSchema(
        QUERY_TOOL_INPUT_SCHEMA,
        passThroughValidator
      ),
      annotations: { ...READ_ONLY, title: "Query telemetry" },
    },
    async (input: unknown) =>
      call<ToolResult>("query", () => runQueryTool(input, opts))
  );

  server.registerTool(
    "metrics_discover",
    {
      title: "Discover metrics",
      description: METRICS_DISCOVER_DESCRIPTION,
      inputSchema: fromJsonSchema(
        METRICS_DISCOVER_TOOL_INPUT_SCHEMA,
        passThroughValidator
      ),
      annotations: { ...READ_ONLY, title: "Discover metrics" },
    },
    async () =>
      call<ToolResult>("metrics_discover", () => runMetricsDiscoverTool(opts))
  );
}

const ERROR_CODES: ReadonlySet<string> = new Set(
  TOOL_CALL_OUTCOMES.filter((outcome) => outcome !== "ok")
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads a host tool's outcome from the result it returned.
 *
 * WHY reading is safe here, when `ToolRun` returns the outcome rather than
 * inferring it: `errorResult` is the one builder of an error result, and it
 * always writes the code. A hand-built error result has no code to read; it
 * is counted as `upstream_error`, the same label an unexpected throw gets, and
 * logged so the tool can be fixed. It is not thrown: the caller already has
 * an answer, and the tool's own text is more use to it than ours.
 */
function hostOutcome(
  tool: string,
  result: unknown,
  logger: ToolLogger | undefined
): ToolCallOutcome {
  if (!isRecord(result) || result.isError !== true) return "ok";
  const code = isRecord(result.structuredContent)
    ? result.structuredContent.error
    : undefined;
  if (typeof code === "string" && ERROR_CODES.has(code)) {
    return code as ToolCallOutcome;
  }
  logger?.error(
    { tool },
    "MCP host tool returned an error result without a known error code"
  );
  return "upstream_error";
}

/**
 * A host tool's throw, converted as `fromThrown` converts a built-in's, with
 * two differences: the generic message names no query, since a host tool need
 * not run one, and the log line names the tool.
 *
 * A resource limit is classified here too: a host tool that reads telemetry
 * (a backtest, say) lets its query's throw through, and would otherwise
 * report a limit the caller can get past as a generic failure.
 */
function thrownByHostTool(
  tool: string,
  error: unknown,
  logger: ToolLogger | undefined
): Run<ToolResult> {
  logger?.error(error, `MCP host tool "${tool}" failed`);
  if (isResourceLimitError(error)) {
    return tooExpensive(
      "The query behind this tool call was stopped at this deployment's limit on query time, memory or rows read.",
      RESOURCE_LIMIT_REMEDIES
    );
  }
  return {
    result: errorResult({
      error: "upstream_error",
      message: "The tool call could not be completed.",
    }),
    outcome: "upstream_error",
  };
}

type HostCallback = (...args: unknown[]) => unknown;

export interface RegisterHostToolsOptions extends RegisterToolsOptions {
  /** Every name `register` may use; checked at plugin registration. */
  names: ReadonlySet<string>;
  register: (server: McpServer) => void;
}

/**
 * Runs the host's `register` on `server`, with `registerTool` guarded and
 * observed.
 *
 * The guard is installed on this one per-request instance, through the SDK's
 * public API only. It refuses a name not in `names`, so the check made at
 * boot cannot be bypassed through `registerTool` or `update` — a host that
 * reaches past them, by writing `handle.executor` or calling the prototype's
 * `registerTool`, is not guarded, and is not meant to be. It wraps the
 * returned handle's `update` as well: `update({ name })` renames a registered tool, and `update({ callback
 * })` swaps its callback, either of which would otherwise slip past the guard.
 * `remove()` is `update({ name: null })` in the SDK and passes.
 *
 * A refusal throws, and so does anything else `register` throws. Both fail the
 * request; see {@link HostTools}.
 */
export function registerHostTools(
  server: McpServer,
  opts: RegisterHostToolsOptions
): void {
  const call = observedCall(opts);
  const assertDeclared = (name: string): void => {
    if (opts.names.has(name)) return;
    const declared = [...opts.names].map((n) => `"${n}"`).join(", ");
    throw new TypeError(
      `Host tool "${name}" is not in hostTools.names (${declared || "none declared"}). Declare every name register may use.`
    );
  };

  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    callback: HostCallback
  ) => ReturnType<McpServer["registerTool"]>;

  // Every observed wrapper, mapped to the host callback it wraps; read by the
  // `handler` accessor below.
  const wrapped = new WeakMap<HostCallback, HostCallback>();

  // Names in use on this server. The SDK refuses to register a name twice,
  // but a rename onto a name in use silently replaces that tool — a tool
  // missing because of a bug, which is what failing the request is for.
  const inUse = new Set<string>();

  const guarded = (name: string, config: unknown, callback: HostCallback) => {
    assertDeclared(name);
    // WHY: the SDK checks an output schema after the callback returns, so a
    // mismatch is counted `ok` while the caller receives the SDK's own bare
    // error, which breaks the error contract for that tool.
    const refuseOutputSchema = (value: unknown, tool: string): void => {
      if (value === undefined) return;
      throw new TypeError(
        `Host tool "${tool}" declares an outputSchema; host tools may not.`
      );
    };
    refuseOutputSchema(
      isRecord(config) ? config.outputSchema : undefined,
      name
    );
    let current = name;
    const observed = (inner: HostCallback): HostCallback => {
      const outer: HostCallback = (...args) =>
        call(current, async () => {
          let result: unknown;
          try {
            result = await inner(...args);
          } catch (error) {
            return thrownByHostTool(current, error, opts.logger);
          }
          return {
            result,
            outcome: hostOutcome(current, result, opts.logger),
          };
        });
      wrapped.set(outer, inner);
      return outer;
    };

    const handle = registerTool(name, config, observed(callback));
    inUse.add(name);

    // WHY an accessor: the SDK keeps the callback it was given on the public
    // `handler` field, which here is the wrapper. A host decorating its tool
    // with `update({ callback: withAudit(handle.handler) })` would wrap the
    // wrapper, and every call would be counted twice. The host reads back its
    // own callback instead; the SDK's write in `update` is mapped the same
    // way. The SDK calls through its own closure, never through this field.
    let raw: unknown = callback;
    Object.defineProperty(handle, "handler", {
      get: () => raw,
      set: (value: HostCallback) => {
        raw = wrapped.get(value) ?? value;
      },
      enumerable: true,
      configurable: true,
    });
    const update = handle.update;
    handle.update = (updates) => {
      refuseOutputSchema(updates.outputSchema, current);
      const renamed =
        updates.name !== undefined && updates.name !== current
          ? updates.name
          : undefined;
      if (typeof renamed === "string") {
        assertDeclared(renamed);
        if (inUse.has(renamed)) {
          throw new TypeError(
            `Host tool "${current}" cannot be renamed to "${renamed}", which is already registered.`
          );
        }
      }
      update(
        updates.callback === undefined
          ? updates
          : {
              ...updates,
              callback: observed(
                updates.callback as HostCallback
              ) as typeof updates.callback,
            }
      );
      if (renamed !== undefined) {
        inUse.delete(current);
        // `null` is the SDK's `remove()`.
        if (renamed !== null) {
          inUse.add(renamed);
          current = renamed;
        }
      }
    };
    return handle;
  };
  server.registerTool = guarded as McpServer["registerTool"];

  // Typed `void`, but an `async` function satisfies that type. Its promise
  // would be dropped: whatever it registers after an `await` is never
  // listed, and a rejection goes unhandled.
  const returned: unknown = opts.register(server);
  if (returned instanceof Promise) {
    returned.catch(() => {});
    throw new TypeError(
      "hostTools.register returned a promise; it must be synchronous. Do the I/O in a preHandler and read its result from the request."
    );
  }
}
