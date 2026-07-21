import type {
  logsDataFilterSchema,
  metricsDataFilterSchema,
  tracesDataFilterSchema,
  TraceSummariesFilter,
  TraceSummaryRow,
} from "./data-filters-zod.js";
import {
  otelLogsSchema,
  otelMetricsSchema,
  otelTracesSchema,
  type AggregatedMetricRow,
  type OtelLogsRow,
  type OtelMetricsRow,
  type OtelTracesRow,
} from "./denormalized-signals-zod.js";
import type {
  KopaiAggregateRow,
  KopaiQuery,
  KopaiQueryResult,
  LogAggregateQuery,
  LogRawQuery,
  MetricAggregateQuery,
  MetricRawQuery,
  TraceAggregateQuery,
  TraceRawQuery,
} from "./kopai-query.js";
import type { MetricsData, TracesData, LogsData } from "./otlp-generated.js";
export type { MetricsData } from "./otlp-metrics-generated.js";
export type { TracesData, LogsData } from "./otlp-generated.js";
import z from "zod";

/*
 * example:
 *
 * {
 * "rejectedDataPoints": "42",
 * "errorMessage": "quota exceeded for tenant abc123"
 * }
 */
export interface MetricsPartialSuccess {
  // The number of rejected data points.
  rejectedDataPoints?: string;

  // Developer-facing message explaining why/how to fix
  errorMessage?: string;
}

export interface WriteMetricsDatasource {
  writeMetrics(metricsData: MetricsData): Promise<MetricsPartialSuccess>;
}

export interface TracesPartialSuccess {
  rejectedSpans?: string;
  errorMessage?: string;
}

export interface WriteTracesDatasource {
  writeTraces(tracesData: TracesData): Promise<TracesPartialSuccess>;
}

export interface ReadTracesDatasource {
  getTraces(
    filter: z.infer<typeof tracesDataFilterSchema> & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: z.infer<typeof otelTracesSchema>[];
    nextCursor: string | null;
  }>;
}

export interface ReadLogsDatasource {
  getLogs(
    filter: z.infer<typeof logsDataFilterSchema> & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: z.infer<typeof otelLogsSchema>[];
    nextCursor: string | null;
  }>;
}

export type MetricType =
  | "Gauge"
  | "Sum"
  | "Histogram"
  | "ExponentialHistogram"
  | "Summary";

export interface DiscoveredMetricAttributes {
  values: Record<string, string[]>;
  _truncated?: boolean;
}

export interface DiscoveredMetric {
  name: string;
  type: MetricType;
  unit?: string;
  description?: string;
  attributes: DiscoveredMetricAttributes;
  resourceAttributes: DiscoveredMetricAttributes;
}

export interface MetricsDiscoveryResult {
  metrics: DiscoveredMetric[];
}

export interface ReadMetricsDatasource {
  getMetrics(
    filter: z.infer<typeof metricsDataFilterSchema> & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: z.infer<typeof otelMetricsSchema>[];
    nextCursor: string | null;
  }>;
  getAggregatedMetrics(
    filter: z.infer<typeof metricsDataFilterSchema> & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: AggregatedMetricRow[];
    nextCursor: null;
  }>;
  discoverMetrics(options?: {
    requestContext?: unknown;
  }): Promise<MetricsDiscoveryResult>;
}

export interface LogsPartialSuccess {
  rejectedLogRecords?: string;
  errorMessage?: string;
}

export interface WriteLogsDatasource {
  writeLogs(logsData: LogsData): Promise<LogsPartialSuccess>;
}

export interface ReadTracesMetaDatasource {
  getServices(opts?: {
    requestContext?: unknown;
  }): Promise<{ services: string[] }>;

  getOperations(filter: {
    serviceName: string;
    requestContext?: unknown;
  }): Promise<{ operations: string[] }>;

  getTraceSummaries(
    filter: TraceSummariesFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: TraceSummaryRow[];
    nextCursor: string | null;
  }>;
}

export interface ReadQueryDatasource {
  query<Q extends KopaiQuery>(
    q: Q & { requestContext?: unknown }
  ): Promise<KopaiQueryResult<Q>>;

  queryTracesRaw(
    q: TraceRawQuery & { requestContext?: unknown }
  ): Promise<{ data: OtelTracesRow[]; nextCursor: string | null }>;

  queryTracesAggregate(
    q: TraceAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: KopaiAggregateRow[] }>;

  queryLogsRaw(
    q: LogRawQuery & { requestContext?: unknown }
  ): Promise<{ data: OtelLogsRow[]; nextCursor: string | null }>;

  queryLogsAggregate(
    q: LogAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: KopaiAggregateRow[] }>;

  queryMetricsRaw(
    q: MetricRawQuery & { requestContext?: unknown }
  ): Promise<{ data: OtelMetricsRow[]; nextCursor: string | null }>;

  queryMetricsAggregate(
    q: MetricAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: KopaiAggregateRow[] }>;
}

export type ReadTelemetryDatasource = ReadTracesDatasource &
  ReadLogsDatasource &
  ReadMetricsDatasource &
  ReadTracesMetaDatasource &
  ReadQueryDatasource;

export type WriteTelemetryDatasource = WriteMetricsDatasource &
  WriteTracesDatasource &
  WriteLogsDatasource;

export type TelemetryDatasource = WriteTelemetryDatasource &
  ReadTelemetryDatasource;
