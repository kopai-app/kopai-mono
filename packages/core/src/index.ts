export const name = "@kopai/core";

export type {
  WriteMetricsDatasource,
  TelemetryDatasource,
  MetricsData,
  MetricsPartialSuccess,
} from "./telemetry-datasource.js";
export type {
  Resource,
  InstrumentationScope,
  KeyValue,
  AnyValue,
} from "./otlp-generated.js";
export { AggregationTemporality } from "./otlp-generated.js";
export type {
  Metric,
  NumberDataPoint,
  Exemplar,
  HistogramDataPoint,
  ExponentialHistogramDataPoint,
  SummaryDataPoint,
  SummaryDataPoint_ValueAtQuantile,
} from "./otlp-metrics-generated.js";
export * as otlpZod from "./otlp-zod.js";
export * as otlpMetricsZod from "./otlp-metrics-zod.js";
