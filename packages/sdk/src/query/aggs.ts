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
import type { ColumnRef } from "./columns.js";
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

function makeAgg<Out>(
  fn: AggCallNode["fn"],
  col?: ColumnRef<
    string,
    unknown,
    "number" | "numericString" | "string" | "bool" | "array" | "map" | "date"
  >,
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
/* Numeric kinds shared across signals                                */
/* ------------------------------------------------------------------ */

type Numeric = "number" | "numericString";
type ScalarMinMax = "number" | "numericString" | "string" | "date" | "bool";
type Anything =
  | "number"
  | "numericString"
  | "string"
  | "bool"
  | "array"
  | "map"
  | "date";

/** Kind permitted for `countDistinct` / `topN`: any scalar (not map/array). */
type NonStructured = "number" | "numericString" | "string" | "bool" | "date";

/* ------------------------------------------------------------------ */
/* tracesAgg                                                          */
/* ------------------------------------------------------------------ */

export const tracesAgg = {
  count(): AggExpr<number> {
    return makeAgg<number>("count");
  },

  countDistinct<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, NonStructured>
  ): AggExpr<number> {
    return makeAgg<number>(
      "countDistinct",
      col as ColumnRef<string, unknown, Anything>
    );
  },

  sum<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("sum", col as ColumnRef<string, unknown, Anything>);
  },

  avg<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("avg", col as ColumnRef<string, unknown, Anything>);
  },

  min<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("min", col as ColumnRef<string, unknown, Anything>);
  },

  max<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("max", col as ColumnRef<string, unknown, Anything>);
  },

  p50<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p50", col as ColumnRef<string, unknown, Anything>);
  },
  p75<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p75", col as ColumnRef<string, unknown, Anything>);
  },
  p90<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p90", col as ColumnRef<string, unknown, Anything>);
  },
  p95<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p95", col as ColumnRef<string, unknown, Anything>);
  },
  p99<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p99", col as ColumnRef<string, unknown, Anything>);
  },
  p999<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p999", col as ColumnRef<string, unknown, Anything>);
  },

  topN<Name extends TracesColumnName, T>(
    col: ColumnRef<Name, T, NonStructured>,
    n: number
  ): AggExpr<Array<{ value: T; count: number }>> {
    return makeAgg<Array<{ value: T; count: number }>>(
      "topN",
      col as ColumnRef<string, unknown, Anything>,
      { n }
    );
  },
} as const;

/* ------------------------------------------------------------------ */
/* logsAgg                                                            */
/* ------------------------------------------------------------------ */

export const logsAgg = {
  count(): AggExpr<number> {
    return makeAgg<number>("count");
  },

  countDistinct<Name extends LogsColumnName, T>(
    col: ColumnRef<Name, T, NonStructured>
  ): AggExpr<number> {
    return makeAgg<number>(
      "countDistinct",
      col as ColumnRef<string, unknown, Anything>
    );
  },

  min<Name extends LogsColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("min", col as ColumnRef<string, unknown, Anything>);
  },

  max<Name extends LogsColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("max", col as ColumnRef<string, unknown, Anything>);
  },

  topN<Name extends LogsColumnName, T>(
    col: ColumnRef<Name, T, NonStructured>,
    n: number
  ): AggExpr<Array<{ value: T; count: number }>> {
    return makeAgg<Array<{ value: T; count: number }>>(
      "topN",
      col as ColumnRef<string, unknown, Anything>,
      { n }
    );
  },
} as const;

/* ------------------------------------------------------------------ */
/* metricsAgg                                                         */
/* ------------------------------------------------------------------ */

export const metricsAgg = {
  sum<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("sum", col as ColumnRef<string, unknown, Anything>);
  },
  avg<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("avg", col as ColumnRef<string, unknown, Anything>);
  },

  min<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("min", col as ColumnRef<string, unknown, Anything>);
  },
  max<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, ScalarMinMax>
  ): AggExpr<T> {
    return makeAgg<T>("max", col as ColumnRef<string, unknown, Anything>);
  },

  p50<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p50", col as ColumnRef<string, unknown, Anything>);
  },
  p75<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p75", col as ColumnRef<string, unknown, Anything>);
  },
  p90<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p90", col as ColumnRef<string, unknown, Anything>);
  },
  p95<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p95", col as ColumnRef<string, unknown, Anything>);
  },
  p99<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p99", col as ColumnRef<string, unknown, Anything>);
  },
  p999<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<number> {
    return makeAgg<number>("p999", col as ColumnRef<string, unknown, Anything>);
  },

  heatmap<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>
  ): AggExpr<Array<{ bucket: number; count: number }>> {
    return makeAgg<Array<{ bucket: number; count: number }>>(
      "heatmap",
      col as ColumnRef<string, unknown, Anything>
    );
  },

  rateAvg<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>,
    windowNs: string
  ): AggExpr<number> {
    return makeAgg<number>(
      "rateAvg",
      col as ColumnRef<string, unknown, Anything>,
      { windowNs }
    );
  },
  rateSum<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>,
    windowNs: string
  ): AggExpr<number> {
    return makeAgg<number>(
      "rateSum",
      col as ColumnRef<string, unknown, Anything>,
      { windowNs }
    );
  },
  rateMax<Name extends MetricsColumnName, T>(
    col: ColumnRef<Name, T, Numeric>,
    windowNs: string
  ): AggExpr<number> {
    return makeAgg<number>(
      "rateMax",
      col as ColumnRef<string, unknown, Anything>,
      { windowNs }
    );
  },
} as const;
