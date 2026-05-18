/**
 * Aggregation functions for each signal.
 *
 * `AggExpr<Out>` is a phantom-branded reference whose `Out` parameter
 * drives row-type inference in `.select`. Per-signal records
 * (`tracesAgg`, `logsAgg`, `metricsAgg`) only expose fns valid for
 * their signal (see plan agg matrix).
 *
 * Eligibility is enforced by:
 * - Column `Kind` brand (e.g. `sum` requires numeric).
 * - Column `Name` constrained to per-signal column-name unions (e.g.
 *   `tracesAgg.sum` rejects a logs-only column).
 */
import type { AggCallNode } from "@kopai/core";
import type { ColumnRef, Kind } from "./columns.js";
import type {
  TracesColumnName,
  LogsColumnName,
  MetricsColumnName,
} from "./columns.js";

/**
 * Phantom-branded aggregation expression. `Out` is the JSON-shape of
 * the aggregation's result value.
 */
export interface AggExpr<Out> {
  readonly __out: Out;
  toNode(): AggCallNode;
}

type AnyCol = ColumnRef<string, unknown, Kind>;

function makeAgg<Out>(
  fn: AggCallNode["fn"],
  col?: AnyCol,
  args?: AggCallNode["args"]
): AggExpr<Out> {
  return {
    toNode(): AggCallNode {
      const node: AggCallNode = { kind: "agg", fn };
      if (col) node.col = col.toNode();
      if (args) node.args = args;
      return node;
    },
  } as AggExpr<Out>;
}

/* ------------------------------------------------------------------ */
/* Per-fn kind constraints                                            */
/* ------------------------------------------------------------------ */

type Numeric = Extract<Kind, "number" | "numericString">;
type ScalarMinMax = Extract<
  Kind,
  "number" | "numericString" | "string" | "date" | "bool"
>;
/** Kind permitted for `countDistinct` / `topN`: any scalar (not map/array). */
type NonStructured = Extract<
  Kind,
  "number" | "numericString" | "string" | "bool" | "date"
>;

type QuantileFn = "p50" | "p75" | "p90" | "p95" | "p99" | "p999";
const QUANTILE_FNS = ["p50", "p75", "p90", "p95", "p99", "p999"] as const;

/* ------------------------------------------------------------------ */
/* Per-signal agg-fn factories                                        */
/* ------------------------------------------------------------------ */

function numericAgg<SigCol extends string>(fn: AggCallNode["fn"]) {
  return <Name extends SigCol, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> => makeAgg<number>(fn, col as AnyCol);
}

function minMaxAgg<SigCol extends string>(fn: "min" | "max") {
  return <Name extends SigCol, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> => makeAgg<T>(fn, col as AnyCol);
}

function countDistinctAgg<SigCol extends string>() {
  return <Name extends SigCol, T>(
    col: ColumnRef<Name, T, NonStructured>
  ): AggExpr<number> => makeAgg<number>("countDistinct", col as AnyCol);
}

function topNAgg<SigCol extends string>() {
  return <Name extends SigCol, T>(
    col: ColumnRef<Name, T, NonStructured>,
    n: number
  ): AggExpr<Array<{ value: T; count: number }>> =>
    makeAgg<Array<{ value: T; count: number }>>("topN", col as AnyCol, { n });
}

function quantileAggs<SigCol extends string>(): Record<
  QuantileFn,
  ReturnType<typeof numericAgg<SigCol>>
> {
  const out = {} as Record<QuantileFn, ReturnType<typeof numericAgg<SigCol>>>;
  for (const fn of QUANTILE_FNS) {
    out[fn] = numericAgg<SigCol>(fn);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* tracesAgg                                                          */
/* ------------------------------------------------------------------ */

export const tracesAgg = {
  count(): AggExpr<number> {
    return makeAgg<number>("count");
  },
  countDistinct: countDistinctAgg<TracesColumnName>(),
  sum: numericAgg<TracesColumnName>("sum"),
  avg: numericAgg<TracesColumnName>("avg"),
  min: minMaxAgg<TracesColumnName>("min"),
  max: minMaxAgg<TracesColumnName>("max"),
  ...quantileAggs<TracesColumnName>(),
  topN: topNAgg<TracesColumnName>(),
} as const;

/* ------------------------------------------------------------------ */
/* logsAgg                                                            */
/* ------------------------------------------------------------------ */

export const logsAgg = {
  count(): AggExpr<number> {
    return makeAgg<number>("count");
  },
  countDistinct: countDistinctAgg<LogsColumnName>(),
  min: minMaxAgg<LogsColumnName>("min"),
  max: minMaxAgg<LogsColumnName>("max"),
  topN: topNAgg<LogsColumnName>(),
} as const;

/* ------------------------------------------------------------------ */
/* metricsAgg                                                         */
/* ------------------------------------------------------------------ */

function rateAgg<SigCol extends string>(fn: "rateAvg" | "rateSum" | "rateMax") {
  return <Name extends SigCol, T>(
    col: ColumnRef<Name, T, Numeric>,
    windowNs: string
  ): AggExpr<number> => makeAgg<number>(fn, col as AnyCol, { windowNs });
}

export const metricsAgg = {
  sum: numericAgg<MetricsColumnName>("sum"),
  avg: numericAgg<MetricsColumnName>("avg"),
  min: minMaxAgg<MetricsColumnName>("min"),
  max: minMaxAgg<MetricsColumnName>("max"),
  ...quantileAggs<MetricsColumnName>(),

  heatmap<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<Array<{ bucket: number; count: number }>> {
    return makeAgg<Array<{ bucket: number; count: number }>>(
      "heatmap",
      col as AnyCol
    );
  },

  rateAvg: rateAgg<MetricsColumnName>("rateAvg"),
  rateSum: rateAgg<MetricsColumnName>("rateSum"),
  rateMax: rateAgg<MetricsColumnName>("rateMax"),
} as const;
