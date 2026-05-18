/**
 * Public entry barrel for the type-safe query SDK.
 */
export {
  type ColumnRef,
  type Kind,
  type TracesColumnName,
  type LogsColumnName,
  type MetricsColumnName,
  tracesColumns,
  logsColumns,
  gaugeColumns,
  sumColumns,
  histogramColumns,
  exponentialHistogramColumns,
  summaryColumns,
} from "./columns.js";

export { type AggExpr, tracesAgg, logsAgg, metricsAgg } from "./aggs.js";

export {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  in_,
  notIn,
  isNull,
  isNotNull,
  and,
  or,
  not,
} from "./operators.js";

export {
  QueryBuilder,
  type InferRow,
  type HasAgg,
  traces,
  logs,
  metrics,
} from "./builder.js";
