// https://github.com/open-telemetry/opentelemetry-proto/blob/main/docs/specification.md#otlphttp-response

import { z } from "zod/v4";
export const grpcStatusCode = {
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
} as const;

export const grpcStatusSchema = z.object({
  message: z.string(),
  details: z.array(z.unknown()).optional(),
});

export const grpcStatusCodeSchema = z.number().int().min(0).max(16);

export type GrpcStatusCode =
  (typeof grpcStatusCode)[keyof typeof grpcStatusCode];

// Error response body for HTTP 4xx/5xx
export const otlpErrorResponseSchema = z.object({
  code: grpcStatusCodeSchema,
  // The Status.message field SHOULD contain a developer-facing error message as defined in Status message schema.
  message: z.string(),
  // The server MAY include Status.details field with additional details. Read below about what this field can contain in each specific failure case.
  details: z.array(z.unknown()).optional(),
});

export type ErrorResponse = z.infer<typeof otlpErrorResponseSchema>;

// Single field violation
export const fieldViolationSchema = z.object({
  field: z.string(), // path like "resourceSpans[0].spans[2].traceId"
  description: z.string(), // human-readable explanation
  reason: z.string().optional(), // e.g. "INVALID_TRACE_ID"
});

export type FieldViolation = z.infer<typeof fieldViolationSchema>;

// BadRequest detail
export const badRequestSchema = z.object({
  "@type": z.literal("type.googleapis.com/google.rpc.BadRequest").optional(),
  fieldViolations: z.array(fieldViolationSchema),
});

/*
 * Full error response for HTTP 400
 *
 * example:
 *
 * {
 *   "code": 3,
 *   "message": "invalid trace data",
 *   "details": [
 *     {
 *       "@type": "type.googleapis.com/google.rpc.BadRequest",
 *       "fieldViolations": [
 *         {
 *           "field": "resourceSpans[0].scopeSpans[0].spans[0].traceId",
 *           "description": "traceId must be 32 hex characters",
 *           "reason": "INVALID_TRACE_ID"
 *         },
 *         {
 *           "field": "resourceSpans[0].scopeSpans[0].spans[1].startTimeUnixNano",
 *           "description": "startTimeUnixNano must be a positive integer",
 *           "reason": "INVALID_TIMESTAMP"
 *         }
 *       ]
 *     }
 *   ]
 * }
 */
export const otlpBadRequestErrorResponseSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  details: z.array(badRequestSchema).optional(),
});

export type OtlpBadRequestErrorResponse = z.infer<
  typeof otlpBadRequestErrorResponseSchema
>;
