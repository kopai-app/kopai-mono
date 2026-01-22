import z from "zod";

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
  timestampMin: z
    .number()
    .optional()
    .describe(
      "Minimum start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
    ),
  timestampMax: z
    .number()
    .optional()
    .describe(
      "Maximum start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
    ),

  // Duration range filters
  durationMin: z
    .number()
    .optional()
    .describe(
      "Minimum duration of the span in nanoseconds (end_time - start_time)."
    ),
  durationMax: z
    .number()
    .optional()
    .describe(
      "Maximum duration of the span in nanoseconds (end_time - start_time)."
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
  timestampMin: z
    .number()
    .optional()
    .describe(
      "Minimum time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
    ),
  timestampMax: z
    .number()
    .optional()
    .describe(
      "Maximum time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
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

export const metricsDataFilterSchema = z.object({
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
  timeUnixMin: z
    .number()
    .optional()
    .describe(
      "Minimum time when the data point was recorded. UNIX Epoch time in nanoseconds."
    ),
  timeUnixMax: z
    .number()
    .optional()
    .describe(
      "Maximum time when the data point was recorded. UNIX Epoch time in nanoseconds."
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

export type MetricsDataFilter = z.infer<typeof metricsDataFilterSchema>;
