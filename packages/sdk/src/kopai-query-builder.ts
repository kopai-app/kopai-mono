import { kopaiQuery } from "@kopai/core";
import type { z } from "zod";

// ============================================================
// Public types
// ============================================================

export type Signal = "traces" | "logs" | "metrics";

export type TraceColumn = z.infer<typeof kopaiQuery.TraceColumn>;
export type LogColumn = z.infer<typeof kopaiQuery.LogColumn>;
export type MetricColumn = z.infer<typeof kopaiQuery.MetricColumn>;

export type TraceAttrContainer = z.infer<typeof kopaiQuery.TraceAttrContainer>;
export type LogAttrContainer = z.infer<typeof kopaiQuery.LogAttrContainer>;
export type MetricAttrContainer = z.infer<
  typeof kopaiQuery.MetricAttrContainer
>;

export type ContainerFor<S extends Signal> = S extends "traces"
  ? TraceAttrContainer
  : S extends "logs"
    ? LogAttrContainer
    : S extends "metrics"
      ? MetricAttrContainer
      : never;

type AttrRef<C extends string> = { container: C; key: string };

export type ColumnArg<S extends Signal> = S extends "traces"
  ? TraceColumn | AttrRef<TraceAttrContainer>
  : S extends "logs"
    ? LogColumn | AttrRef<LogAttrContainer>
    : S extends "metrics"
      ? MetricColumn | AttrRef<MetricAttrContainer>
      : never;

export type MeasureExprFor<S extends Signal> = S extends "traces"
  ? z.infer<typeof kopaiQuery.TraceAggregateQuerySchema>["measures"][number]
  : S extends "logs"
    ? z.infer<typeof kopaiQuery.LogAggregateQuerySchema>["measures"][number]
    : S extends "metrics"
      ? z.infer<
          typeof kopaiQuery.MetricAggregateQuerySchema
        >["measures"][number]
      : never;

export type FilterExprFor<S extends Signal> = S extends "traces"
  ? NonNullable<
      z.infer<typeof kopaiQuery.TraceAggregateQuerySchema>["filters"]
    >[number]
  : S extends "logs"
    ? NonNullable<
        z.infer<typeof kopaiQuery.LogAggregateQuerySchema>["filters"]
      >[number]
    : S extends "metrics"
      ? NonNullable<
          z.infer<typeof kopaiQuery.MetricAggregateQuerySchema>["filters"]
        >[number]
      : never;

export type AggregateQueryFor<S extends Signal> = S extends "traces"
  ? kopaiQuery.TraceAggregateQuery
  : S extends "logs"
    ? kopaiQuery.LogAggregateQuery
    : S extends "metrics"
      ? kopaiQuery.MetricAggregateQuery
      : never;

export type RawQueryFor<S extends Signal> = S extends "traces"
  ? kopaiQuery.TraceRawQuery
  : S extends "logs"
    ? kopaiQuery.LogRawQuery
    : S extends "metrics"
      ? kopaiQuery.MetricRawQuery
      : never;

export type HavingOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

// ============================================================
// Phantom-flag helpers
// ============================================================

type WithFlag<S, K extends keyof S> = Omit<S, K> & { [P in K]: true };

type AggFlags = {
  measures: boolean;
  timeDimension: boolean;
  output: boolean;
};
type AggInit = { measures: false; timeDimension: false; output: false };
export type AggReady = { measures: true; timeDimension: true; output: true };

type RawFlags = { dimensions: boolean; timeDimension: boolean };
type RawInit = { dimensions: false; timeDimension: false };
export type RawReady = { dimensions: true; timeDimension: true };

// ============================================================
// Build-time error
// ============================================================

export interface KopaiQueryBuildIssue {
  path: string;
  message: string;
}

/** Thrown by `.build()` when accumulated state fails Zod validation. */
export class KopaiQueryBuildError extends Error {
  issues: KopaiQueryBuildIssue[];

