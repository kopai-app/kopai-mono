export class SignalsApiError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SignalsApiError.prototype);
  }
}
