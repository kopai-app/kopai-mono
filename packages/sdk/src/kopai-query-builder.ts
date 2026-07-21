import { kopaiQuery, kopaiQueryCompiler } from "@kopai/core";
import type { z } from "zod";

// ============================================================
// Public types
// ============================================================

export type Signal = "traces" | "logs" | "metrics";

/** Human-readable duration string, e.g. "30s", "2h", "7d". */
export type DurationString = kopaiQuery.DurationString;

/**
 * A duration-comparison value: nanoseconds as a number (as before)
 * OR a duration string ("1s", "2h") that the build step transforms to
 * nanoseconds. Used by gt/gte/lt/lte so callers need not hardcode 1_000_000_000.
 */
export type DurationValue = number | DurationString;

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

/** The five OTel metric types, as a builder argument. */
export type MetricType = kopaiQuery.MetricType;

// ============================================================
// Per-MetricType structural-column narrowing
// ============================================================
// Each MetricType is stored in its own table holding only that variant's
// structural columns. Referencing another type's column (e.g. "Min" on a
// Gauge query) is rejected at build time by validateKopaiQuery; pinning the
// MetricType lifts that to a COMPILE error by narrowing the metric column
// surface to the chosen type's columns.
//
// Source of truth: METRIC_STRUCTURAL_COLUMNS_BY_TYPE in core. These literal
// unions are asserted equal to it by a runtime test, so drift fails CI.

/** Metric structural columns shared by every MetricType (the base table). */
type MetricCommonColumn =
  | "TimeUnix"
  | "StartTimeUnix"
  | "MetricName"
  | "MetricDescription"
  | "MetricUnit"
  | "MetricType"
  | "ScopeName"
  | "ScopeVersion"
  | "ScopeSchemaUrl"
  | "ResourceSchemaUrl";

/** Type-discriminating structural columns, per MetricType. */
type MetricTypeSpecificColumn<M extends MetricType> = M extends "Gauge"
  ? "Value" | "Flags"
  : M extends "Sum"
    ? "Value" | "Flags" | "AggregationTemporality" | "IsMonotonic"
    : M extends "Histogram"
      ?
          | "Count"
          | "Sum"
          | "Min"
          | "Max"
          | "BucketCounts"
          | "ExplicitBounds"
          | "AggregationTemporality"
      : M extends "ExponentialHistogram"
        ?
            | "Count"
            | "Sum"
            | "Min"
            | "Max"
            | "Scale"
            | "ZeroCount"
            | "PositiveBucketCounts"
            | "PositiveOffset"
            | "NegativeBucketCounts"
            | "NegativeOffset"
            | "AggregationTemporality"
        : M extends "Summary"
          ?
              | "Count"
              | "Sum"
              | "ValueAtQuantiles.Quantile"
              | "ValueAtQuantiles.Value"
          : never;

/** All structural columns available on a given MetricType's table. */
type MetricStructuralColumnFor<M extends MetricType> =
  | MetricCommonColumn
  | MetricTypeSpecificColumn<M>;

/**
 * Every metric structural column across all types (the PascalCase members
 * of the query-exposed MetricColumn enum). Anything in MetricColumn that is
 * NOT a structural column is a semantic-convention attribute, which exists
 * on every metric table and is always valid.
 */
type AllMetricStructuralColumn = MetricStructuralColumnFor<MetricType>;

/**
 * Metric columns valid for a query pinned to MetricType `M`: every
 * semantic-convention attribute (those exist on all tables) plus the
 * structural columns of `M`. Other types' structural columns are excluded —
 * using one is a compile error.
 */
type MetricColumnFor<M extends MetricType> =
  | Exclude<MetricColumn, AllMetricStructuralColumn>
  | Extract<MetricColumn, MetricStructuralColumnFor<M>>;

export type ColumnArg<
  S extends Signal,
  M extends MetricType = MetricType,