  constructor(issues: KopaiQueryBuildIssue[]) {
    super(
      [
        "Failed to build KopaiQuery:",
        ...issues.map((i) => `  - ${i.path || "(root)"}: ${i.message}`),
      ].join("\n")
    );
    this.name = "KopaiQueryBuildError";
    this.issues = issues;
  }
}

// ============================================================
// Column resolution
// ============================================================

const STRUCTURAL_SET: Record<Signal, ReadonlySet<string>> = {
  traces: new Set<string>(kopaiQuery.TraceColumn.options),
  logs: new Set<string>(kopaiQuery.LogColumn.options),
  metrics: new Set<string>(kopaiQuery.MetricColumn.options),
};

const RESOURCE_PREFIXES = [
  "service.",
  "deployment.",
  "host.",
  "container.",
  "k8s.",
  "cloud.",
  "process.",
  "telemetry.",
  "os.",
] as const;

function inferContainer(key: string, signal: Signal): string {
  if (RESOURCE_PREFIXES.some((p) => key.startsWith(p)))
    return "ResourceAttributes";
  if (signal === "traces") return "SpanAttributes";
  if (signal === "logs") return "LogAttributes";
  return "Attributes";
}

type ColumnRef = string | { container: string; key: string };

function resolveColumn(input: unknown, signal: Signal): ColumnRef {
  if (typeof input === "object" && input !== null) return input as ColumnRef;
  if (typeof input !== "string") {
    throw new TypeError(`Column must be a string or attr-ref object`);
  }
  if (STRUCTURAL_SET[signal].has(input)) return input;
  return { container: inferContainer(input, signal), key: input };
}

// ============================================================
// Filter DSL
// ============================================================

interface AttrRefTerminal<S extends Signal> {
  eq(value: string): FilterExprFor<S> & { kind: "string" };
  eq(value: number): FilterExprFor<S> & { kind: "number" };
  eq(value: boolean): FilterExprFor<S> & { kind: "boolean" };
  neq(value: string): FilterExprFor<S> & { kind: "string" };
  neq(value: number): FilterExprFor<S> & { kind: "number" };
  neq(value: boolean): FilterExprFor<S> & { kind: "boolean" };
  contains(value: string): FilterExprFor<S>;
  notContains(value: string): FilterExprFor<S>;
  startsWith(value: string): FilterExprFor<S>;
  endsWith(value: string): FilterExprFor<S>;
  in(values: string[]): FilterExprFor<S>;
  in(values: number[]): FilterExprFor<S>;
  notIn(values: string[] | number[]): FilterExprFor<S>;
  gt(value: number): FilterExprFor<S>;
  gte(value: number): FilterExprFor<S>;
  lt(value: number): FilterExprFor<S>;
  lte(value: number): FilterExprFor<S>;
  isNull(): FilterExprFor<S>;
  isNotNull(): FilterExprFor<S>;
}

/** DSL for building per-signal filter expressions. */
export interface FilterBuilder<S extends Signal> {
  /** AND-combines children. */
  and(...children: FilterExprFor<S>[]): FilterExprFor<S>;
  /** OR-combines children. */
  or(...children: FilterExprFor<S>[]): FilterExprFor<S>;
  /** Equality filter; kind picked from value type. */
  eq(col: ColumnArg<S>, value: string): FilterExprFor<S> & { kind: "string" };
  eq(col: ColumnArg<S>, value: number): FilterExprFor<S> & { kind: "number" };
  eq(col: ColumnArg<S>, value: boolean): FilterExprFor<S> & { kind: "boolean" };
  /** Inequality filter; kind picked from value type. */
  neq(col: ColumnArg<S>, value: string): FilterExprFor<S> & { kind: "string" };
  neq(col: ColumnArg<S>, value: number): FilterExprFor<S> & { kind: "number" };
  neq(
    col: ColumnArg<S>,
    value: boolean
  ): FilterExprFor<S> & { kind: "boolean" };
  contains(col: ColumnArg<S>, value: string): FilterExprFor<S>;
  notContains(col: ColumnArg<S>, value: string): FilterExprFor<S>;
  startsWith(col: ColumnArg<S>, value: string): FilterExprFor<S>;
  endsWith(col: ColumnArg<S>, value: string): FilterExprFor<S>;
  in(col: ColumnArg<S>, values: string[]): FilterExprFor<S>;
  in(col: ColumnArg<S>, values: number[]): FilterExprFor<S>;
  notIn(col: ColumnArg<S>, values: string[] | number[]): FilterExprFor<S>;
  gt(col: ColumnArg<S>, value: number): FilterExprFor<S>;
  gte(col: ColumnArg<S>, value: number): FilterExprFor<S>;
  lt(col: ColumnArg<S>, value: number): FilterExprFor<S>;
  lte(col: ColumnArg<S>, value: number): FilterExprFor<S>;
  isNull(col: ColumnArg<S>): FilterExprFor<S>;
  isNotNull(col: ColumnArg<S>): FilterExprFor<S>;
  /** Explicit attribute-map reference for non-semconv keys. */
  attr(container: ContainerFor<S>, key: string): AttrRefTerminal<S>;
}

