import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";

import { LIMITS, MAX_RESULT_CHARACTERS } from "./limits.js";
import {
  METRICS_DISCOVER_TOOL_INPUT_SCHEMA,
  QUERY_TOOL_INPUT_SCHEMA,
} from "./schema.js";
import {
  runMetricsDiscoverTool,
  runQueryTool,
  type ToolContext,
} from "./tools.js";
import type { ToolCallOutcome } from "./types.js";
import { passThroughValidator } from "./validator.js";

/**
 * Both tools read and never write, always return the same answer for the same
 * arguments and window, and reach nothing outside this deployment.
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
].join(" ");

const METRICS_DISCOVER_DESCRIPTION = [
  "List the metrics present in this workspace, with each metric's type, unit, description and the attribute keys and values seen on it.",
  "Takes no arguments.",
].join(" ");

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

export function registerTools(
  server: McpServer,
  opts: RegisterToolsOptions
): void {
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
        rowCount,
      });
    } catch {
      // deliberately swallowed
    }
  };

  server.registerTool(
    "query",
    {
      title: "Query telemetry",
      description: QUERY_DESCRIPTION,
      inputSchema: fromJsonSchema(
        QUERY_TOOL_INPUT_SCHEMA,
        passThroughValidator
      ),
      annotations: READ_ONLY,
    },
    async (input: unknown) => {
      const startedAt = Date.now();
      const run = await runQueryTool(input, opts);
      observe("query", startedAt, run.outcome, run.rowCount);
      return run.result;
    }
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
      annotations: READ_ONLY,
    },
    async () => {
      const startedAt = Date.now();
      const run = await runMetricsDiscoverTool(opts);
      observe("metrics_discover", startedAt, run.outcome, run.rowCount);
      return run.result;
    }
  );
}
