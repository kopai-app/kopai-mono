export abstract class ApiError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export abstract class SignalsApiError extends ApiError {}

export class DashboardNotFoundError extends ApiError {
  readonly code = "DASHBOARD_NOT_FOUND";
}

/**
 * Thrown by endpoint handlers that are schema-wired but not yet backed by a
 * datasource implementation. Maps to RFC-7807 501 in the error handler.
 */
export class NotImplementedError extends ApiError {
  readonly code = "NOT_IMPLEMENTED";
}
