/**
 * SDK types - re-exports from @kopai/core and SDK-specific types.
 */
import type {
  dataFilterSchemas,
  denormalizedSignals,
  datasource,
} from "@kopai/core";

// Re-export types from @kopai/core for convenience
export type TracesDataFilter = dataFilterSchemas.TracesDataFilter;
export type LogsDataFilter = dataFilterSchemas.LogsDataFilter;
export type MetricsDataFilter = dataFilterSchemas.MetricsDataFilter;

export type OtelTracesRow = denormalizedSignals.OtelTracesRow;
export type OtelLogsRow = denormalizedSignals.OtelLogsRow;
export type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

export type MetricsDiscoveryResult = datasource.MetricsDiscoveryResult;
export type DiscoveredMetric = datasource.DiscoveredMetric;
export type DiscoveredMetricAttributes = datasource.DiscoveredMetricAttributes;

/** Options for KopaiClient constructor */
export interface KopaiClientOptions {
  /** Base URL for the Kopai API */
  baseUrl: string;
  /** Bearer token for authentication */
  token?: string;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
  /** Default timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/** Options for individual requests */
export interface RequestOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Request-specific timeout in milliseconds */
  timeout?: number;
}

/** Paginated search result */
export interface SearchResult<T> {
  /** Array of items */
  data: T[];
  /** Cursor for next page, null if no more pages */
  nextCursor: string | null;
}

/** API error response (RFC 7807 Problem Details with code extension) */
export interface ApiErrorResponse {
  type: string;
  title: string;
  code: string;
  detail?: string;
}
