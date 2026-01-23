import type { ZodError } from "zod";

/**
 * Base error for Kopai API errors (non-2xx responses).
 * Follows RFC 7807 Problem Details format.
 */
export class KopaiError extends Error {
  /** Error code from problem type */
  code: string;
  /** HTTP status code */
  status: number;
  /** URI identifying the problem type */
  type: string;
  /** Human-readable explanation */
  detail?: string;

  constructor(options: {
    message: string;
    code: string;
    status: number;
    type: string;
    detail?: string;
  }) {
    super(options.message);
    this.name = "KopaiError";
    this.code = options.code;
    this.status = options.status;
    this.type = options.type;
    this.detail = options.detail;
  }
}

/**
 * Network-level errors (connection failed, DNS resolution, etc.)
 */
export class KopaiNetworkError extends Error {
  /** Original error that caused this */
  cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "KopaiNetworkError";
    this.cause = cause;
  }
}

/**
 * Request timeout errors
 */
export class KopaiTimeoutError extends Error {
  /** Timeout duration in milliseconds */
  timeout: number;

  constructor(timeout: number) {
    super(`Request timed out after ${timeout}ms`);
    this.name = "KopaiTimeoutError";
    this.timeout = timeout;
  }
}

/**
 * Response validation errors (Zod schema validation failed)
 */
export class KopaiValidationError extends Error {
  /** Original Zod error */
  zodError: ZodError;

  constructor(zodError: ZodError) {
    super(`Response validation failed: ${zodError.message}`);
    this.name = "KopaiValidationError";
    this.zodError = zodError;
  }
}
