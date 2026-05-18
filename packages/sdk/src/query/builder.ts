/**
 * Fluent query builder.
 *
 * Per-signal entry points (`traces`, `logs`, `metrics.gauge`, …) are
 * column records merged with builder methods via `Object.assign`. The
 * builder is immutable — every method returns a fresh
 * `QueryBuilder` carrying the updated AST.
 *
 * Type parameters:
 * - `Signal` — `'traces' | 'logs' | 'metrics'`. Picks the wire type.
 * - `Cols` — column-record literal type. Used by `.groupBy` /
 *   `.orderBy` to constrain to known columns.
 * - `Row` — inferred row shape from the most recent `.select`.
 * - `IsAgg` — `true` when any select value is an `AggExpr`. Gates
 *   `.cursor`.
 *
 * `.toQuery()` returns the wire AST validated through the appropriate
 * core zod schema, with phantom `__row` / `__isAgg` fields branded on
 * via a single type cast.
 */
import {
  tracesKopaiQuerySchema,
  logsKopaiQuerySchema,
  metricsKopaiQuerySchema,
  type TracesKopaiQuery,
  type LogsKopaiQuery,
  type MetricsKopaiQuery,
  type ExprNode,
  type OrderBy,
  type ColumnRefNode,
  type AggCallNode,
} from "@kopai/core";

import type { ColumnRef, Kind } from "./columns.js";
import type { AggExpr } from "./aggs.js";
import {
  tracesColumns,
  logsColumns,
  gaugeColumns,
  sumColumns,
  histogramColumns,
  exponentialHistogramColumns,
  summaryColumns,
} from "./columns.js";

/* ------------------------------------------------------------------ */
/* Row-type inference                                                 */
/* ------------------------------------------------------------------ */

type SelectValue = ColumnRef<string, unknown, Kind> | AggExpr<unknown>;

type SelectMap = Record<string, SelectValue>;

/**
 * Row-shape inference: each ColumnRef contributes its TsType, each
 * AggExpr contributes its Out.
 */
export type InferRow<M extends SelectMap> = {
  [K in keyof M]: M[K] extends ColumnRef<string, infer T, Kind>
    ? T
    : M[K] extends AggExpr<infer O>
      ? O
      : never;
};

/** Phantom: `true` iff any value in the select map is an AggExpr. */
export type HasAgg<M extends SelectMap> = {
  [K in keyof M]: M[K] extends AggExpr<unknown> ? true : false;
}[keyof M] extends false
  ? false
  : true;

/* ------------------------------------------------------------------ */
/* Per-signal wire-query union                                        */
/* ------------------------------------------------------------------ */

type SignalQuery<S extends "traces" | "logs" | "metrics"> = S extends "traces"
  ? TracesKopaiQuery
  : S extends "logs"
    ? LogsKopaiQuery
    : MetricsKopaiQuery;

/* ------------------------------------------------------------------ */
/* Internal builder state                                             */
/* ------------------------------------------------------------------ */

interface BuilderState {
  signal: "traces" | "logs" | "metrics";
  metricType?:
    | "gauge"
    | "sum"
    | "histogram"
    | "exponentialHistogram"
    | "summary";
  select?: Record<string, ColumnRefNode | AggCallNode>;
  where?: ExprNode;
  groupBy?: ColumnRefNode[];
  orderBy?: OrderBy[];
  limit?: number;
  timeRange?: { start: string; end: string };
  cursor?: string;
}

function cloneState(s: BuilderState): BuilderState {
  return { ...s };
}

/* ------------------------------------------------------------------ */
/* QueryBuilder class                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fluent query builder. `Row` is the inferred row shape; `IsAgg` is
 * `true` when an aggregation is present in `.select`.
 */
export class QueryBuilder<
  Signal extends "traces" | "logs" | "metrics",
  // Cols carried as a generic for downstream method type inference.
  Cols,
  Row = never,
  IsAgg extends boolean = false,
