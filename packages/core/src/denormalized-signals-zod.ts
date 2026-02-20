import { z } from "zod";

type AttributeValue =
  | string
  | number
  | boolean
  | AttributeValue[]
  | { [key: string]: AttributeValue };

const attributeValue: z.ZodType<AttributeValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(attributeValue),
    z.record(z.string(), attributeValue),
  ])
);

export const otelTracesSchema = z.object({
  // Required fields
  SpanId: z
    .string()
    .describe(
      "Unique identifier for a span within a trace. The ID is an 8-byte array."
    ),
  Timestamp: z
    .string()
    .describe(
      "Start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON."
    ),
  TraceId: z
    .string()
    .describe(
      "Unique identifier for a trace. All spans from the same trace share the same trace_id. The ID is a 16-byte array."
    ),

  // Optional fields (Generated<T> in source)
  Duration: z
    .string()
    .optional()
    .describe(
      "Duration of the span in nanoseconds (end_time - start_time). Expressed as string in JSON."
    ),
  "Events.Attributes": z
    .array(z.record(z.string(), attributeValue))
    .optional()
    .describe("Attribute key/value pairs on the event (one object per event)."),
  "Events.Name": z
    .array(z.string())
    .optional()
    .describe("Name of the event. Semantically required to be non-empty."),
  "Events.Timestamp": z
    .array(z.string())
    .optional()
    .describe(
      "Time the event occurred (nanoseconds). Expressed as strings in JSON."
    ),
  "Links.Attributes": z
    .array(z.record(z.string(), attributeValue))
    .optional()
    .describe("Attribute key/value pairs on the link (one object per link)."),
  "Links.SpanId": z
    .array(z.string())
    .optional()
    .describe(
      "Unique identifier for the linked span. The ID is an 8-byte array."
    ),
  "Links.TraceId": z
    .array(z.string())
    .optional()
    .describe(
      "Unique identifier of a trace that the linked span is part of. The ID is a 16-byte array."
    ),
  "Links.TraceState": z
    .array(z.string())
    .optional()
    .describe("The trace_state associated with the link."),
  ParentSpanId: z
    .string()
    .optional()
    .describe(
      "The span_id of this span's parent span. Empty if this is a root span."
    ),
  ResourceAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Attributes that describe the resource."),
  ScopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),
  ScopeVersion: z
    .string()
    .optional()
    .describe("Version of the instrumentation scope."),
  ServiceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  SpanAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Key/value pairs describing the span."),
  SpanKind: z
    .string()
    .optional()
    .describe(
      "Type of span (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER). Used to identify relationships between spans."
    ),
  SpanName: z
    .string()
    .optional()
    .describe(
      "Description of the span's operation. E.g., qualified method name or file name with line number."
    ),
  StatusCode: z.string().optional().describe("Status code (UNSET, OK, ERROR)."),
  StatusMessage: z
    .string()
    .optional()
    .describe("Developer-facing human readable error message."),
  TraceState: z
    .string()
    .optional()
    .describe(
      "Conveys information about request position in multiple distributed tracing graphs. W3C trace-context format."
    ),
});

export type OtelTracesRow = z.infer<typeof otelTracesSchema>;

export const otelLogsSchema = z.object({
  // Required fields
  Timestamp: z
    .string()
    .describe(
      "Time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON."
    ),

  // Optional fields (Generated<T> in source)
  Body: z
    .string()
    .optional()
    .describe(
      "Body of the log record. Can be a human-readable string message or structured data."
    ),
  LogAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe(
      "Additional attributes that describe the specific event occurrence."
    ),
  ResourceAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Attributes that describe the resource."),
  ResourceSchemaUrl: z
    .string()
    .optional()
    .describe("Schema URL for the resource data."),
  ScopeAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Attributes of the instrumentation scope."),
  ScopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),
  ScopeSchemaUrl: z
    .string()
    .optional()
    .describe("Schema URL for the scope data."),
  ScopeVersion: z
    .string()
    .optional()
    .describe("Version of the instrumentation scope."),
  ServiceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  SeverityNumber: z
    .number()
    .optional()
    .describe(
      "Numerical value of the severity, normalized to values described in Log Data Model."
    ),
  SeverityText: z
    .string()
    .optional()
    .describe(
      "Severity text (also known as log level). Original string representation as known at the source."
    ),
  SpanId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a span within a trace. The ID is an 8-byte array."
    ),
  TraceFlags: z
    .number()
    .optional()
    .describe(
      "Bit field. 8 least significant bits are trace flags as defined in W3C Trace Context."
    ),
  TraceId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a trace. All logs from the same trace share the same trace_id. The ID is a 16-byte array."
    ),
});

export type OtelLogsRow = z.infer<typeof otelLogsSchema>;

