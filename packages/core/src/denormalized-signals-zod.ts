import { z } from "zod";

export const otelTracesSchema = z.object({
  // Required fields
  SpanId: z
    .string()
    .describe(
      "Unique identifier for a span within a trace. The ID is an 8-byte array."
    ),
  Timestamp: z
    .number()
    .describe(
      "Start time of the span. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
    ),
  TraceId: z
    .string()
    .describe(
      "Unique identifier for a trace. All spans from the same trace share the same trace_id. The ID is a 16-byte array."
    ),

  // Optional fields (Generated<T> in source)
  Duration: z
    .number()
    .optional()
    .describe("Duration of the span in nanoseconds (end_time - start_time)."),
  "Events.Attributes": z
    .record(z.string(), z.string())
    .optional()
    .describe("Attribute key/value pairs on the event."),
  "Events.Name": z
    .string()
    .optional()
    .describe("Name of the event. Semantically required to be non-empty."),
  "Events.Timestamp": z
    .string()
    .optional()
    .describe("Time the event occurred."),
  "Links.Attributes": z
    .record(z.string(), z.string())
    .optional()
    .describe("Attribute key/value pairs on the link."),
  "Links.SpanId": z
    .string()
    .optional()
    .describe(
      "Unique identifier for the linked span. The ID is an 8-byte array."
    ),
  "Links.TraceId": z
    .string()
    .optional()
    .describe(
      "Unique identifier of a trace that the linked span is part of. The ID is a 16-byte array."
    ),
  "Links.TraceState": z
    .string()
    .optional()
    .describe("The trace_state associated with the link."),
  ParentSpanId: z
    .string()
    .optional()
    .describe(
      "The span_id of this span's parent span. Empty if this is a root span."
    ),
  ResourceAttributes: z
    .record(z.string(), z.string())
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
    .record(z.string(), z.string())
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
