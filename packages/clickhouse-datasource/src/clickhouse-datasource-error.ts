export abstract class ClickHouseDatasourceError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ClickHouseDatasourceParseError extends ClickHouseDatasourceError {
  readonly code = "PARSE_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
