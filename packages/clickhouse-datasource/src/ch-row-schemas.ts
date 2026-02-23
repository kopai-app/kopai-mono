import z from "zod";
import type { denormalizedSignals } from "@kopai/core";
import { dateTime64ToNanos } from "./timestamp.js";
import { coerceAttributes, coerceAttributesArray } from "./attributes.js";
import { ClickHouseDatasourceParseError } from "./clickhouse-datasource-error.js";

// ---------------------------------------------------------------------------
// ClickHouse-specific row schemas.
//
// These parse ClickHouse's wire format and transform it into the canonical
// @kopai/core types. They can't reuse the core zod schemas because the raw
// shapes differ:
//   - Timestamps arrive as DateTime64 strings, not nanos
//   - Attributes are flat Record<string, string>, not rich AttributeValue maps
//   - UInt64/Int64 values arrive as strings, not numbers
//
// The _Check* type assertions at the bottom ensure these schemas' output types
// stay in sync with the core types at compile time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Number coercion helpers (CH returns UInt64/Int64 as strings)
// ---------------------------------------------------------------------------

/** @internal */
export function toNumber(
  value: string | number | boolean | null | undefined
): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (value === "") return undefined;
  const n = Number(value);
  if (isFinite(n)) return n;
  return undefined;
}

/** @internal Convert Array(UInt64) which may come as string[] to number[] */
export function toNumberArray(
  value: (string | number)[]
): number[] | undefined {
  if (value.length === 0) return undefined;
  const nums = value
    .map((v) => toNumber(v))
    .filter((n): n is number => n !== undefined);
  return nums.length > 0 ? nums : undefined;
}

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

const chTimestamp = z.string().transform(dateTime64ToNanos);

const chOptionalString = z
  .string()
  .transform((v) => (v === "" ? undefined : v));

const chAttributes = z
  .record(z.string(), z.string())
  .transform(coerceAttributes);

const chAttributesArray = z
  .array(z.record(z.string(), z.string()))
  .transform(coerceAttributesArray);

const chOptionalTimestampArray = z
  .array(z.string())
  .transform((arr) =>
    arr.length === 0 ? undefined : arr.map(dateTime64ToNanos)
  );

const chOptionalStringArray = z
  .array(z.string())
  .transform((arr) => (arr.length === 0 ? undefined : arr));

const chNumber = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])
  .transform(toNumber);

const chNumberArray = z
  .array(z.union([z.string(), z.number()]))
  .transform(toNumberArray);

const AGG_TEMPORALITY_MAP: Record<number, string> = {
  0: "AGGREGATION_TEMPORALITY_UNSPECIFIED",
  1: "AGGREGATION_TEMPORALITY_DELTA",
  2: "AGGREGATION_TEMPORALITY_CUMULATIVE",
};

const chAggTemporality = z
  .union([z.number(), z.null(), z.undefined()])
  .transform((v) => (v != null ? AGG_TEMPORALITY_MAP[v] : undefined));

// ---------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------

export const chTracesRowSchema = z.object({
  TraceId: z.string(),
  SpanId: z.string(),
  Timestamp: chTimestamp,
  ParentSpanId: chOptionalString,
  TraceState: chOptionalString,
  SpanName: z.string().optional(),
  SpanKind: chOptionalString,
  ServiceName: z.string().optional(),
  ResourceAttributes: chAttributes,
  ScopeName: z.string().optional(),
  ScopeVersion: chOptionalString,
  SpanAttributes: chAttributes,
  Duration: z
    .unknown()
    .transform((v) => (v != null ? String(v) : undefined))
    .optional(),
  StatusCode: chOptionalString,
  StatusMessage: chOptionalString,
  "Events.Timestamp": chOptionalTimestampArray.optional(),
  "Events.Name": chOptionalStringArray.optional(),
  "Events.Attributes": chAttributesArray.optional(),
  "Links.TraceId": chOptionalStringArray.optional(),
  "Links.SpanId": chOptionalStringArray.optional(),
  "Links.TraceState": chOptionalStringArray.optional(),
  "Links.Attributes": chAttributesArray.optional(),
});

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export const chLogsRowSchema = z.object({
  Timestamp: chTimestamp,
  TraceId: chOptionalString,
  SpanId: chOptionalString,
  TraceFlags: chNumber,
  SeverityText: chOptionalString,
  SeverityNumber: chNumber,
  Body: z.string().optional(),
  LogAttributes: chAttributes,
  ResourceAttributes: chAttributes,
  ResourceSchemaUrl: chOptionalString,
  ServiceName: z.string().optional(),
  ScopeName: chOptionalString,
  ScopeVersion: chOptionalString,
  ScopeAttributes: chAttributes,
  ScopeSchemaUrl: chOptionalString,
});

// ---------------------------------------------------------------------------
// Metrics (shared base)
// ---------------------------------------------------------------------------

const chMetricsBase = z.object({
  TimeUnix: chTimestamp,
  StartTimeUnix: chTimestamp,
  Attributes: chAttributes,
  MetricName: z.string().optional(),
  MetricDescription: chOptionalString,
  MetricUnit: chOptionalString,
  ResourceAttributes: chAttributes,
  ResourceSchemaUrl: chOptionalString,
  ScopeAttributes: chAttributes,
  ScopeDroppedAttrCount: chNumber,
  ScopeName: chOptionalString,
  ScopeSchemaUrl: chOptionalString,
  ScopeVersion: chOptionalString,
  ServiceName: z.string().optional(),
  "Exemplars.FilteredAttributes": chAttributesArray.optional(),
  "Exemplars.SpanId": chOptionalStringArray.optional(),
  "Exemplars.TimeUnix": chOptionalTimestampArray.optional(),
  "Exemplars.TraceId": chOptionalStringArray.optional(),
  "Exemplars.Value": chNumberArray.optional(),
});

