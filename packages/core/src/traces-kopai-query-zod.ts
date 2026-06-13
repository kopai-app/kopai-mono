/**
 * KopaiQuery schema for the traces signal.
 *
 * Column names are camelCased variants of `otelTracesSchema` field names
 * (e.g. `SpanId` → `spanId`, `Events.Attributes` → `eventsAttributes`).
 * The agg-fn enum is traces-specific (no heatmap, no rate*).
 */
import { z } from "zod";
import { kopaiQueryBaseSchema, refineKopaiQuery } from "./kopai-query-zod.js";

/**
 * Enum of camelCased column names exposed on traces. Derived from
 * `otelTracesSchema`, with dotted fields (`Events.*`, `Links.*`) folded
 * into camelCase (`eventsAttributes`, `linksSpanId`, …).
 */
export const tracesColumnNameSchema = z
  .enum([
    "spanId",
    "timestamp",
    "traceId",
    "duration",
    "eventsAttributes",
    "eventsName",
    "eventsTimestamp",
    "linksAttributes",
    "linksSpanId",
    "linksTraceId",
    "linksTraceState",
    "parentSpanId",
    "resourceAttributes",
    "scopeName",
    "scopeVersion",
    "serviceName",
    "spanAttributes",
    "spanKind",
    "spanName",
    "statusCode",
    "statusMessage",
    "traceState",
  ])
  .describe(
    "Enumeration of all camelCased column names available on traces queries. Derived from otelTracesSchema."
  );

export type TracesColumnName = z.infer<typeof tracesColumnNameSchema>;

/**
 * Enum of aggregation functions supported by traces queries. Excludes
 * metrics-only fns (`heatmap`, `rate*`); includes `topN` (traces & logs).
 */
export const tracesAggFnSchema = z
  .enum([
    "count",
    "countDistinct",
    "sum",
    "avg",
    "min",
    "max",
    "p50",
    "p75",
    "p90",
    "p95",
    "p99",
    "p999",
    "topN",
  ])
  .describe("Aggregation functions supported by traces queries.");

export type TracesAggFn = z.infer<typeof tracesAggFnSchema>;

const tracesColumnNames: ReadonlySet<string> = new Set(
  tracesColumnNameSchema.options
);
const tracesAggFns: ReadonlySet<string> = new Set(tracesAggFnSchema.options);

/**
 * Full traces KopaiQuery schema. Extends the shared base with a
 * `signal: 'traces'` discriminator and runs `.superRefine` to validate:
 *  - every `select` column-ref name appears in `tracesColumnNameSchema`,
 *  - every `select` agg fn appears in `tracesAggFnSchema`,
 *  - `cursor` is absent when the select map contains any aggregation.
 */
export const tracesKopaiQuerySchema = kopaiQueryBaseSchema
  .extend({
    signal: z
      .literal("traces")
      .describe("Signal discriminator. Always 'traces' for traces queries."),
  })
  .superRefine((data, ctx) =>
    refineKopaiQuery(
      data,
      ctx,
      (n) => tracesColumnNames.has(n),
      (fn) => tracesAggFns.has(fn)
    )
  )
  .describe(
    "KopaiQuery for the traces signal. Wire format consumed by POST /signals/traces/query."
  );

export type TracesKopaiQuery = z.infer<typeof tracesKopaiQuerySchema>;
