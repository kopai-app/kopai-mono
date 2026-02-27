/** Matches pino.LogFn overloads so Fastify's request.log is directly assignable. */
export interface LogFn {
  (msg: string, ...args: unknown[]): void;
  (obj: object, msg?: string, ...args: unknown[]): void;
}

export interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

/**
 * Request context expected by ClickHouseReadDatasource.
 * Consuming apps provide this via requestContext on each method call.
 */
export interface ClickHouseRequestContext {
  database: string;
  username: string;
  password: string;
  logger?: Logger;
}

/**
 * Type guard to extract ClickHouseRequestContext from unknown requestContext.
 */
export function assertClickHouseRequestContext(
  ctx: unknown
): asserts ctx is ClickHouseRequestContext {
  if (
    typeof ctx !== "object" ||
    ctx === null ||
    !("database" in ctx) ||
    !("username" in ctx) ||
    !("password" in ctx)
  ) {
    throw new Error(
      "requestContext must provide { database, username, password }"
    );
  }
  const obj = ctx as Record<string, unknown>;
  if (
    typeof obj.database !== "string" ||
    typeof obj.username !== "string" ||
    typeof obj.password !== "string"
  ) {
    throw new Error(
      "requestContext must provide { database, username, password }"
    );
  }
}