export const chGaugeRowSchema = chMetricsBase.extend({
  MetricType: z.literal("Gauge").default("Gauge"),
  Value: z.number(),
  Flags: chNumber,
});

export const chSumRowSchema = chMetricsBase
  .extend({
    MetricType: z.literal("Sum").default("Sum"),
    Value: z.number(),
    Flags: chNumber,
    AggregationTemporality: chAggTemporality,
    IsMonotonic: chNumber,
  })
  .transform(({ AggregationTemporality, ...rest }) => ({
    ...rest,
    AggTemporality: AggregationTemporality,
  }));

export const chHistogramRowSchema = chMetricsBase
  .extend({
    MetricType: z.literal("Histogram").default("Histogram"),
    Count: chNumber,
    Sum: z.number().optional(),
    Min: z.number().nullable().optional(),
    Max: z.number().nullable().optional(),
    BucketCounts: chNumberArray,
    ExplicitBounds: chNumberArray.optional(),
    AggregationTemporality: chAggTemporality,
  })
  .transform(({ AggregationTemporality, ...rest }) => ({
    ...rest,
    AggTemporality: AggregationTemporality,
  }));

export const chExpHistogramRowSchema = chMetricsBase
  .extend({
    MetricType: z
      .literal("ExponentialHistogram")
      .default("ExponentialHistogram"),
    Count: chNumber,
    Sum: z.number().optional(),
    Min: z.number().nullable().optional(),
    Max: z.number().nullable().optional(),
    Scale: chNumber,
    ZeroCount: chNumber,
    PositiveOffset: chNumber,
    PositiveBucketCounts: chNumberArray,
    NegativeOffset: chNumber,
    NegativeBucketCounts: chNumberArray,
    AggregationTemporality: chAggTemporality,
  })
  .transform(({ AggregationTemporality, ...rest }) => ({
    ...rest,
    ZeroThreshold: undefined as number | undefined,
    AggTemporality: AggregationTemporality,
  }));

export const chSummaryRowSchema = chMetricsBase.extend({
  MetricType: z.literal("Summary").default("Summary"),
  Count: chNumber,
  Sum: z.number().optional(),
  "ValueAtQuantiles.Quantile": chNumberArray.optional(),
  "ValueAtQuantiles.Value": chNumberArray.optional(),
});

// ---------------------------------------------------------------------------
// Discover queries
// ---------------------------------------------------------------------------

export const chDiscoverNameRowSchema = z.object({
  MetricName: z.string(),
  MetricType: z.enum([
    "Gauge",
    "Sum",
    "Histogram",
    "ExponentialHistogram",
    "Summary",
  ]),
  MetricDescription: z.string(),
  MetricUnit: z.string(),
});

export const chDiscoverAttrRowSchema = z.object({
  MetricName: z.string(),
  MetricType: z.string(),
  source: z.string(),
  attr_key: z.string(),
  attr_values: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Schema lookup by metric type
// ---------------------------------------------------------------------------

export const metricSchemaMap = {
  Gauge: chGaugeRowSchema,
  Sum: chSumRowSchema,
  Histogram: chHistogramRowSchema,
  ExponentialHistogram: chExpHistogramRowSchema,
  Summary: chSummaryRowSchema,
} as const;

// ---------------------------------------------------------------------------
// Compile-time: assert schema outputs match core types.
// Assert<Expect<A,B>> errors when A and B aren't mutually assignable.
// ---------------------------------------------------------------------------

type Expect<A, B> = A extends B ? (B extends A ? true : never) : never;
type Assert<T extends true> = T;

/* eslint-disable @typescript-eslint/no-unused-vars */
type _CheckTraces = Assert<
  Expect<z.output<typeof chTracesRowSchema>, denormalizedSignals.OtelTracesRow>
>;
type _CheckLogs = Assert<
  Expect<z.output<typeof chLogsRowSchema>, denormalizedSignals.OtelLogsRow>
>;
type _CheckGauge = Assert<
  Expect<z.output<typeof chGaugeRowSchema>, denormalizedSignals.OtelGaugeRow>
>;
type _CheckSum = Assert<
  Expect<z.output<typeof chSumRowSchema>, denormalizedSignals.OtelSumRow>
>;
type _CheckHistogram = Assert<
  Expect<
    z.output<typeof chHistogramRowSchema>,
    denormalizedSignals.OtelHistogramRow
  >
>;
type _CheckExpHistogram = Assert<
  Expect<
    z.output<typeof chExpHistogramRowSchema>,
    denormalizedSignals.OtelExponentialHistogramRow
  >
>;
type _CheckSummary = Assert<
  Expect<
    z.output<typeof chSummaryRowSchema>,
    denormalizedSignals.OtelSummaryRow
  >
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

export function parseChRow<S extends z.ZodType>(
  schema: S,
  raw: unknown
): z.output<S> {
  try {
    return schema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new ClickHouseDatasourceParseError(
        `Failed to parse ClickHouse row: ${e.message}`,
        { cause: e }
      );
    }
    throw e;
  }
}