> = S extends "traces"
  ? TraceColumn | AttrRef<TraceAttrContainer>
  : S extends "logs"
    ? LogColumn | AttrRef<LogAttrContainer>
    : S extends "metrics"
      ? MetricColumnFor<M> | AttrRef<MetricAttrContainer>
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

type RawFlags = { timeDimension: boolean };
type RawInit = { timeDimension: false };
export type RawReady = { timeDimension: true };

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

const TOP_LEVEL_COLUMN_SET: Record<Signal, ReadonlySet<string>> = {
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

function isAttrRef(
  input: unknown
): input is { container: string; key: string } {
  if (typeof input !== "object" || input === null) return false;
  if (!("container" in input) || !("key" in input)) return false;
  return typeof input.container === "string" && typeof input.key === "string";
}

function resolveColumn(input: unknown, signal: Signal): ColumnRef {
  if (typeof input === "object" && input !== null) {
    if (!isAttrRef(input)) {
      throw new TypeError(
        `Column object must have { container: string, key: string }`
      );
    }
    return input;
  }
  if (typeof input !== "string") {
    throw new TypeError(`Column must be a string or attr-ref object`);
  }
  if (TOP_LEVEL_COLUMN_SET[signal].has(input)) return input;
  return { container: inferContainer(input, signal), key: input };
}

// ============================================================
// Enum-valued column literal unions
// ============================================================
// The stored, canonical OTel string forms. Mirrors STATUS_CODE_NAMES /
// SPAN_KIND_NAMES in kopai-query-compiler.ts and MetricType in core. A
// runtime test asserts these literal unions stay in sync with those
// constants so drift fails CI.

/** Stored StatusCode values (traces). */
export type StatusCodeValue = "Unset" | "Ok" | "Error";
/** Stored SpanKind values (traces). */
export type SpanKindValue =
  | "Unspecified"
  | "Internal"
  | "Server"
  | "Client"
  | "Producer"
  | "Consumer";

// Per-signal map from an enum-valued column literal to its allowed value
// union. Used to (a) require the exact literals on eq/neq/in and (b) carve
// those columns out of the wide fallback overload.
type EnumColumnValueMap<S extends Signal> = S extends "traces"
  ? { StatusCode: StatusCodeValue; SpanKind: SpanKindValue }
  : S extends "metrics"
    ? { MetricType: MetricType }
    : Record<never, never>;

type EnumColumnName<S extends Signal> = keyof EnumColumnValueMap<S> & string;

// Wide-fallback column arg: every column EXCEPT the enum-valued ones, which
// have dedicated literal-union overloads above the fallback.
type NonEnumColumnArg<S extends Signal, M extends MetricType> = Exclude<
  ColumnArg<S, M>,
  EnumColumnName<S>
>;

// ============================================================
// Filter DSL
// ============================================================

/** DSL for building per-signal filter expressions. */
export interface FilterBuilder<
  S extends Signal,
  M extends MetricType = MetricType,
> {
  /** AND-combines children. */
  and(...children: FilterExprFor<S>[]): FilterExprFor<S>;
  /** OR-combines children. */
  or(...children: FilterExprFor<S>[]): FilterExprFor<S>;
  /** Equality filter. Enum-valued columns require the exact stored literal. */
  eq<C extends EnumColumnName<S>>(
    col: C,
    value: EnumColumnValueMap<S>[C]
  ): FilterExprFor<S>;
  eq(col: NonEnumColumnArg<S, M>, value: string): FilterExprFor<S>;
  eq(col: NonEnumColumnArg<S, M>, value: number): FilterExprFor<S>;
  eq(col: NonEnumColumnArg<S, M>, value: boolean): FilterExprFor<S>;
  /** Inequality filter. Enum-valued columns require the exact stored literal. */
  neq<C extends EnumColumnName<S>>(
    col: C,
    value: EnumColumnValueMap<S>[C]
  ): FilterExprFor<S>;
  neq(col: NonEnumColumnArg<S, M>, value: string): FilterExprFor<S>;
  neq(col: NonEnumColumnArg<S, M>, value: number): FilterExprFor<S>;
  neq(col: NonEnumColumnArg<S, M>, value: boolean): FilterExprFor<S>;
  contains(col: ColumnArg<S, M>, value: string): FilterExprFor<S>;
  notContains(col: ColumnArg<S, M>, value: string): FilterExprFor<S>;
  startsWith(col: ColumnArg<S, M>, value: string): FilterExprFor<S>;
  endsWith(col: ColumnArg<S, M>, value: string): FilterExprFor<S>;
  /** Membership filter. Enum-valued columns require the exact stored literals. */
  in<C extends EnumColumnName<S>>(
    col: C,
    values: EnumColumnValueMap<S>[C][]
  ): FilterExprFor<S>;
  in(col: NonEnumColumnArg<S, M>, values: string[]): FilterExprFor<S>;
  in(col: NonEnumColumnArg<S, M>, values: number[]): FilterExprFor<S>;
  notIn(col: ColumnArg<S, M>, values: string[] | number[]): FilterExprFor<S>;
  gt(col: ColumnArg<S, M>, value: DurationValue): FilterExprFor<S>;
  gte(col: ColumnArg<S, M>, value: DurationValue): FilterExprFor<S>;
  lt(col: ColumnArg<S, M>, value: DurationValue): FilterExprFor<S>;
  lte(col: ColumnArg<S, M>, value: DurationValue): FilterExprFor<S>;
  isNull(col: ColumnArg<S, M>): FilterExprFor<S>;
  isNotNull(col: ColumnArg<S, M>): FilterExprFor<S>;
}

function makeFilterBuilder<S extends Signal, M extends MetricType>(
  signal: S
): FilterBuilder<S, M> {
  const col = (c: ColumnArg<S, M>) => resolveColumn(c, signal);

  const stringOp = (op: string) => (c: ColumnArg<S, M>, value: string) =>
    ({ column: col(c), op, value }) as unknown as FilterExprFor<S>;

  // gt/gte/lt/lte accept a number (ns) or a DurationString ("1s", "2h"),
  // normalized to nanoseconds here via core's durationStringToNanos.
  // A non-duration string passes through unchanged so the numeric schema in
  // build() surfaces a clear KopaiQueryBuildError.
  const durationOp =
    (op: string) => (c: ColumnArg<S, M>, value: DurationValue) =>
      ({
        column: col(c),
        op,
        value:
          typeof value === "string"
            ? kopaiQuery.durationStringToNanos(value)
            : value,
      }) as unknown as FilterExprFor<S>;

  const inOp =
    (op: "in" | "notIn") =>
    (c: ColumnArg<S, M>, values: string[] | number[]): FilterExprFor<S> =>
      ({ column: col(c), op, values }) as unknown as FilterExprFor<S>;

  const eq = (c: ColumnArg<S, M>, value: string | number | boolean) =>
    ({ column: col(c), op: "eq", value }) as unknown as FilterExprFor<S>;
  const neq = (c: ColumnArg<S, M>, value: string | number | boolean) =>
    ({ column: col(c), op: "neq", value }) as unknown as FilterExprFor<S>;

  const nullOp = (op: "isNull" | "isNotNull") => (c: ColumnArg<S, M>) =>
    ({ column: col(c), op }) as unknown as FilterExprFor<S>;

  const and = (...children: FilterExprFor<S>[]) =>
    ({ and: children }) as unknown as FilterExprFor<S>;
  const or = (...children: FilterExprFor<S>[]) =>
    ({ or: children }) as unknown as FilterExprFor<S>;

  return {
    and,
    or,
    eq: eq as FilterBuilder<S, M>["eq"],
    neq: neq as FilterBuilder<S, M>["neq"],
    contains: stringOp("contains"),
    notContains: stringOp("notContains"),
    startsWith: stringOp("startsWith"),
    endsWith: stringOp("endsWith"),
    in: inOp("in") as FilterBuilder<S, M>["in"],
    notIn: inOp("notIn"),
    gt: durationOp("gt"),
    gte: durationOp("gte"),
    lt: durationOp("lt"),
    lte: durationOp("lte"),
    isNull: nullOp("isNull"),
    isNotNull: nullOp("isNotNull"),
  };
}

// ============================================================
// Measure DSL
// ============================================================

/**
 * A measure expression branded with the alias literal `A` it
 * defines. `__alias` is a TYPE-ONLY phantom — never written to the runtime
 * object — so the literal alias flows out of the `.measure(m => …)` callback
 * and `.build()` can map each alias to `number` in the result-row type. The
 * runtime value is exactly a `MeasureExprFor<S>` (it structurally satisfies
 * the optional `__alias`), so `kopaiQuery.*.parse()` is unaffected.
 */
export type MeasureExpr<
  S extends Signal,
  A extends string = string,
> = MeasureExprFor<S> & { readonly __alias?: A };

/** Extracts the branded alias literal from a `MeasureExpr<S, A>`. */
type AliasOf<E> = E extends { __alias?: infer A extends string } ? A : never;

/**
 * Per-signal measure builder. For metrics, `M` narrows the numeric-column
 * argument to the structural columns that exist on the chosen MetricType's
 * table — e.g. `m.avg("Value")` on Gauge, `m.max("Max")` on Histogram.
 *
 * Each op is generic over its `alias` literal `A`: the alias type
 * flows out via the branded `MeasureExpr<S, A>` return so `.measure()` can
 * accumulate it and `.build()` types `data[0].<alias>` as `number`.
 */
export interface MeasureBuilder<
  S extends Signal,
  M extends MetricType = MetricType,
> {
  /** COUNT(*) under `alias`. */
  count<A extends string>(alias: A): MeasureExpr<S, A>;
  /** Approximate distinct count of `col`. */
  countDistinct<A extends string>(
    col: ColumnArg<S, M>,
    alias: A
  ): MeasureExpr<S, A>;
  /** SUM aggregation over a numeric column. */
  sum<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** AVG aggregation over a numeric column. */
  avg<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** MIN aggregation over a numeric column. */
  min<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** MAX aggregation over a numeric column. */
  max<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 50th percentile of a numeric column. */
  p50<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 75th percentile of a numeric column. */
  p75<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 90th percentile of a numeric column. */
  p90<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 95th percentile of a numeric column. */
  p95<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 99th percentile of a numeric column. */
  p99<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** 99.9th percentile of a numeric column. */
  p999<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** Per-second AVG over the bucket window. */
  rateAvg<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** Per-second SUM over the bucket window. */
  rateSum<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
  /** Per-second MAX over the bucket window. */
  rateMax<A extends string>(col: ColumnArg<S, M>, alias: A): MeasureExpr<S, A>;
}

/** Trace-only measure extensions. */
export interface TraceMeasureBuilder extends MeasureBuilder<"traces"> {
  /** Fraction of spans with StatusCode=ERROR. */
  errorRate<A extends string>(alias: A): MeasureExpr<"traces", A>;
  /** Spans per second over the window. */
  throughput<A extends string>(alias: A): MeasureExpr<"traces", A>;
}

export type MeasureBuilderFor<
  S extends Signal,
  M extends MetricType = MetricType,
> = S extends "traces" ? TraceMeasureBuilder : MeasureBuilder<S, M>;

function makeMeasureBuilder<S extends Signal, M extends MetricType>(
  signal: S
): MeasureBuilderFor<S, M> {
  // `as` is the runtime alias; the branded `__alias` is type-only and never
  // emitted, so the returned value is exactly a MeasureExprFor<S>.
  const numericOp =
    (op: string) =>
    <A extends string>(c: ColumnArg<S, M>, alias: A): MeasureExpr<S, A> =>
      ({
        op,
        column: resolveColumn(c, signal),
        as: alias,
      }) as unknown as MeasureExpr<S, A>;

  const base: MeasureBuilder<S, M> = {
    count: <A extends string>(alias: A) =>
      ({ op: "COUNT", as: alias }) as unknown as MeasureExpr<S, A>,
    countDistinct: <A extends string>(c: ColumnArg<S, M>, alias: A) =>
      ({
        op: "COUNT_DISTINCT",
        column: resolveColumn(c, signal),
        as: alias,
      }) as unknown as MeasureExpr<S, A>,
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
      errorRate: <A extends string>(alias: A) =>
        ({
          op: "ERROR_RATE",
          as: alias,
        }) as unknown as MeasureExpr<"traces", A>,
      throughput: <A extends string>(alias: A) =>
        ({
          op: "THROUGHPUT",
          as: alias,
        }) as unknown as MeasureExpr<"traces", A>,
    } as unknown as MeasureBuilderFor<S, M>;
  }
  return base as MeasureBuilderFor<S, M>;
}