// Metrics - common fields shared by all metric types
const metricsBaseSchema = z.object({
  TimeUnix: z
    .string()
    .describe(
      "Time when the data point was recorded. UNIX Epoch time in nanoseconds. Expressed as string in JSON."
    ),
  StartTimeUnix: z
    .string()
    .describe(
      "Start time for cumulative/delta metrics. UNIX Epoch time in nanoseconds. Expressed as string in JSON."
    ),
  Attributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Key/value pairs that uniquely identify the timeseries."),
  MetricName: z.string().optional().describe("The name of the metric."),
  MetricDescription: z
    .string()
    .optional()
    .describe(
      "A description of the metric, which can be used in documentation."
    ),
  MetricUnit: z
    .string()
    .optional()
    .describe("The unit in which the metric value is reported (UCUM format)."),
  ResourceAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Attributes that describe the resource."),
  ResourceSchemaUrl: z
    .string()
    .optional()
    .describe("Schema URL for the resource data."),
  ScopeAttributes: z
    .record(z.string(), attributeValue)
    .optional()
    .describe("Attributes of the instrumentation scope."),
  ScopeDroppedAttrCount: z
    .number()
    .optional()
    .describe("Number of attributes dropped from the scope."),
  ScopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),
  ScopeSchemaUrl: z
    .string()
    .optional()
    .describe("Schema URL for the scope data."),
  ScopeVersion: z
    .string()
    .optional()
    .describe("Version of the instrumentation scope."),
  ServiceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  "Exemplars.FilteredAttributes": z
    .array(z.record(z.string(), attributeValue))
    .optional()
    .describe("Filtered attributes of exemplars."),
  "Exemplars.SpanId": z
    .array(z.string())
    .optional()
    .describe("Span IDs associated with exemplars."),
  "Exemplars.TimeUnix": z
    .array(z.string())
    .optional()
    .describe(
      "Timestamps of exemplars (nanoseconds). Expressed as strings in JSON."
    ),
  "Exemplars.TraceId": z
    .array(z.string())
    .optional()
    .describe("Trace IDs associated with exemplars."),
  "Exemplars.Value": z
    .array(z.number())
    .optional()
    .describe("Values of exemplars."),
});

export const otelGaugeSchema = metricsBaseSchema.extend({
  MetricType: z.literal("Gauge").describe("Gauge metric type."),
  Value: z.number().describe("Current scalar value."),
  Flags: z
    .number()
    .optional()
    .describe("Flags that apply to this data point (see DataPointFlags)."),
});

export const otelSumSchema = metricsBaseSchema.extend({
  MetricType: z.literal("Sum").describe("Sum metric type."),
  Value: z.number().describe("Scalar sum value."),
  Flags: z
    .number()
    .optional()
    .describe("Flags that apply to this data point (see DataPointFlags)."),
  AggTemporality: z
    .string()
    .optional()
    .describe("Aggregation temporality (DELTA or CUMULATIVE)."),
  IsMonotonic: z
    .number()
    .optional()
    .describe("Whether the sum is monotonic (0 = false, 1 = true)."),
});

export const otelHistogramSchema = metricsBaseSchema.extend({
  MetricType: z.literal("Histogram").describe("Histogram metric type."),
  Count: z.number().optional().describe("Number of values in the histogram."),
  Sum: z.number().optional().describe("Sum of all values."),
  Min: z.number().nullable().optional().describe("Minimum value recorded."),
  Max: z.number().nullable().optional().describe("Maximum value recorded."),
  BucketCounts: z
    .array(z.number())
    .optional()
    .describe("Count of values in each bucket."),
  ExplicitBounds: z.array(z.number()).optional().describe("Bucket boundaries."),
  AggTemporality: z
    .string()
    .optional()
    .describe("Aggregation temporality (DELTA or CUMULATIVE)."),
});

export const otelExponentialHistogramSchema = metricsBaseSchema.extend({
  MetricType: z
    .literal("ExponentialHistogram")
    .describe("Exponential histogram metric type."),
  Count: z.number().optional().describe("Number of values in the histogram."),
  Sum: z.number().optional().describe("Sum of all values."),
  Min: z.number().nullable().optional().describe("Minimum value recorded."),
  Max: z.number().nullable().optional().describe("Maximum value recorded."),
  Scale: z
    .number()
    .optional()
    .describe("Resolution of the histogram. Boundaries are at powers of base."),
  ZeroCount: z
    .number()
    .optional()
    .describe("Count of values that are exactly zero."),
  PositiveBucketCounts: z
    .array(z.number())
    .optional()
    .describe("Counts for positive value buckets."),
  PositiveOffset: z
    .number()
    .optional()
    .describe("Offset for positive bucket indices."),
  NegativeBucketCounts: z
    .array(z.number())
    .optional()
    .describe("Counts for negative value buckets."),
  NegativeOffset: z
    .number()
    .optional()
    .describe("Offset for negative bucket indices."),
  ZeroThreshold: z
    .number()
    .optional()
    .describe(
      "Width of the zero region. Values within [-ZeroThreshold, ZeroThreshold] go to the zero count bucket."
    ),
  AggTemporality: z
    .string()
    .optional()
    .describe("Aggregation temporality (DELTA or CUMULATIVE)."),
});

export const otelSummarySchema = metricsBaseSchema.extend({
  MetricType: z.literal("Summary").describe("Summary metric type."),
  Count: z.number().optional().describe("Number of values in the summary."),
  Sum: z.number().optional().describe("Sum of all values."),
  "ValueAtQuantiles.Quantile": z
    .array(z.number())
    .optional()
    .describe("Quantile values (0.0 to 1.0)."),
  "ValueAtQuantiles.Value": z
    .array(z.number())
    .optional()
    .describe("Values at each quantile."),
});

export const otelMetricsSchema = z.discriminatedUnion("MetricType", [
  otelGaugeSchema,
  otelSumSchema,
  otelHistogramSchema,
  otelExponentialHistogramSchema,
  otelSummarySchema,
]);

export type OtelGaugeRow = z.infer<typeof otelGaugeSchema>;
export type OtelSumRow = z.infer<typeof otelSumSchema>;
export type OtelHistogramRow = z.infer<typeof otelHistogramSchema>;
export type OtelExponentialHistogramRow = z.infer<
  typeof otelExponentialHistogramSchema
>;
export type OtelSummaryRow = z.infer<typeof otelSummarySchema>;
export type OtelMetricsRow = z.infer<typeof otelMetricsSchema>;
