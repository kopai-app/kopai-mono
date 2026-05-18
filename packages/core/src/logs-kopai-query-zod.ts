/**
 * KopaiQuery schema for the logs signal.
 *
 * Column names are camelCased variants of `otelLogsSchema` field names.
 * The agg-fn enum is logs-specific: no sum/avg/p* (numeric distributions
 * don't make sense on log records); `topN` is supported.
 */
import { z } from "zod";
import { kopaiQueryBaseSchema, refineKopaiQuery } from "./kopai-query-zod.js";

/**
 * Enum of camelCased column names exposed on logs. Derived from
 * `otelLogsSchema`.
 */
export const logsColumnNameSchema = z
  .enum([
    "timestamp",
    "body",
    "eventName",
    "logAttributes",
    "resourceAttributes",
    "resourceSchemaUrl",
    "scopeAttributes",
    "scopeName",
    "scopeSchemaUrl",
    "scopeVersion",
    "serviceName",
    "severityNumber",
    "severityText",
    "spanId",
    "traceFlags",
    "traceId",
  ])
  .describe(
    "Enumeration of all camelCased column names available on logs queries. Derived from otelLogsSchema."
  );

export type LogsColumnName = z.infer<typeof logsColumnNameSchema>;

/**
 * Enum of aggregation functions supported by logs queries. Excludes
 * numeric distribution / rate aggregates; includes `topN`.
 */
export const logsAggFnSchema = z
  .enum(["count", "countDistinct", "min", "max", "topN"])
  .describe("Aggregation functions supported by logs queries.");

export type LogsAggFn = z.infer<typeof logsAggFnSchema>;

const logsColumnNames: ReadonlySet<string> = new Set(
  logsColumnNameSchema.options
);
const logsAggFns: ReadonlySet<string> = new Set(logsAggFnSchema.options);

/**
 * Full logs KopaiQuery schema. See `tracesKopaiQuerySchema` for the
 * refinement contract.
 */
export const logsKopaiQuerySchema = kopaiQueryBaseSchema
  .extend({
    signal: z
      .literal("logs")
      .describe("Signal discriminator. Always 'logs' for logs queries."),
  })
  .superRefine((data, ctx) =>
    refineKopaiQuery(
      data,
      ctx,
      (n) => logsColumnNames.has(n),
      (fn) => logsAggFns.has(fn)
    )
  )
  .describe(
    "KopaiQuery for the logs signal. Wire format consumed by POST /signals/logs/query."
  );

export type LogsKopaiQuery = z.infer<typeof logsKopaiQuerySchema>;
