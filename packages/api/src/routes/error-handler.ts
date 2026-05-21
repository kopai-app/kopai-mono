import {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { kopaiQueryCompiler } from "@kopai/core";
import { ApiError, DashboardNotFoundError } from "./errors.js";
import type { ApiErrorResponse } from "./error-schema-zod.js";
export function errorHandler(
  error: FastifyError | Error | string,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // KopaiQuery validator catches things zod schemas can't express
  // (e.g. "metric aggregate without MetricType filter"). Treat the same
  // as a 400 — the request shape is well-formed but semantically
  // invalid, and the validator's message is safe to surface.
  if (error instanceof kopaiQueryCompiler.KopaiQueryValidationError) {
    return reply.status(400).send({
      type: "https://docs.kopai.app/errors/signals-api-validation-error",
      status: 400,
      title: "Invalid query",
      detail: error.message,
    } satisfies ApiErrorResponse);
  }

  if (isClientError(error)) {
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
    } satisfies ApiErrorResponse);
  }

  if (error instanceof DashboardNotFoundError) {
    request.log.info(error.message);
    return reply.status(404).send({
      type: "https://docs.kopai.app/errors/dashboard-not-found",
      status: 404,
      title: "Dashboard not found",
      detail: error.message,
    } satisfies ApiErrorResponse);
  }
  request.log.error(error);
  if (error instanceof ApiError) {
    return reply.status(500).send({
      type: "https://docs.kopai.app/errors/signals-api-internal-error", // TODO: document error
      status: 500,
      title: "Internal server error",
      detail: error.message,
    } satisfies ApiErrorResponse);
  }

  return reply.status(500).send({
    type: "https://docs.kopai.app/errors/signals-api-internal-error", // TODO: document error
    status: 500,
    title: "Internal server error",
  } satisfies ApiErrorResponse);
}

function isFastifyError(error: unknown): error is FastifyError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as FastifyError).code === "string"
  );
}

function isClientError(error: unknown): error is FastifyError {
  return (
    isFastifyError(error) &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}