function makeFilterBuilder<S extends Signal>(signal: S): FilterBuilder<S> {
  const col = (c: ColumnArg<S>) => resolveColumn(c, signal);

  const stringOp = (op: string) => (c: ColumnArg<S>, value: string) =>
    ({
      kind: "string",
      column: col(c),
      op,
      value,
    }) as unknown as FilterExprFor<S>;
  const numberOp = (op: string) => (c: ColumnArg<S>, value: number) =>
    ({
      kind: "number",
      column: col(c),
      op,
      value,
    }) as unknown as FilterExprFor<S>;

  const inOp =
    (op: "in" | "notIn") =>
    (c: ColumnArg<S>, values: string[] | number[]): FilterExprFor<S> => {
      const isNumber = values.length > 0 && typeof values[0] === "number";
      return {
        kind: isNumber ? "numberIn" : "stringIn",
        column: col(c),
        op,
        values,
      } as unknown as FilterExprFor<S>;
    };

  const eq = (c: ColumnArg<S>, value: string | number | boolean) => {
    const kind =
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
    return {
      kind,
      column: col(c),
      op: "eq",
      value,
    } as unknown as FilterExprFor<S>;
  };
  const neq = (c: ColumnArg<S>, value: string | number | boolean) => {
    const kind =
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
    return {
      kind,
      column: col(c),
      op: "neq",
      value,
    } as unknown as FilterExprFor<S>;
  };

  const nullOp = (op: "isNull" | "isNotNull") => (c: ColumnArg<S>) =>
    ({ kind: "null", column: col(c), op }) as unknown as FilterExprFor<S>;

  const logical =
    (op: "and" | "or") =>
    (...children: FilterExprFor<S>[]) =>
      ({
        kind: "logical",
        op,
        filters: children,
      }) as unknown as FilterExprFor<S>;

  const attr = (
    container: ContainerFor<S>,
    key: string
  ): AttrRefTerminal<S> => {
    const ref = { container, key } as ColumnArg<S>;
    return {
      eq: (v: string | number | boolean) => eq(ref, v),
      neq: (v: string | number | boolean) => neq(ref, v),
      contains: (v: string) => stringOp("contains")(ref, v),
      notContains: (v: string) => stringOp("notContains")(ref, v),
      startsWith: (v: string) => stringOp("startsWith")(ref, v),
      endsWith: (v: string) => stringOp("endsWith")(ref, v),
      in: (v: string[] | number[]) => inOp("in")(ref, v),
      notIn: (v: string[] | number[]) => inOp("notIn")(ref, v),
      gt: (v: number) => numberOp("gt")(ref, v),
      gte: (v: number) => numberOp("gte")(ref, v),
      lt: (v: number) => numberOp("lt")(ref, v),
      lte: (v: number) => numberOp("lte")(ref, v),
      isNull: () => nullOp("isNull")(ref),
      isNotNull: () => nullOp("isNotNull")(ref),
    } as AttrRefTerminal<S>;
  };

  return {
    and: logical("and"),
    or: logical("or"),
    eq: eq as FilterBuilder<S>["eq"],
    neq: neq as FilterBuilder<S>["neq"],
    contains: stringOp("contains"),
    notContains: stringOp("notContains"),
    startsWith: stringOp("startsWith"),
    endsWith: stringOp("endsWith"),
    in: inOp("in"),
    notIn: inOp("notIn"),
    gt: numberOp("gt"),
    gte: numberOp("gte"),
    lt: numberOp("lt"),
    lte: numberOp("lte"),
    isNull: nullOp("isNull"),
    isNotNull: nullOp("isNotNull"),
    attr,
  };
}