// ============================================================
// Internal state
// ============================================================

type TimeDim =
  | { type: "relative"; lookback: string }
  | { type: "absolute"; startTime: string; endTime: string };

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

function initialState(
  signal: Signal,
  mode: "aggregate" | "raw",
  // Metric queries auto-emit the MetricType pin as the first top-level
  // (AND) filter so build()/validateKopaiQuery pass without a manual
  // .where(eq("MetricType", …)).
  metricType?: MetricType
): State {
  const state: State = {
    signal,
    mode,
    measures: [],
    dimensions: [],
    filters: metricType
      ? Object.freeze([
          { column: "MetricType", op: "eq", value: metricType } as const,
        ])
      : [],
    havings: [],
    orderBy: [],
  };
  return Object.freeze(state);
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

function validateAndReturn<T>(state: State): T {
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
  // Cross-field semantic checks the Zod schema can't express (required
  // MetricType filter, having/orderBy alias + dimension references, numeric
  // column typing). Surface them locally as a build error instead of letting
  // the query round-trip to a server 400.
  try {
    kopaiQueryCompiler.validateKopaiQuery(result.data as kopaiQuery.KopaiQuery);
  } catch (e) {
    throw new KopaiQueryBuildError([
      { path: "", message: e instanceof Error ? e.message : String(e) },
    ]);
  }
  // WHY: SCHEMA_MAP returns a union of schemas; TS cannot prove the inferred
  // output narrows to the caller's T (AggregateQueryFor<S> / RawQueryFor<S>).
  // The (signal, mode) -> schema mapping is the source of truth.
  return result.data as T;
}

// ============================================================
// Aggregate builder
// ============================================================

// Only string-literal dimension columns become a typed row key.
// An attr-ref `{ container, key }` dimension is keyed at runtime as a computed
// "<container>.<key>" the static type can't name, so it widens out of `Dims`
// and is NOT present on the branded row type. The branded row is exact (no
// index signature) — that strictness is deliberate, so a typo on a measure
// alias is a compile error — but it also means a grouped-by attr-ref column is
// unreachable by its computed key at the type level. Group by a string-literal
// column when you need that key statically, or index the row through the wide
// `KopaiAggregateRow` shape.
type DimKeyOf<C> = C extends string ? C : never;

// Output kind the builder has been put into. Tracked so the row marker can
// fold in the timeSeries `bucket_start` key. `"none"` = output not yet set
// (build() is unavailable then anyway). The marker is only materialized at
// build(), where the output flag is guaranteed set.
type OutKind = "summary" | "timeSeries" | "none";

// Type-only row marker. Built into `.build()`'s return type so
// core's AggregateResultFor can read it. Every measure alias maps to
// `number` (count/sum/avg/min/max/p*/rate*/errorRate/throughput all return
// a numeric value); every string-literal dimension stays string|number|null
// (group-by keys are not over-narrowed). timeSeries output adds a
// `bucket_start: string` key (the builder doesn't statically narrow the
// query's `output.type`, so the marker carries it directly). Never a runtime
// property.
type AggRowMarker<
  Aliases extends string,
  Dims extends string,
  Out extends OutKind,
> = {
  readonly __aggRow?: { [K in Aliases]: number } & {
    [K in Dims]: string | number | null;
  } & (Out extends "timeSeries" ? { bucket_start: string } : object);
};

/**
 * Aggregate-mode query builder. Construct via `kq.traces.aggregate()`,
 * `kq.logs.aggregate()`, or `kq.metrics("Gauge").aggregate()`. For metrics,
 * `M` is the chosen MetricType: the value-column surface narrows to that
 * type's columns and the MetricType pin filter is auto-emitted.
 *
 * `Aliases`/`Dims` accumulate the measure-alias and dimension-column literals
 * seen so far; `.build()` folds them into a phantom row marker so the
 * result row of a built query is `{ [alias]: number } & { [dim]: string|
 * number|null }`.
 */
export class AggBuilder<
  S extends Signal,
  F extends AggFlags = AggInit,
  M extends MetricType = MetricType,
  Aliases extends string = never,
  Dims extends string = never,
  Out extends OutKind = "none",
> {
  declare private readonly _flags: F;
  private readonly _state: State;
  private readonly _signal: S;

  constructor(signal: S, state?: State) {
    this._signal = signal;
    this._state = state ?? initialState(signal, "aggregate");
  }

  // Generic over the resulting flag type F2 so each method names the phantom
  // flag it advances to and gets that builder type back with no cast. The
  // phantom `_flags` field is `declare`d (erased at runtime), so constructing
  // `AggBuilder<S, F2>` for any F2 is purely a compile-time relabel of the same
  // frozen state. Defaults to F for methods that don't change required-field
  // tracking (dimension/where/having/orderBy/limit). M, Aliases, Dims, Out are
  // carried through; measure()/dimension() widen Aliases/Dims and
  // summary()/timeSeries() set Out.
  private clone<
    F2 extends AggFlags = F,
    A2 extends string = Aliases,
    D2 extends string = Dims,
    O2 extends OutKind = Out,
  >(patch: (s: State) => State): AggBuilder<S, F2, M, A2, D2, O2> {
    const next = Object.freeze(patch(this._state));
    return new AggBuilder<S, F2, M, A2, D2, O2>(this._signal, next);
  }

  /** Adds a measure. Repeatable; each call appends. */
  measure<E extends MeasureExpr<S>>(
    fn: (m: MeasureBuilderFor<S, M>) => E
  ): AggBuilder<
    S,
    WithFlag<F, "measures">,
    M,
    Aliases | AliasOf<E>,
    Dims,
    Out
  > {
    const expr = fn(makeMeasureBuilder<S, M>(this._signal));
    return this.clone<WithFlag<F, "measures">, Aliases | AliasOf<E>, Dims, Out>(
      (s) => ({
        ...s,
        measures: Object.freeze([...s.measures, expr]),
      })
    );
  }

  /** Adds a GROUP BY column. Repeatable. */
  dimension<C extends ColumnArg<S, M>>(
    col: C
  ): AggBuilder<S, F, M, Aliases, Dims | DimKeyOf<C>, Out> {
    const ref = resolveColumn(col, this._signal);
    return this.clone<F, Aliases, Dims | DimKeyOf<C>, Out>((s) => ({
      ...s,
      dimensions: Object.freeze([...s.dimensions, ref]),
    }));
  }

  /** Adds a pre-aggregation filter (top-level AND with other where calls). */
  where(
    fn: (f: FilterBuilder<S, M>) => FilterExprFor<S>
  ): AggBuilder<S, F, M, Aliases, Dims, Out> {
    const expr = fn(makeFilterBuilder<S, M>(this._signal));
    return this.clone((s) => ({
      ...s,
      filters: Object.freeze([...s.filters, expr]),
    }));
  }

  /** Adds a HAVING clause on a measure alias. */
  having(
    alias: string,
    op: HavingOp,
    value: number
  ): AggBuilder<S, F, M, Aliases, Dims, Out> {
    return this.clone((s) => ({
      ...s,
      havings: Object.freeze([...s.havings, { measure: alias, op, value }]),
    }));
  }

  /** Order by a dimension column. */
  orderByDimension(
    col: ColumnArg<S, M>,
    direction: "asc" | "desc" = "asc"
  ): AggBuilder<S, F, M, Aliases, Dims, Out> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "dimension", column: ref, direction },
      ]),
    }));
  }

  /** Order by a measure alias. */
  orderByMeasure(
    alias: string,
    direction: "asc" | "desc" = "asc"
  ): AggBuilder<S, F, M, Aliases, Dims, Out> {
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "measure", alias, direction },
      ]),
    }));
  }

  /** Relative time window ending now. */
  timeRelative(
    lookback: string
  ): AggBuilder<S, WithFlag<F, "timeDimension">, M, Aliases, Dims, Out> {
    const td: TimeDim = { type: "relative", lookback };
    return this.clone<WithFlag<F, "timeDimension">>((s) => ({
      ...s,
      timeDimension: td,
    }));
  }

  /** Absolute ISO-bounded time window. */
  timeAbsolute(
    startTime: string,
    endTime: string
  ): AggBuilder<S, WithFlag<F, "timeDimension">, M, Aliases, Dims, Out> {
    const td: TimeDim = { type: "absolute", startTime, endTime };
    return this.clone<WithFlag<F, "timeDimension">>((s) => ({
      ...s,
      timeDimension: td,
    }));
  }

  /** One row per group across the full window. */
  summary(): AggBuilder<S, WithFlag<F, "output">, M, Aliases, Dims, "summary"> {
    return this.clone<WithFlag<F, "output">, Aliases, Dims, "summary">((s) => ({
      ...s,
      output: { type: "summary" },
    }));
  }

  /** One row per (group, bucket) where bucket width is `granularity`. */
  timeSeries(
    granularity: string
  ): AggBuilder<S, WithFlag<F, "output">, M, Aliases, Dims, "timeSeries"> {
    return this.clone<WithFlag<F, "output">, Aliases, Dims, "timeSeries">(
      (s) => ({
        ...s,
        output: { type: "timeSeries", granularity },
      })
    );
  }

  /** Maximum rows to return (server-side hard cap = 10000). */
  limit(n: number): AggBuilder<S, F, M, Aliases, Dims, Out> {
    return this.clone((s) => ({ ...s, limit: n }));
  }

  /**
   * Finalizes the query. Available only when all required fields are set.
   *
   * The return type is the per-signal aggregate query INTERSECTED with a
   * type-only `__aggRow` marker: `{ [alias]: number } & { [dim]:
   * string|number|null }` (plus `bucket_start: string` for timeSeries
   * output). core's `AggregateResultFor` reads this marker so
   * `client.query(...).data[0].<alias>` is `number` with no cast. The marker
   * is never written to the runtime value — the returned object is exactly an
   * `AggregateQueryFor<S>` and still passes `kopaiQuery.KopaiQuery.parse()`.
   */
  build(
    this: AggBuilder<S, AggReady, M, Aliases, Dims, Out>
  ): AggregateQueryFor<S> & AggRowMarker<Aliases, Dims, Out> {
    return validateAndReturn<AggregateQueryFor<S>>(
      this._state
    ) as AggregateQueryFor<S> & AggRowMarker<Aliases, Dims, Out>;
  }
}

