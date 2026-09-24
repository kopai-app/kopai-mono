import { kopaiQuery } from "@kopai/core";
import { z } from "zod";

import { dedupe } from "./dedupe.js";
import { applyDescriptions, descriptionOverrides } from "./describe.js";
import { LIMITS } from "./limits.js";

/**
 * The `query` tool's input: the KopaiQuery body under a single `query`
 * property, because an MCP tool's input schema must have an object root and
 * KopaiQuery is a union.
 *
 * Strict, so the document says `additionalProperties: false` on the root as
 * well as on every node inside it. In `io: "input"` mode zod leaves a plain
 * `z.object` open, which advertised a tool that accepted arguments it would
 * then ignore; `runQueryTool` rejects them, and the schema now agrees.
 */
const QueryToolInput = z.strictObject({ query: kopaiQuery.KopaiQuery });

/**
 * The advertised input schema for the `query` tool, deduplicated into `$defs`.
 *
 * WHY generated here, at module scope, rather than inside the per-request
 * server factory: the transport builds a fresh server per request, and
 * generating plus deduplicating this document costs ~11 ms — around a hundred
 * times a request's own work. The document depends on nothing request-scoped,
 * so it is built once per process and shared.
 */
const OVERRIDES = descriptionOverrides(
  LIMITS.raw.max,
  LIMITS.aggregate.max,
  LIMITS.raw.fallback,
  LIMITS.aggregate.fallback
);

const described = applyDescriptions(
  z.toJSONSchema(QueryToolInput, { io: "input" }) as Record<string, unknown>,
  OVERRIDES
);

/** How many nodes each override matched. Asserted in the tests, not at runtime. */
export const DESCRIPTION_OVERRIDES_APPLIED = described.applied;

export const QUERY_TOOL_INPUT_SCHEMA: Record<string, unknown> = dedupe(
  described.document
);

/**
 * The `metrics_discover` tool takes no arguments, but MCP still requires an
 * object root.
 */
export const METRICS_DISCOVER_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {},
};
