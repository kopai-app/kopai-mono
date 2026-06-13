export const name = "@kopai/core";

export * as datasource from "./telemetry-datasource.js";
export * as otlp from "./otlp-generated.js";
export * as otlpMetrics from "./otlp-metrics-generated.js";
export * as otlpZod from "./otlp-zod.js";
export * as otlpMetricsZod from "./otlp-metrics-zod.js";
export * as denormalizedSignals from "./denormalized-signals-zod.js";
export * as dataFilterSchemas from "./data-filters-zod.js";
export * as dashboardDatasource from "./dynamic-dashboard-datasource.js";

// KopaiQuery — type-safe query SDK wire format.
export {
  attributeMapNameSchema,
  columnRefNodeSchema,
  aggCallNodeSchema,
  exprNodeSchema,
  orderBySchema,
  timeRangeSchema,
  selectValueSchema,
  kopaiQueryBaseSchema,
  refineKopaiQuery,
  type ColumnRefNode,
  type AggCallNode,
  type ExprNode,
  type OrderBy,
  type TimeRange,
  type SelectValueNode,
} from "./kopai-query-zod.js";
export {
  tracesColumnNameSchema,
  tracesAggFnSchema,
  tracesKopaiQuerySchema,
  type TracesColumnName,
  type TracesAggFn,
  type TracesKopaiQuery,
} from "./traces-kopai-query-zod.js";
export {
  logsColumnNameSchema,
  logsAggFnSchema,
  logsKopaiQuerySchema,
  type LogsColumnName,
  type LogsAggFn,
  type LogsKopaiQuery,
} from "./logs-kopai-query-zod.js";
export {
  metricsTypeSchema,
  metricsAggFnSchema,
  metricsKopaiQuerySchema,
  gaugeColumnNameSchema,
  sumColumnNameSchema,
  histogramColumnNameSchema,
  exponentialHistogramColumnNameSchema,
  summaryColumnNameSchema,
  type MetricsType,
  type MetricsAggFn,
  type MetricsKopaiQuery,
} from "./metrics-kopai-query-zod.js";
