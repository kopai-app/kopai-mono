import type {
  logsDataFilterSchema,
  metricsDataFilterSchema,
  tracesDataFilterSchema,
} from "./data-filters-zod.js";
import {
  otelLogsSchema,
  otelMetricsSchema,
  otelTracesSchema,
} from "./denormalized-signals-zod.js";
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
  getTraces(filter: z.infer<typeof tracesDataFilterSchema>): Promise<{
    data: z.infer<typeof otelTracesSchema>[];
    nextCursor: string | null;
  }>;
}

export interface ReadLogsDatasource {
  getLogs(filter: z.infer<typeof logsDataFilterSchema>): Promise<{
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
  getMetrics(filter: z.infer<typeof metricsDataFilterSchema>): Promise<{
    data: z.infer<typeof otelMetricsSchema>[];
    nextCursor: string | null;
  }>;
  discoverMetrics(): Promise<MetricsDiscoveryResult>;
}

export interface LogsPartialSuccess {
  rejectedLogRecords?: string;
  errorMessage?: string;
}

export interface WriteLogsDatasource {
  writeLogs(logsData: LogsData): Promise<LogsPartialSuccess>;
}

export type ReadTelemetryDatasource = ReadTracesDatasource &
  ReadLogsDatasource &
  ReadMetricsDatasource;

export type WriteTelemetryDatasource = WriteMetricsDatasource &
  WriteTracesDatasource &
  WriteLogsDatasource;

export type TelemetryDatasource = WriteTelemetryDatasource &
  ReadTelemetryDatasource;
