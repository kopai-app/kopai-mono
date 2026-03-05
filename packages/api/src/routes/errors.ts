export abstract class SignalsApiError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DashboardNotFoundError extends SignalsApiError {
  readonly code = "DASHBOARD_NOT_FOUND";
}
