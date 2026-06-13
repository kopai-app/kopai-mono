/**
 * KopaiQuery schema for the metrics signal.
 *
 * Metrics queries are discriminated by `metricType`: each metric type
 * (Gauge / Sum / Histogram / ExponentialHistogram / Summary) carries a
 * different column set, so we expose per-type column-name schemas and
 * pick the right one inside the per-type query schema.
 *
 * Column names are camelCased variants of the corresponding
 * `otel<Type>Schema` fields. The `metricType` literal itself uses lower
 * camel case (`'gauge'`, not `'Gauge'`) — distinct from the
 * server-internal otel discriminator.
 *
 * Aggregation-fn enum is metrics-specific: no count / countDistinct
 * (cardinality of timeseries is not the right primitive); includes
 * heatmap and rate*.
 */
import { z } from "zod";
import { kopaiQueryBaseSchema, refineKopaiQuery } from "./kopai-query-zod.js";

/**
 * Metric type discriminator (lower camel case, distinct from the
 * server-internal otel discriminator which is PascalCase).
 */
export const metricsTypeSchema = z
  .enum(["gauge", "sum", "histogram", "exponentialHistogram", "summary"])
  .describe(
    "Metric type discriminator for a metrics KopaiQuery. Lower-camel-case form of the otel MetricType field."
  );

export type MetricsType = z.infer<typeof metricsTypeSchema>;

/**
 * Common columns present on every metric type (camelCased variants of
 * the fields on `metricsBaseSchema` in `denormalized-signals-zod.ts`).
 */
const metricsBaseColumnNames = [
  "timeUnix",
  "startTimeUnix",
  "attributes",
  "metricName",
  "metricDescription",
  "metricUnit",
  "resourceAttributes",
  "resourceSchemaUrl",
  "scopeAttributes",
  "scopeDroppedAttrCount",
  "scopeName",
  "scopeSchemaUrl",
  "scopeVersion",
  "serviceName",
  "exemplarsFilteredAttributes",
  "exemplarsSpanId",
  "exemplarsTimeUnix",
  "exemplarsTraceId",
  "exemplarsValue",
  "metricType",
] as const;

/** Columns specific to Gauge metrics. */
export const gaugeColumnNameSchema = z
  .enum([...metricsBaseColumnNames, "value", "flags"])
  .describe("Column names available on Gauge metric queries.");

/** Columns specific to Sum metrics. */
export const sumColumnNameSchema = z
  .enum([
    ...metricsBaseColumnNames,
    "value",
    "flags",
    "aggregationTemporality",
    "isMonotonic",
  ])
  .describe("Column names available on Sum metric queries.");

/** Columns specific to Histogram metrics. */
export const histogramColumnNameSchema = z
  .enum([
    ...metricsBaseColumnNames,
    "count",
    "sum",
    "min",
    "max",
    "bucketCounts",
    "explicitBounds",
    "aggregationTemporality",
  ])
  .describe("Column names available on Histogram metric queries.");

/** Columns specific to ExponentialHistogram metrics. */
export const exponentialHistogramColumnNameSchema = z
  .enum([
    ...metricsBaseColumnNames,
    "count",
    "sum",
    "min",
    "max",
    "scale",
    "zeroCount",
    "positiveBucketCounts",
    "positiveOffset",
    "negativeBucketCounts",
    "negativeOffset",
    "zeroThreshold",
    "aggregationTemporality",
  ])
  .describe("Column names available on ExponentialHistogram metric queries.");

/** Columns specific to Summary metrics. */
export const summaryColumnNameSchema = z
  .enum([
    ...metricsBaseColumnNames,
    "count",
    "sum",
    "valueAtQuantilesQuantile",
    "valueAtQuantilesValue",
  ])
  .describe("Column names available on Summary metric queries.");

/**
 * Enum of aggregation functions supported by metrics queries. Excludes
 * count / countDistinct; includes heatmap and rate*.
 */
export const metricsAggFnSchema = z
  .enum([
    "sum",
    "avg",
    "min",
    "max",
    "p50",
    "p75",
    "p90",
    "p95",
    "p99",
    "p999",
    "heatmap",
    "rateAvg",
    "rateSum",
    "rateMax",
  ])
  .describe("Aggregation functions supported by metrics queries.");

export type MetricsAggFn = z.infer<typeof metricsAggFnSchema>;

const metricsAggFns: ReadonlySet<string> = new Set(metricsAggFnSchema.options);

/**
 * Build one branch of the metrics discriminated union for a given
 * `metricType` literal and column-name enum. Encapsulates the shared
 * `signal: 'metrics'` literal + the per-type `.superRefine`.
 */
function buildMetricsBranch<
  TLiteral extends MetricsType,
  TColEnum extends z.ZodEnum<Record<string, string>>,
>(metricType: TLiteral, colSchema: TColEnum, doc: string) {
  const colNames: ReadonlySet<string> = new Set(colSchema.options);
  return kopaiQueryBaseSchema
    .extend({
      signal: z
        .literal("metrics")
        .describe(
          "Signal discriminator. Always 'metrics' for metrics queries."
        ),
      metricType: z
        .literal(metricType)
        .describe(`Metric-type discriminator: ${metricType}.`),
    })
    .superRefine((data, ctx) =>
      refineKopaiQuery(
        data,
        ctx,
        (n) => colNames.has(n),
        (fn) => metricsAggFns.has(fn)
      )
    )
    .describe(doc);
}

const gaugeQuerySchema = buildMetricsBranch(
  "gauge",
  gaugeColumnNameSchema,
  "Metrics KopaiQuery branch for Gauge metric type."
);
const sumQuerySchema = buildMetricsBranch(
  "sum",
  sumColumnNameSchema,
  "Metrics KopaiQuery branch for Sum metric type."
);
const histogramQuerySchema = buildMetricsBranch(
  "histogram",
  histogramColumnNameSchema,
  "Metrics KopaiQuery branch for Histogram metric type."
);
const exponentialHistogramQuerySchema = buildMetricsBranch(
  "exponentialHistogram",
  exponentialHistogramColumnNameSchema,
  "Metrics KopaiQuery branch for ExponentialHistogram metric type."
);
const summaryQuerySchema = buildMetricsBranch(
  "summary",
  summaryColumnNameSchema,
  "Metrics KopaiQuery branch for Summary metric type."
);

/**
 * Full metrics KopaiQuery schema. Discriminated by `metricType`; each
 * branch enforces the column-name set appropriate to that type plus the
 * shared `metricsAggFnSchema` agg-fn restriction.
 */
export const metricsKopaiQuerySchema = z
  .discriminatedUnion("metricType", [
    gaugeQuerySchema,
    sumQuerySchema,
    histogramQuerySchema,
    exponentialHistogramQuerySchema,
    summaryQuerySchema,
  ])
  .describe(
    "KopaiQuery for the metrics signal, discriminated by metricType. Wire format consumed by POST /signals/metrics/query."
  );

export type MetricsKopaiQuery = z.infer<typeof metricsKopaiQuerySchema>;
