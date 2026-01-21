import {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
export function errorHandler(
  error: FastifyError | Error | string,
  request: FastifyRequest,
  reply: FastifyReply
) {}

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
