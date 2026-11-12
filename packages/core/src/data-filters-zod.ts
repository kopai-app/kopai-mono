import z from "zod";

/**
 * String containing a non-negative integer expressed in nanoseconds.
 *
 * Validated as a digit-only string so the API rejects malformed input
 * (e.g. ISO date strings like "2026-04-10T14:53:58.818Z") with a 400
 * validation error instead of crashing inside BigInt() with a 500.
 */
const nanosStringSchema = z
  .string()
  .regex(/^\d+$/, "Expected nanoseconds as a digit-only string");

export const tracesDataFilterSchema = z.object({
  // Exact match filters
  traceId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a trace. All spans from the same trace share the same trace_id. The ID is a 16-byte array."
    ),
  spanId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a span within a trace. The ID is an 8-byte array."
    ),
  parentSpanId: z
    .string()
    .optional()
    .describe(
      "The span_id of this span's parent span. Empty if this is a root span."
    ),
  serviceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  spanName: z
    .string()
    .optional()
    .describe(
      "Description of the span's operation. E.g., qualified method name or file name with line number."
    ),
  spanKind: z
    .string()
    .optional()
    .describe(
      "Type of span (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER). Used to identify relationships between spans."
    ),
  statusCode: z.string().optional().describe("Status code (UNSET, OK, ERROR)."),
  scopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),

  // Time range filters
  timestampMin: nanosStringSchema
    .optional()
    .describe(
      "Minimum start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON. If neither timestampMin nor timestampMax is set, the search covers the last 24 hours (unless traceId is set); if only timestampMax is set, the 24 hours before it, or before now if it is later."
    ),
  timestampMax: nanosStringSchema
    .optional()
    .describe(
      "Maximum start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON."
    ),

  // Duration range filters
  durationMin: nanosStringSchema
    .optional()
    .describe(
      "Minimum duration of the span in nanoseconds (end_time - start_time). Expressed as string in JSON."
    ),
  durationMax: nanosStringSchema
    .optional()
    .describe(
      "Maximum duration of the span in nanoseconds (end_time - start_time). Expressed as string in JSON."
    ),

  // Attribute filters
  spanAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Key/value pairs describing the span."),
  resourceAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes that describe the resource."),
  eventsAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attribute key/value pairs on the event."),
  linksAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attribute key/value pairs on the link."),

  // Pagination
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Max items to return. Default determined by datasource."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from previous response for next page."),
  sortOrder: z
    .enum(["ASC", "DESC"])
    .optional()
    .describe("Sort by timestamp. ASC = oldest first, DESC = newest first."),
});

export type TracesDataFilter = z.infer<typeof tracesDataFilterSchema>;

export const logsDataFilterSchema = z.object({
  // Exact match filters
  traceId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a trace. All logs from the same trace share the same trace_id. The ID is a 16-byte array."
    ),
  spanId: z
    .string()
    .optional()
    .describe(
      "Unique identifier for a span within a trace. The ID is an 8-byte array."
    ),
  serviceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  scopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),
  eventName: z
    .string()
    .optional()
    .describe(
      "A unique identifier of event category/type. Filters logs that are events with this name."
    ),
  severityText: z
    .string()
    .optional()
    .describe(
      "Severity text (also known as log level). Original string representation as known at the source."
    ),
  severityNumberMin: z
    .number()
    .optional()
    .describe(
      "Minimum severity number (inclusive). Normalized to values described in Log Data Model."
    ),
  severityNumberMax: z
    .number()
    .optional()
    .describe(
      "Maximum severity number (inclusive). Normalized to values described in Log Data Model."
    ),
  bodyContains: z
    .string()
    .optional()
    .describe("Filter logs where body contains this substring."),

  // Time range filters
  timestampMin: nanosStringSchema
    .optional()
    .describe(
      "Minimum time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON. If neither timestampMin nor timestampMax is set, the search covers the last 24 hours (unless traceId is set); if only timestampMax is set, the 24 hours before it, or before now if it is later."
    ),
  timestampMax: nanosStringSchema
    .optional()
    .describe(
      "Maximum time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970. Expressed as string in JSON."
    ),

  // Attribute filters
  logAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Additional attributes that describe the specific event occurrence."
    ),
  resourceAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes that describe the resource."),
  scopeAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes of the instrumentation scope."),

  // Pagination
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Max items to return. Default determined by datasource."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from previous response for next page."),
  sortOrder: z
    .enum(["ASC", "DESC"])
    .optional()
    .describe("Sort by timestamp. ASC = oldest first, DESC = newest first."),
});

export type LogsDataFilter = z.infer<typeof logsDataFilterSchema>;

