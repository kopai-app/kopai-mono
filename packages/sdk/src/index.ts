// Client
export { KopaiClient } from "./client.js";

// Types
export type {
  KopaiClientOptions,
  RequestOptions,
  SearchResult,
  TracesDataFilter,
  LogsDataFilter,
  MetricsDataFilter,
  OtelTracesRow,
  OtelLogsRow,
  OtelMetricsRow,
  MetricsDiscoveryResult,
  DiscoveredMetric,
  DiscoveredMetricAttributes,
  Dashboard,
  CreateDashboardParams,
  SearchDashboardsFilter,
  TraceSummariesFilter,
  TraceSummaryRow,
} from "./types.js";

// Errors
export {
  KopaiError,
  KopaiNetworkError,
  KopaiTimeoutError,
  KopaiValidationError,
} from "./errors.js";
