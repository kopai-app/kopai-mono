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
