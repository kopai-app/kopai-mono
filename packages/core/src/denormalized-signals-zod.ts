import { z } from "zod";

const attributeValue = z.union([z.string(), z.number(), z.boolean()]);

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
    .array(z.record(z.string(), attributeValue))
    .optional()
    .describe("Attribute key/value pairs on the event (one object per event)."),
  "Events.Name": z
    .array(z.string())
    .optional()
    .describe("Name of the event. Semantically required to be non-empty."),
  "Events.Timestamp": z
    .array(z.number())
    .optional()
    .describe("Time the event occurred."),
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
    .number()
    .describe(
      "Time when the event occurred. UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970."
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
