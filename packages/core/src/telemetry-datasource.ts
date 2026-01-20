import type { MetricsData, TracesData } from "./otlp-generated.js";
export type { MetricsData } from "./otlp-metrics-generated.js";
export type { TracesData } from "./otlp-generated.js";

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

export type TelemetryDatasource = WriteMetricsDatasource &
  WriteTracesDatasource;
