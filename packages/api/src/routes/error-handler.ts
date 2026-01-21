import {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { SignalsApiError } from "./errors.js";
import type { SignalsApiErrorResponse } from "./error-schema-zod.js";
export function errorHandler(
  error: FastifyError | Error | string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (isValidationError(error)) {
    return reply.status(400).send({
      // https://datatracker.ietf.org/doc/html/rfc9457
      //      HTTP/1.1 422 Unprocessable Content
      //      Content-Type: application/problem+json
      //      Content-Language: en
      //
      //      {
      //       "type": "https://example.net/validation-error",
      //       "title": "Your request is not valid.",
      //       "errors": [
      //                   {
      //                     "detail": "must be a positive integer",
      //                     "pointer": "#/age"
      //                   },
      //                   {
      //                     "detail": "must be 'green', 'red' or 'blue'",
      //                     "pointer": "#/profile/color"
      //                   }
      //                ]
      //      }
      type: "https://docs.kopai.app/errors/signals-api-validation-error", // TODO: document error
      status: 400,
      title: "Invalid data",
      detail: error.message,
    } satisfies SignalsApiErrorResponse);
  }

  request.log.error(error);
  if (error instanceof SignalsApiError) {
    return reply.status(500).send({
      type: "https://docs.kopai.app/errors/signals-api-internal-error", // TODO: document error
      status: 500,
      title: "Internal server error",
      detail: error.message,
    } satisfies SignalsApiErrorResponse);
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

function isValidationError(
  error: unknown
): error is FastifyError & Required<Pick<FastifyError, "validation">> {
  return (
    isFastifyError(error) &&
    "validation" in error &&
    Array.isArray((error as FastifyError).validation)
  );
}
