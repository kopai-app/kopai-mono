import type { MetricsData } from "./otlp-generated.js";
export type { MetricsData } from "./otlp-metrics-generated.js";

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

export type TelemetryDatasource = WriteMetricsDatasource; // & WriteTraceDatasource & ReadTracesDatasource ...
