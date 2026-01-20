import type { GrpcStatusCode } from "./otlp-schemas.js";

export class CollectorError extends Error {
  constructor(
    message: string,
    public code: GrpcStatusCode
  ) {
    super(message);
    Object.setPrototypeOf(this, CollectorError.prototype);
  }
}
