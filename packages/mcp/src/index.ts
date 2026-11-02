export { dedupe } from "./dedupe.js";
export {
  DISCOVERY_SIZE_REMEDIES,
  LIMITS,
  MAX_RESULT_CHARACTERS,
  overflowRemedies,
  SIZE_REMEDIES,
} from "./limits.js";
export {
  BUILT_IN_TOOL_NAMES,
  registerTools,
  type RegisterToolsOptions,
} from "./register.js";
export { mcpRoutes } from "./routes.js";
export {
  errorResult,
  okResult,
  prefixIssuePaths,
  type ToolErrorCode,
  type ToolErrorPayload,
  type ToolIssue,
  type ToolResult,
} from "./results.js";
export {
  applyDescriptions,
  descriptionOverrides,
  type DescriptionOverride,
} from "./describe.js";
export {
  DESCRIPTION_OVERRIDES_APPLIED,
  METRICS_DISCOVER_TOOL_INPUT_SCHEMA,
  QUERY_TOOL_INPUT_SCHEMA,
} from "./schema.js";
export {
  runMetricsDiscoverTool,
  runQueryTool,
  type ToolContext,
  type ToolRun,
} from "./tools.js";
export {
  TOOL_CALL_OUTCOMES,
  type HostTools,
  type McpRoutesOptions,
  type ToolCallEvent,
  type ToolCallOutcome,
} from "./types.js";
// Re-exported so a host registering its own tools (`hostTools`) uses this
// package's copy of the SDK. `McpServer` has private fields, so a second copy
// is a different type from the one `register` is called with.
export { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
export { passThroughValidator } from "./validator.js";
