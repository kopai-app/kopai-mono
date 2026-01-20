import {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
  type FastifySchemaValidationError,
} from "fastify";

import {
  type OtlpBadRequestErrorResponse,
  grpcStatusCode,
  type FieldViolation,
  type ErrorResponse,
} from "./otlp-schemas.js";

import { CollectorError } from "./errors.js";

export function collectorErrorHandler(
  error: FastifyError | Error | string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (isValidationError(error)) {
    return reply.status(400).send({
      code: grpcStatusCode.INVALID_ARGUMENT,
      message: "Invalid data",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: error.validation.map(toFieldViolation),
        },
      ],
    } satisfies OtlpBadRequestErrorResponse);
  }

  request.log.error(error);
  if (error instanceof CollectorError) {
    return reply.status(500).send({
      code: error.code,
      message: error.message,
    } satisfies ErrorResponse);
  }

  reply.status(500).send({ error: "Internal Server Error" });
}

function isFastifyError(error: unknown): error is FastifyError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as FastifyError).code === "string"
  );
}

// Type guard for validation error
function isValidationError(
  error: unknown
): error is FastifyError & Required<Pick<FastifyError, "validation">> {
  return (
    isFastifyError(error) &&
    "validation" in error &&
    Array.isArray((error as FastifyError).validation)
  );
}

function toFieldViolation(error: FastifySchemaValidationError): FieldViolation {
  const field =
    error.keyword === "required"
      ? ((error.params as { missingProperty?: string }).missingProperty ??
        error.instancePath)
      : // Converts instancePath from /path/to/field → path.to.field
        error.instancePath.replace(/^\//, "").replace(/\//g, ".");

  return {
    field: field || "unknown",
    description: error.message ?? "Validation failed",
    reason: error.keyword,
  };
}
