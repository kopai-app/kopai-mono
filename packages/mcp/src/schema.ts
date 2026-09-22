import { kopaiQuery } from "@kopai/core";
import { z } from "zod";

import { dedupe } from "./dedupe.js";

/**
 * The `query` tool's input: the KopaiQuery body under a single `query`
 * property, because an MCP tool's input schema must have an object root and
 * KopaiQuery is a union.
 */
const QueryToolInput = z.object({ query: kopaiQuery.KopaiQuery });

/**
 * The advertised input schema for the `query` tool, deduplicated into `$defs`.
 *
 * WHY generated here, at module scope, rather than inside the per-request
 * server factory: the transport builds a fresh server per request, and
 * generating plus deduplicating this document costs ~11 ms — around a hundred
 * times a request's own work. The document depends on nothing request-scoped,
 * so it is built once per process and shared.
 */
export const QUERY_TOOL_INPUT_SCHEMA: Record<string, unknown> = dedupe(
  z.toJSONSchema(QueryToolInput, { io: "input" }) as Record<string, unknown>
);

/**
 * The `metrics_discover` tool takes no arguments, but MCP still requires an
 * object root.
 */
export const METRICS_DISCOVER_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
};
