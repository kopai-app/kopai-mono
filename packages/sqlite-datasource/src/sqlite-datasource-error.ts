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

/**
 * Thrown by the KopaiQuery translator when the schema permits a construct
 * that this datasource doesn't (yet) implement — e.g. percentile / topN /
 * heatmap / rate* aggregations.
 *
 * The API route handler maps this to RFC-7807 501 (Not Implemented).
 */
export class SqliteDatasourceNotImplementedError extends SqliteDatasourceError {
  readonly code = "NOT_IMPLEMENTED";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Thrown when caller-supplied input is malformed in a way the request schema
 * couldn't reject — e.g. a structurally valid cursor string whose components
 * aren't parseable.
 *
 * The API route handler maps this to RFC-7807 400 (Bad Request).
 */
export class SqliteDatasourceBadRequestError extends SqliteDatasourceError {
  readonly code = "BAD_REQUEST";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