// ============================================================
// Measure DSL
// ============================================================

/** Per-signal measure builder. */
export interface MeasureBuilder<S extends Signal> {
  /** COUNT(*) under `alias`. */
  count(alias: string): MeasureExprFor<S>;
  /** Approximate distinct count of `col`. */
  countDistinct(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** SUM aggregation over a numeric column. */
  sum(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** AVG aggregation over a numeric column. */
  avg(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** MIN aggregation over a numeric column. */
  min(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** MAX aggregation over a numeric column. */
  max(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 50th percentile of a numeric column. */
  p50(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 75th percentile of a numeric column. */
  p75(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 90th percentile of a numeric column. */
  p90(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 95th percentile of a numeric column. */
  p95(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 99th percentile of a numeric column. */
  p99(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** 99.9th percentile of a numeric column. */
  p999(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** Per-second AVG over the bucket window. */
  rateAvg(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** Per-second SUM over the bucket window. */
  rateSum(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
  /** Per-second MAX over the bucket window. */
  rateMax(col: ColumnArg<S>, alias: string): MeasureExprFor<S>;
}

/** Trace-only measure extensions. */
export interface TraceMeasureBuilder extends MeasureBuilder<"traces"> {
  /** Fraction of spans with StatusCode=ERROR. */
  errorRate(alias: string): MeasureExprFor<"traces">;
  /** Spans per second over the window. */
  throughput(alias: string): MeasureExprFor<"traces">;
}

export type MeasureBuilderFor<S extends Signal> = S extends "traces"
  ? TraceMeasureBuilder
  : MeasureBuilder<S>;

function makeMeasureBuilder<S extends Signal>(signal: S): MeasureBuilderFor<S> {
  const numericOp =
    (op: string) =>
    (c: ColumnArg<S>, alias: string): MeasureExprFor<S> =>
      ({
        op,
        column: resolveColumn(c, signal),
        as: alias,
      }) as unknown as MeasureExprFor<S>;

  const base: MeasureBuilder<S> = {
    count: (alias: string) =>
      ({ op: "COUNT", as: alias }) as unknown as MeasureExprFor<S>,
    countDistinct: (c, alias) =>
      ({
        op: "COUNT_DISTINCT",
        column: resolveColumn(c, signal),
        as: alias,
      }) as unknown as MeasureExprFor<S>,
    sum: numericOp("SUM"),
    avg: numericOp("AVG"),
    min: numericOp("MIN"),
    max: numericOp("MAX"),
    p50: numericOp("P50"),
    p75: numericOp("P75"),
    p90: numericOp("P90"),
    p95: numericOp("P95"),
    p99: numericOp("P99"),
    p999: numericOp("P999"),
    rateAvg: numericOp("RATE_AVG"),
    rateSum: numericOp("RATE_SUM"),
    rateMax: numericOp("RATE_MAX"),
  };

  if (signal === "traces") {
    return {
      ...base,
      errorRate: (alias: string) =>
        ({
          op: "ERROR_RATE",
          as: alias,
        }) as unknown as MeasureExprFor<"traces">,
      throughput: (alias: string) =>
        ({
          op: "THROUGHPUT",
          as: alias,
        }) as unknown as MeasureExprFor<"traces">,
    } as unknown as MeasureBuilderFor<S>;
  }
  return base as MeasureBuilderFor<S>;
}

// ============================================================
// Internal state
// ============================================================

type TimeDim =
  | { type: "relative"; lookback: string; compareOffset?: string }
  | {
      type: "absolute";
      startTime: string;
      endTime: string;
      compareOffset?: string;
    };

type Output = { type: "summary" } | { type: "timeSeries"; granularity: string };

type OrderEntry =
  | { type: "dimension"; column: ColumnRef; direction: "asc" | "desc" }
  | { type: "measure"; alias: string; direction: "asc" | "desc" };

interface State {
  signal: Signal;
  mode: "aggregate" | "raw";
  measures: readonly unknown[];
  dimensions: readonly unknown[];
  filters: readonly unknown[];
  havings: readonly { measure: string; op: HavingOp; value: number }[];
  orderBy: readonly OrderEntry[];
  timeDimension?: TimeDim;
  output?: Output;
  limit?: number;
  cursor?: string;
}

function initialState(signal: Signal, mode: "aggregate" | "raw"): State {
  return Object.freeze({
    signal,
    mode,
    measures: Object.freeze([]),
    dimensions: Object.freeze([]),
    filters: Object.freeze([]),
    havings: Object.freeze([]),
    orderBy: Object.freeze([]),
  }) as unknown as State;
}

function pruneState(s: State): Record<string, unknown> {
  const out: Record<string, unknown> = {
    signal: s.signal,
    mode: s.mode,
  };
  if (s.measures.length > 0) out.measures = s.measures;
  if (s.dimensions.length > 0) out.dimensions = s.dimensions;
  if (s.filters.length > 0) out.filters = s.filters;
  if (s.havings.length > 0) out.havings = s.havings;
  if (s.orderBy.length > 0) out.orderBy = s.orderBy;
  if (s.timeDimension) out.timeDimension = s.timeDimension;
  if (s.output) out.output = s.output;
  if (s.limit !== undefined) out.limit = s.limit;
  if (s.cursor !== undefined) out.cursor = s.cursor;
  return out;
}

const SCHEMA_MAP = {
  traces: {
    aggregate: kopaiQuery.TraceAggregateQuerySchema,
    raw: kopaiQuery.TraceRawQuerySchema,
  },
  logs: {
    aggregate: kopaiQuery.LogAggregateQuerySchema,
    raw: kopaiQuery.LogRawQuerySchema,
  },
  metrics: {
    aggregate: kopaiQuery.MetricAggregateQuerySchema,
    raw: kopaiQuery.MetricRawQuerySchema,
  },
} as const;

function validateAndReturn(state: State): unknown {
  const schema = SCHEMA_MAP[state.signal][state.mode];
  const result = schema.safeParse(pruneState(state));
  if (!result.success) {
    throw new KopaiQueryBuildError(
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }))
    );
  }
  return result.data;
}

// ============================================================
// Aggregate builder
// ============================================================

/** Aggregate-mode query builder. Use `kq.<signal>.aggregate()` to construct. */
export class AggBuilder<S extends Signal, F extends AggFlags = AggInit> {
  declare private readonly _flags: F;
  private readonly _state: State;
  private readonly _signal: S;

  constructor(signal: S, state?: State) {
    this._signal = signal;
    this._state = state ?? initialState(signal, "aggregate");
  }

  private clone(patch: (s: State) => State): AggBuilder<S, AggFlags> {
    const next = Object.freeze(patch(this._state));
    return new AggBuilder<S, AggFlags>(this._signal, next);
  }

  /** Adds a measure. Repeatable; each call appends. */
  measure(
    fn: (m: MeasureBuilderFor<S>) => MeasureExprFor<S>
  ): AggBuilder<S, WithFlag<F, "measures">> {
    const expr = fn(makeMeasureBuilder(this._signal));
    return this.clone((s) => ({
      ...s,
      measures: Object.freeze([...s.measures, expr]),
    })) as unknown as AggBuilder<S, WithFlag<F, "measures">>;
  }

  /** Adds a GROUP BY column. Repeatable. */
  dimension(col: ColumnArg<S>): AggBuilder<S, F> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      dimensions: Object.freeze([...s.dimensions, ref]),
    })) as unknown as AggBuilder<S, F>;
  }

  /** Adds a pre-aggregation filter (top-level AND with other where calls). */
  where(fn: (f: FilterBuilder<S>) => FilterExprFor<S>): AggBuilder<S, F> {
    const expr = fn(makeFilterBuilder(this._signal));
    return this.clone((s) => ({
      ...s,
      filters: Object.freeze([...s.filters, expr]),
    })) as unknown as AggBuilder<S, F>;
  }

  /** Adds a HAVING clause on a measure alias. */
  having(alias: string, op: HavingOp, value: number): AggBuilder<S, F> {
    return this.clone((s) => ({
      ...s,
      havings: Object.freeze([...s.havings, { measure: alias, op, value }]),
    })) as unknown as AggBuilder<S, F>;
  }

  /** Order by a dimension column. */
  orderByDimension(
    col: ColumnArg<S>,
    direction: "asc" | "desc" = "asc"
  ): AggBuilder<S, F> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "dimension", column: ref, direction },
      ]),
    })) as unknown as AggBuilder<S, F>;
  }

  /** Order by a measure alias. */
  orderByMeasure(
    alias: string,
    direction: "asc" | "desc" = "asc"
  ): AggBuilder<S, F> {
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "measure", alias, direction },
      ]),
    })) as unknown as AggBuilder<S, F>;
  }

  /** Relative time window ending now. */
  timeRelative(
    lookback: string,
    compareOffset?: string
  ): AggBuilder<S, WithFlag<F, "timeDimension">> {
    const td: TimeDim = { type: "relative", lookback };
    if (compareOffset !== undefined) td.compareOffset = compareOffset;
    return this.clone((s) => ({
      ...s,
      timeDimension: td,
    })) as unknown as AggBuilder<S, WithFlag<F, "timeDimension">>;
  }

  /** Absolute ISO-bounded time window. */
  timeAbsolute(
    startTime: string,
    endTime: string,
    compareOffset?: string
  ): AggBuilder<S, WithFlag<F, "timeDimension">> {
    const td: TimeDim = { type: "absolute", startTime, endTime };
    if (compareOffset !== undefined) td.compareOffset = compareOffset;
    return this.clone((s) => ({
      ...s,
      timeDimension: td,
    })) as unknown as AggBuilder<S, WithFlag<F, "timeDimension">>;
  }

  /** One row per group across the full window. */
  summary(): AggBuilder<S, WithFlag<F, "output">> {
    return this.clone((s) => ({
      ...s,
      output: { type: "summary" },
    })) as unknown as AggBuilder<S, WithFlag<F, "output">>;
  }

  /** One row per (group, bucket) where bucket width is `granularity`. */
  timeSeries(granularity: string): AggBuilder<S, WithFlag<F, "output">> {
    return this.clone((s) => ({
      ...s,
      output: { type: "timeSeries", granularity },
    })) as unknown as AggBuilder<S, WithFlag<F, "output">>;
  }

  /** Maximum rows to return (server-side hard cap = 10000). */
  limit(n: number): AggBuilder<S, F> {
    return this.clone((s) => ({ ...s, limit: n })) as unknown as AggBuilder<
      S,
      F
    >;
  }

  /** Finalizes the query. Available only when all required fields are set. */
  build(this: AggBuilder<S, AggReady>): AggregateQueryFor<S> {
    return validateAndReturn(
      (this as unknown as { _state: State })._state
    ) as AggregateQueryFor<S>;
  }
}