const metricsDataFilterBaseSchema = z.object({
  metricType: z
    .enum(["Gauge", "Sum", "Histogram", "ExponentialHistogram", "Summary"])
    .describe("Metric type to query."),

  // Exact match filters
  metricName: z.string().optional().describe("The name of the metric."),
  serviceName: z
    .string()
    .optional()
    .describe("Service name from resource attributes (service.name)."),
  scopeName: z
    .string()
    .optional()
    .describe("Name denoting the instrumentation scope."),

  // Time range filters
  timeUnixMin: nanosStringSchema
    .optional()
    .describe(
      "Minimum time when the data point was recorded. UNIX Epoch time in nanoseconds. Expressed as string in JSON."
    ),
  timeUnixMax: nanosStringSchema
    .optional()
    .describe(
      "Maximum time when the data point was recorded. UNIX Epoch time in nanoseconds. Expressed as string in JSON."
    ),

  // Attribute filters
  attributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Key/value pairs that uniquely identify the timeseries."),
  resourceAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes that describe the resource."),
  scopeAttributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes of the instrumentation scope."),

  // Aggregation
  aggregate: z
    .enum(["sum", "avg", "min", "max", "count"])
    .optional()
    .describe(
      "Aggregation function to apply to metric values. When set, returns aggregated results instead of raw data points."
    ),
  groupBy: z
    .array(z.string())
    .optional()
    .describe(
      "Attribute keys to group by when aggregating (e.g. ['tenant.id', 'signal'])."
    ),

  // Pagination
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe("Max items to return. Default determined by datasource."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque cursor from previous response for next page."),
  sortOrder: z
    .enum(["ASC", "DESC"])
    .optional()
    .describe("Sort by timestamp. ASC = oldest first, DESC = newest first."),
});

export const metricsDataFilterSchema = metricsDataFilterBaseSchema
  .refine((data) => !(data.groupBy && !data.aggregate), {
    message: "groupBy requires aggregate to be set",
    path: ["groupBy"],
  })
  .refine((data) => !(data.aggregate && data.cursor), {
    message: "cursor is incompatible with aggregate",
    path: ["cursor"],
  })
  .refine(
    (data) =>
      !data.aggregate ||
      data.metricType === "Gauge" ||
      data.metricType === "Sum",
    {
      message: "aggregate is only supported for Gauge and Sum metric types",
      path: ["aggregate"],
    }
  );

// Inferred from base schema (not refined) so downstream code sees aggregate/groupBy fields.
// Runtime validation (groupBy requires aggregate, cursor incompatible with aggregate)
// is enforced by metricsDataFilterSchema's .refine() calls.
export type MetricsDataFilter = z.infer<typeof metricsDataFilterBaseSchema>;

// --- Trace summaries (Jaeger-like search) ---

export const traceSummariesFilterSchema = z.object({
  serviceName: z.string().optional(),
  spanName: z.string().optional(),
  timestampMin: nanosStringSchema
    .optional()
    .describe(
      "Start of the time range to search. UNIX Epoch time in nanoseconds, as a string. If neither timestampMin nor timestampMax is set, the search covers the last 24 hours; if only timestampMax is set, the 24 hours before it, or before now if it is later."
    ),
  timestampMax: nanosStringSchema
    .optional()
    .describe(
      "End of the time range to search. UNIX Epoch time in nanoseconds, as a string."
    ),
  durationMin: nanosStringSchema.optional(),
  durationMax: nanosStringSchema.optional(),
  spanAttributes: z.record(z.string(), z.string()).optional(),
  resourceAttributes: z.record(z.string(), z.string()).optional(),
  limit: z.number().int().min(1).max(1000).default(20),
  cursor: z.string().optional(),
  sortOrder: z.enum(["ASC", "DESC"]).default("DESC"),
});

export type TraceSummariesFilter = z.input<typeof traceSummariesFilterSchema>;

export const traceSummaryServiceSchema = z.object({
  name: z.string(),
  count: z.number(),
  hasError: z.boolean(),
});

export const traceSummaryRowSchema = z.object({
  traceId: z.string(),
  rootServiceName: z.string(),
  rootSpanName: z.string(),
  startTimeNs: z.string(),
  durationNs: z.string(),
  spanCount: z.number(),
  errorCount: z.number(),
  services: z.array(traceSummaryServiceSchema),
});

export type TraceSummaryRow = z.infer<typeof traceSummaryRowSchema>;

// --- Default time window ---

/** Window a search covers when the request gives no time range: 24 hours. */
export const DEFAULT_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TIME_WINDOW_NS = BigInt(DEFAULT_TIME_WINDOW_MS) * 1_000_000n;

/**
 * Bounds a search that gives no start time, so it never scans a workspace's
 * whole history (KOP-216).
 *
 * - No `timestampMin` and no `timestampMax`: the last 24 hours.
 * - Only `timestampMax`: the 24 hours before it, or before now if it is later.
 * - An ascending page with a cursor: from 24 hours before the cursor. The
 *   window is recomputed per request, and a start that moved past the cursor
 *   would skip the rows between pages; starting a day early also keeps whole
 *   a trace that began just before the cursor.
 * - `timestampMin` given, or a lookup by a non-empty `traceId`: unchanged.
 *
 * Every datasource applies this default to span search, log search and trace
 * summaries. A client that pages through a fixed window should send
 * `timestampMin`.
 */
export function withDefaultTimeWindow<
  T extends {
    timestampMin?: string;
    timestampMax?: string;
    traceId?: string;
    cursor?: string;
    sortOrder?: "ASC" | "DESC";
  },
>(filter: T, nowMs: number = Date.now()): T {
  // An empty traceId adds no predicate in any datasource, so it is no lookup.
  if (filter.timestampMin != null || filter.traceId) return filter;
  let anchor = BigInt(nowMs) * 1_000_000n;
  if (filter.timestampMax != null) {
    const max = BigInt(filter.timestampMax);
    if (max < anchor) anchor = max;
  }
  if (filter.sortOrder === "ASC") {
    const cursorTs = cursorTimestamp(filter.cursor);
    if (cursorTs != null && cursorTs < anchor) anchor = cursorTs;
  }
  const start =
    anchor > DEFAULT_TIME_WINDOW_NS ? anchor - DEFAULT_TIME_WINDOW_NS : 0n;
  return { ...filter, timestampMin: String(start) };
}

/** Timestamp of a `{nanoseconds}:{id}` page cursor, as every datasource writes it. */
function cursorTimestamp(cursor: string | undefined): bigint | undefined {
  const match = cursor ? /^(\d+):/.exec(cursor) : null;
  return match?.[1] != null ? BigInt(match[1]) : undefined;
}
