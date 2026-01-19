export const name = "@kopai/core";

export type {
  WriteMetricsDatasource,
  TelemetryDatasource,
  MetricsData,
  MetricsPartialSuccess,
} from "./telemetry-datasource.js";
export * as otlpZod from "./otlp-zod.js";
export * as otlpMetricsZod from "./otlp-metrics-zod.js";