// ============================================================
// Raw builder
// ============================================================

/** Raw-mode query builder. Use `kq.<signal>.raw()` to construct. */
export class RawBuilder<S extends Signal, F extends RawFlags = RawInit> {
  declare private readonly _flags: F;
  private readonly _state: State;
  private readonly _signal: S;

  constructor(signal: S, state?: State) {
    this._signal = signal;
    this._state = state ?? initialState(signal, "raw");
  }

  private clone(patch: (s: State) => State): RawBuilder<S, RawFlags> {
    const next = Object.freeze(patch(this._state));
    return new RawBuilder<S, RawFlags>(this._signal, next);
  }

  /** Adds a column to project. Repeatable. */
  dimension(col: ColumnArg<S>): RawBuilder<S, WithFlag<F, "dimensions">> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      dimensions: Object.freeze([...s.dimensions, ref]),
    })) as unknown as RawBuilder<S, WithFlag<F, "dimensions">>;
  }

  /** Adds a filter (top-level AND with other where calls). */
  where(fn: (f: FilterBuilder<S>) => FilterExprFor<S>): RawBuilder<S, F> {
    const expr = fn(makeFilterBuilder(this._signal));
    return this.clone((s) => ({
      ...s,
      filters: Object.freeze([...s.filters, expr]),
    })) as unknown as RawBuilder<S, F>;
  }

  /** Order by a dimension column. */
  orderByDimension(
    col: ColumnArg<S>,
    direction: "asc" | "desc" = "asc"
  ): RawBuilder<S, F> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "dimension", column: ref, direction },
      ]),
    })) as unknown as RawBuilder<S, F>;
  }

  /** Relative time window ending now. */
  timeRelative(
    lookback: string,
    compareOffset?: string
  ): RawBuilder<S, WithFlag<F, "timeDimension">> {
    const td: TimeDim = { type: "relative", lookback };
    if (compareOffset !== undefined) td.compareOffset = compareOffset;
    return this.clone((s) => ({
      ...s,
      timeDimension: td,
    })) as unknown as RawBuilder<S, WithFlag<F, "timeDimension">>;
  }

  /** Absolute ISO-bounded time window. */
  timeAbsolute(
    startTime: string,
    endTime: string,
    compareOffset?: string
  ): RawBuilder<S, WithFlag<F, "timeDimension">> {
    const td: TimeDim = { type: "absolute", startTime, endTime };
    if (compareOffset !== undefined) td.compareOffset = compareOffset;
    return this.clone((s) => ({
      ...s,
      timeDimension: td,
    })) as unknown as RawBuilder<S, WithFlag<F, "timeDimension">>;
  }

  /** Maximum rows to return (server-side hard cap = 10000). */
  limit(n: number): RawBuilder<S, F> {
    return this.clone((s) => ({ ...s, limit: n })) as unknown as RawBuilder<
      S,
      F
    >;
  }

  /** Opaque pagination token from a prior page's response. */
  cursor(token: string): RawBuilder<S, F> {
    return this.clone((s) => ({
      ...s,
      cursor: token,
    })) as unknown as RawBuilder<S, F>;
  }

  /** Finalizes the query. Available only when all required fields are set. */
  build(this: RawBuilder<S, RawReady>): RawQueryFor<S> {
    return validateAndReturn(
      (this as unknown as { _state: State })._state
    ) as RawQueryFor<S>;
  }
}

// ============================================================
// Entry namespace
// ============================================================

/** Entry point for building `KopaiQuery` instances with progressive type-checking. */
export const kq = {
  traces: {
    /** Aggregate query over traces (spans). */
    aggregate: () => new AggBuilder<"traces">("traces"),
    /** Raw span search. */
    raw: () => new RawBuilder<"traces">("traces"),
  },
  logs: {
    /** Aggregate query over logs. */
    aggregate: () => new AggBuilder<"logs">("logs"),
    /** Raw log search. */
    raw: () => new RawBuilder<"logs">("logs"),
  },
  metrics: {
    /** Aggregate query over metric data points. */
    aggregate: () => new AggBuilder<"metrics">("metrics"),
    /** Raw metric data-point search. */
    raw: () => new RawBuilder<"metrics">("metrics"),
  },
};
