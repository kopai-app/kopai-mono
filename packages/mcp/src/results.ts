import type { ToolCallOutcome } from "./types.js";

/** An error code a tool can return. `ok` is not one of them. */
export type ToolErrorCode = Exclude<ToolCallOutcome, "ok">;

export interface ToolIssue {
  path: string;
  message: string;
}

export interface ToolErrorPayload {
  error: ToolErrorCode;
  message: string;
  issues?: ToolIssue[];
  remedies?: string[];
}

/**
 * The shape both tools return. Deliberately not the MCP SDK's own result type
 * — this stays a plain object so it can be asserted on in tests without a
 * server.
 */
export type ToolResult = {
  structuredContent: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

/**
 * Builds a result carrying `payload` in BOTH channels — as
 * `structuredContent`, and as a single text block holding exactly
 * `JSON.stringify` of the same object.
 *
 * WHY both, when the specification suggests one: the two consumers read
 * different channels and neither reads both. A live page reads
 * `structuredContent` through the artifact runtime's `payload` convenience. A
 * conversational agent reads `content` — Anthropic's own MCP helper returns
 * `result.content.map(...)` and discards `structuredContent` entirely whenever
 * `content` is non-empty, falling back to the structured value only when
 * `content` is empty. So rows in `structuredContent` plus a prose summary in
 * the text block is the one combination that fails: the fallback never fires,
 * and the agent receives the summary and none of the rows, with no error
 * raised anywhere.
 *
 * Sending both costs wire bytes only, never context: a client forwards one
 * channel or the other, so the model ingests the payload once. The text block
 * stays pure JSON so that the "first text block parsed as JSON" path a page
 * may fall back to remains valid.
 */
export function okResult(payload: unknown): ToolResult {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

/**
 * Builds a failed result. Same duplication as {@link okResult}, and more
 * load-bearing here: the empty-content fallback to the structured value sits
 * below the `isError` branch in the agent's helper, so it never fires on a
 * failure. A structured-only success degrades; a structured-only error
 * vanishes, leaving the agent an empty error and nothing to repair from.
 *
 * `error` is written first so the serialized JSON opens with the code.
 */
export function errorResult(payload: ToolErrorPayload): ToolResult {
  // Rebuilt key by key rather than spread, because the key order is the
  // contract: `error` must serialize first.
  const ordered: ToolErrorPayload = {
    error: payload.error,
    message: payload.message,
  };
  if (payload.issues !== undefined) ordered.issues = payload.issues;
  if (payload.remedies !== undefined) ordered.remedies = payload.remedies;

  return {
    structuredContent: ordered,
    content: [{ type: "text", text: JSON.stringify(ordered) }],
    isError: true,
  };
}

/**
 * Re-points issue paths from `@kopai/core`'s query-relative form onto the
 * tool's input, whose single property is `query`. The empty root path becomes
 * `query` rather than `query.`.
 */
export function prefixIssuePaths(issues: ToolIssue[]): ToolIssue[] {
  return issues.map(({ path, message }) => ({
    path: path === "" ? "query" : `query.${path}`,
    message,
  }));
}
