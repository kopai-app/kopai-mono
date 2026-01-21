export abstract class SqliteDatasourceError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SqliteDatasourceQueryError extends SqliteDatasourceError {
  readonly code = "QUERY_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
