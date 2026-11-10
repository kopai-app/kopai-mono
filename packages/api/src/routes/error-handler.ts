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

  // A query the datasource stopped at a resource limit. 422 rather than 500:
  // the caller can get past it by asking for less, and the detail says how.
  // Logged at warn, since which queries cannot be afforded is worth seeing
  // but is not a server fault.
  if (isResourceLimitError(error)) {
    request.log.warn({ err: error }, "query stopped at a resource limit");
    return reply.status(422).send({
      type: "https://docs.kopai.app/errors/signals-api-query-too-expensive",
      status: 422,
      title: "Query too expensive",
      detail: RESOURCE_LIMIT_DETAIL,
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

/**
 * ClickHouse error codes for a query stopped at a resource limit: 158
 * TOO_MANY_ROWS, 159 TIMEOUT_EXCEEDED, 160 TOO_SLOW, 241
 * MEMORY_LIMIT_EXCEEDED, 307 TOO_MANY_BYTES, 396 TOO_MANY_ROWS_OR_BYTES.
 *
 * Mirrors `isResourceLimitError` and `RESOURCE_LIMIT_REMEDIES` in `@kopai/mcp`
 * (`limits.ts`), which has the reasoning, including why the client's own
 * "Timeout error." and a server-wide 241 stay 500s. Neither package depends on
 * the other, so each keeps its own copy.
 */
const RESOURCE_LIMIT_CODES: ReadonlySet<string> = new Set([
  "158",
  "159",
  "160",
  "241",
  "307",
  "396",
]);

const RESOURCE_LIMIT_DETAIL = [
  "The query was stopped at this deployment's limit on query time, memory or rows read.",
  "Narrow the time window.",
  "Add filters so fewer rows are read: `service.name` or another attribute, and for metrics a single `MetricName`.",
  "For metrics, INCREASE, RATE and HISTOGRAM_QUANTILE read every data point in the window. When an exact increase or quantile is not needed, SUM, COUNT or MAX cost far less: on `Value` for Gauge and Sum metrics, on `Count` or `Sum` for Histogram metrics.",
].join(" ");

function isResourceLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code } = error as { code?: unknown };
  if (typeof code !== "string" || !RESOURCE_LIMIT_CODES.has(code)) {
    return false;
  }
  return !(code === "241" && error.message.includes("(total)"));
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