> {
  /** @internal */
  readonly _state: BuilderState;

  constructor(state: BuilderState) {
    this._state = state;
  }

  select<M extends SelectMap>(
    map: M
  ): QueryBuilder<Signal, Cols, InferRow<M>, HasAgg<M>> {
    const select: Record<string, ColumnRefNode | AggCallNode> = {};
    for (const [k, v] of Object.entries(map)) {
      select[k] = v.toNode();
    }
    return new QueryBuilder<Signal, Cols, InferRow<M>, HasAgg<M>>({
      ...cloneState(this._state),
      select,
    });
  }

  where(expr: ExprNode): QueryBuilder<Signal, Cols, Row, IsAgg> {
    return new QueryBuilder<Signal, Cols, Row, IsAgg>({
      ...cloneState(this._state),
      where: expr,
    });
  }

  groupBy(
    ...cols: ColumnRef<string, unknown, Kind>[]
  ): QueryBuilder<Signal, Cols, Row, IsAgg> {
    return new QueryBuilder<Signal, Cols, Row, IsAgg>({
      ...cloneState(this._state),
      groupBy: cols.map((c) => c.toNode()),
    });
  }

  orderBy(ob: {
    col: ColumnRef<string, unknown, Kind>;
    dir: "asc" | "desc";
  }): QueryBuilder<Signal, Cols, Row, IsAgg> {
    const next = cloneState(this._state);
    const list = next.orderBy ? [...next.orderBy] : [];
    list.push({ col: ob.col.toNode(), dir: ob.dir });
    next.orderBy = list;
    return new QueryBuilder<Signal, Cols, Row, IsAgg>(next);
  }

  limit(n: number): QueryBuilder<Signal, Cols, Row, IsAgg> {
    return new QueryBuilder<Signal, Cols, Row, IsAgg>({
      ...cloneState(this._state),
      limit: n,
    });
  }

  timeRange(
    start: string,
    end: string
  ): QueryBuilder<Signal, Cols, Row, IsAgg> {
    return new QueryBuilder<Signal, Cols, Row, IsAgg>({
      ...cloneState(this._state),
      timeRange: { start, end },
    });
  }

  /**
   * Set the pagination cursor. Only callable when the select map
   * contains no aggregation (`IsAgg = false`). The `this` parameter
   * narrows the receiver type to enforce this at the type level.
   */
  cursor(
    this: QueryBuilder<Signal, Cols, Row, false>,
    c: string
  ): QueryBuilder<Signal, Cols, Row, false> {
    return new QueryBuilder<Signal, Cols, Row, false>({
      ...cloneState(this._state),
      cursor: c,
    });
  }

  /**
   * Build and validate the wire AST. Returns the parsed query branded
   * with phantom `__row` and `__isAgg` fields (type-only).
   */
  toQuery(): SignalQuery<Signal> & { __row: Row; __isAgg: IsAgg } {
    if (!this._state.select) {
      throw new Error("QueryBuilder.toQuery: .select() is required");
    }
    const raw: Record<string, unknown> = {
      signal: this._state.signal,
      select: this._state.select,
    };
    if (this._state.metricType) raw.metricType = this._state.metricType;
    if (this._state.where) raw.where = this._state.where;
    if (this._state.groupBy) raw.groupBy = this._state.groupBy;
    if (this._state.orderBy) raw.orderBy = this._state.orderBy;
    if (this._state.limit !== undefined) raw.limit = this._state.limit;
    if (this._state.timeRange) raw.timeRange = this._state.timeRange;
    if (this._state.cursor !== undefined) raw.cursor = this._state.cursor;

    let parsed: TracesKopaiQuery | LogsKopaiQuery | MetricsKopaiQuery;
    if (this._state.signal === "traces") {
      parsed = tracesKopaiQuerySchema.parse(raw);
    } else if (this._state.signal === "logs") {
      parsed = logsKopaiQuerySchema.parse(raw);
    } else {
      parsed = metricsKopaiQuerySchema.parse(raw);
    }
    return parsed as SignalQuery<Signal> & {
      __row: Row;
      __isAgg: IsAgg;
    };
  }
}

/* ------------------------------------------------------------------ */
/* Public entry points: column-record + builder-method merge          */
/* ------------------------------------------------------------------ */

/**
 * Merge a column record with builder methods that produce a fresh
 * `QueryBuilder`. The returned object behaves as both the column
 * accessor (e.g. `traces.spanId`) and the builder seed (e.g.
 * `traces.select({...})`).
 */
type SignalEntry<Signal extends "traces" | "logs" | "metrics", Cols> = Cols & {
  select<M extends SelectMap>(
    map: M
  ): QueryBuilder<Signal, Cols, InferRow<M>, HasAgg<M>>;
  where(expr: ExprNode): QueryBuilder<Signal, Cols, never, false>;
  groupBy(
    ...cols: ColumnRef<string, unknown, Kind>[]
  ): QueryBuilder<Signal, Cols, never, false>;
  orderBy(ob: {
    col: ColumnRef<string, unknown, Kind>;
    dir: "asc" | "desc";
  }): QueryBuilder<Signal, Cols, never, false>;
  limit(n: number): QueryBuilder<Signal, Cols, never, false>;
  timeRange(
    start: string,
    end: string
  ): QueryBuilder<Signal, Cols, never, false>;
};

function buildEntry<
  Signal extends "traces" | "logs" | "metrics",
  Cols extends Record<string, unknown>,
>(
  signal: Signal,
  cols: Cols,
  metricType?: BuilderState["metricType"]
): SignalEntry<Signal, Cols> {
  const seed = (): QueryBuilder<Signal, Cols, never, false> =>
    new QueryBuilder<Signal, Cols, never, false>({ signal, metricType });

  const methods = {
    select: <M extends SelectMap>(map: M) => seed().select(map),
    where: (expr: ExprNode) => seed().where(expr),
    groupBy: (...cs: ColumnRef<string, unknown, Kind>[]) =>
      seed().groupBy(...cs),
    orderBy: (ob: {
      col: ColumnRef<string, unknown, Kind>;
      dir: "asc" | "desc";
    }) => seed().orderBy(ob),
    limit: (n: number) => seed().limit(n),
    timeRange: (start: string, end: string) => seed().timeRange(start, end),
  };

  return Object.assign({}, cols, methods) as SignalEntry<Signal, Cols>;
}

/* ------------------------------------------------------------------ */
/* Public entry constants                                             */
/* ------------------------------------------------------------------ */

export const traces = buildEntry("traces", tracesColumns);

export const logs = buildEntry("logs", logsColumns);

export const metrics = {
  gauge: buildEntry("metrics", gaugeColumns, "gauge"),
  sum: buildEntry("metrics", sumColumns, "sum"),
  histogram: buildEntry("metrics", histogramColumns, "histogram"),
  exponentialHistogram: buildEntry(
    "metrics",
    exponentialHistogramColumns,
    "exponentialHistogram"
  ),
  summary: buildEntry("metrics", summaryColumns, "summary"),
} as const;