// ============================================================
// Raw builder
// ============================================================

/**
 * Raw-mode query builder. Construct via `kq.traces.raw()`, `kq.logs.raw()`,
 * or `kq.metrics("Gauge").raw()`. For metrics, `M` is the chosen MetricType:
 * the column surface narrows to that type's columns and the MetricType pin
 * filter is auto-emitted.
 */
export class RawBuilder<
  S extends Signal,
  F extends RawFlags = RawInit,
  M extends MetricType = MetricType,
> {
  declare private readonly _flags: F;
  private readonly _state: State;
  private readonly _signal: S;

  constructor(signal: S, state?: State) {
    this._signal = signal;
    this._state = state ?? initialState(signal, "raw");
  }

  // Generic over the resulting flag type F2 (see AggBuilder.clone). Defaults to
  // F for methods that don't advance required-field tracking. M is carried.
  private clone<F2 extends RawFlags = F>(
    patch: (s: State) => State
  ): RawBuilder<S, F2, M> {
    const next = Object.freeze(patch(this._state));
    return new RawBuilder<S, F2, M>(this._signal, next);
  }

  /** Adds a column to project. Repeatable. Omit entirely to receive the full denormalized row. */
  dimension(col: ColumnArg<S, M>): RawBuilder<S, F, M> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      dimensions: Object.freeze([...s.dimensions, ref]),
    }));
  }

  /** Adds a filter (top-level AND with other where calls). */
  where(fn: (f: FilterBuilder<S, M>) => FilterExprFor<S>): RawBuilder<S, F, M> {
    const expr = fn(makeFilterBuilder<S, M>(this._signal));
    return this.clone((s) => ({
      ...s,
      filters: Object.freeze([...s.filters, expr]),
    }));
  }

  /** Order by a dimension column. */
  orderByDimension(
    col: ColumnArg<S, M>,
    direction: "asc" | "desc" = "asc"
  ): RawBuilder<S, F, M> {
    const ref = resolveColumn(col, this._signal);
    return this.clone((s) => ({
      ...s,
      orderBy: Object.freeze([
        ...s.orderBy,
        { type: "dimension", column: ref, direction },
      ]),
    }));
  }

  /** Relative time window ending now. */
  timeRelative(
    lookback: string
  ): RawBuilder<S, WithFlag<F, "timeDimension">, M> {
    const td: TimeDim = { type: "relative", lookback };
    return this.clone<WithFlag<F, "timeDimension">>((s) => ({
      ...s,
      timeDimension: td,
    }));
  }

  /** Absolute ISO-bounded time window. */
  timeAbsolute(
    startTime: string,
    endTime: string
  ): RawBuilder<S, WithFlag<F, "timeDimension">, M> {
    const td: TimeDim = { type: "absolute", startTime, endTime };
    return this.clone<WithFlag<F, "timeDimension">>((s) => ({
      ...s,
      timeDimension: td,
    }));
  }

  /** Maximum rows to return (server-side hard cap = 10000). */
  limit(n: number): RawBuilder<S, F, M> {
    return this.clone((s) => ({ ...s, limit: n }));
  }

  /** Opaque pagination token from a prior page's response. */
  cursor(token: string): RawBuilder<S, F, M> {
    return this.clone((s) => ({
      ...s,
      cursor: token,
    }));
  }

  /** Finalizes the query. Available only when all required fields are set. */
  build(this: RawBuilder<S, RawReady, M>): RawQueryFor<S> {
    return validateAndReturn<RawQueryFor<S>>(this._state);
  }
}

// ============================================================
// Entry namespace
// ============================================================

/** Per-MetricType entry for metric queries. */
export interface MetricsEntry<M extends MetricType> {
  /** Aggregate query over this MetricType's data points. */
  aggregate(): AggBuilder<"metrics", AggInit, M>;
  /** Raw data-point search over this MetricType. */
  raw(): RawBuilder<"metrics", RawInit, M>;
}

/**
 * Metrics entry. `kq.metrics("Gauge")` pins the MetricType — the pin
 * filter is auto-emitted into the built query and the value-column surface
 * narrows to that type's columns (so `m.avg("Value")` vs `m.max("Max")` is a
 * compile-time choice).
 */
function metrics<M extends MetricType>(type: M): MetricsEntry<M> {
  return {
    aggregate: () =>
      new AggBuilder<"metrics", AggInit, M>(
        "metrics",
        initialState("metrics", "aggregate", type)
      ),
    raw: () =>
      new RawBuilder<"metrics", RawInit, M>(
        "metrics",
        initialState("metrics", "raw", type)
      ),
  };
}

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
  /**
   * Metric queries. Call with the MetricType:
   * `kq.metrics("Gauge").aggregate()` / `kq.metrics("Histogram").raw()`.
   */
  metrics,
};
