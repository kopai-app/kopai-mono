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
});

export type TracesDataFilter = z.infer<typeof tracesDataFilterSchema>;
