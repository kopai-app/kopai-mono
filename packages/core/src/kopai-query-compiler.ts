// Backend-agnostic helpers for compiling a KopaiQuery into SQL bits.
// Each datasource (sqlite, clickhouse) wraps these with its own dialect.

import {
  LogColumn,
  METRIC_STRUCTURAL_COLUMNS_BY_TYPE,
  METRIC_TYPES,
  MetricColumn,
  NUMERIC_STRUCTURAL_COLUMNS,
  Signal,
  TraceColumn,
  type FilterExpr,
  type KopaiQuery,
  type LogColumnRef,
  type MetricColumnRef,
  type MetricType,
  type TraceColumnRef,
} from "./kopai-query.js";

// Union of every per-signal narrow column ref — used by internal
// walkers that need to introspect filter/order/measure column values.
export type AnyColumnRef = TraceColumnRef | LogColumnRef | MetricColumnRef;
export type AnyFilterExpr = FilterExpr<AnyColumnRef>;

// Structural shape of a column ref. Wider than AnyColumnRef so the
// public helpers (resolveColumn, columnRefProjectionKey) accept any
// caller's narrow union variant without a cast. Validation that the
// string is a known column/semconv name is performed at the zod layer.
export type ColumnRefStructural = string | { container: string; key: string };

// ============================================================
// KopaiQueryValidationError
// ============================================================

export class KopaiQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KopaiQueryValidationError";
  }
}

// ============================================================
// Time window resolution
// ============================================================

type DurationUnit = "s" | "m" | "h" | "d" | "w";

const DURATION_UNIT_NS: Record<DurationUnit, bigint> = {
  s: 1_000_000_000n,
  m: 60n * 1_000_000_000n,
  h: 60n * 60n * 1_000_000_000n,
  d: 24n * 60n * 60n * 1_000_000_000n,
  w: 7n * 24n * 60n * 60n * 1_000_000_000n,
};

const DURATION_UNIT_S: Record<DurationUnit, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

function isDurationUnit(s: string): s is DurationUnit {
  return s === "s" || s === "m" || s === "h" || s === "d" || s === "w";
}

function parseDurationParts(s: string): { value: bigint; unit: DurationUnit } {
  const m = /^(\d+)([smhdw])$/.exec(s);
  // Regex captures are typed as `string | undefined`, but a successful
  // match of /^(\d+)([smhdw])$/ guarantees both groups — narrow via
  // explicit checks instead of `!`.
  if (!m || m[1] === undefined || m[2] === undefined || !isDurationUnit(m[2])) {
    throw new KopaiQueryValidationError(
      `Invalid duration "${s}". Expected positive integer + unit (s,m,h,d,w).`
    );
  }
  const value = BigInt(m[1]);
  if (value === 0n) {
    throw new KopaiQueryValidationError(
      `Invalid duration "${s}". Expected positive integer + unit (s,m,h,d,w).`
    );
  }
  return { value, unit: m[2] };
}

export function durationToNanos(s: string): bigint {
  const { value, unit } = parseDurationParts(s);
  return value * DURATION_UNIT_NS[unit];
}

export function granularityToSeconds(s: string): number {
  const { value, unit } = parseDurationParts(s);
  return Number(value) * DURATION_UNIT_S[unit];
}

function isoToNanos(iso: string): bigint {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new KopaiQueryValidationError(`Invalid ISO datetime "${iso}".`);
  }
  // Date.parse only gives ms precision; pad with zeros to ns.
  return BigInt(ms) * 1_000_000n;
}

export interface CompiledTimeWindow {
  startNs: bigint;
  endNs: bigint;
}

export function compileTimeWindow(
  td: KopaiQuery["timeDimension"],
  now: Date = new Date()
): CompiledTimeWindow {
  let startNs: bigint;
  let endNs: bigint;
  if (td.type === "relative") {
    endNs = BigInt(now.getTime()) * 1_000_000n;
    startNs = endNs - durationToNanos(td.lookback);
  } else {
    startNs = isoToNanos(td.startTime);
    endNs = isoToNanos(td.endTime);
    if (endNs <= startNs) {
      throw new KopaiQueryValidationError(
        `Time window endTime (${td.endTime}) must be after startTime (${td.startTime}).`
      );
    }
  }
  return { startNs, endNs };
}

// ============================================================
// Backend-shared SQL building blocks
// ============================================================
// Constants and helpers that both the sqlite and clickhouse executors
// need. Keeping them here means a literal (StatusCode value, table
// name, comparator map) lives in exactly one place.

// Canonical OTel string forms — the representation the OpenTelemetry
// ClickHouse exporter writes (Go's `status.Code().String()` /
// `span.Kind().String()`). This is the single source of truth for stored
// StatusCode / SpanKind values across ALL backends; the sqlite write path
// must emit these same forms so a KopaiQuery is portable across backends.
// Indexed by the OTLP proto enum number.
export const STATUS_CODE_NAMES = ["Unset", "Ok", "Error"] as const;
export const SPAN_KIND_NAMES = [
  "Unspecified",
  "Internal",
  "Server",
  "Client",
  "Producer",
  "Consumer",
] as const;

/** Canonical stored StatusCode string for an OTLP status code number. */
export function statusCodeName(code: number | undefined): string {
  return code === undefined ? "" : (STATUS_CODE_NAMES[code] ?? "");
}

/** Canonical stored SpanKind string for an OTLP span kind number. */
export function spanKindName(kind: number | undefined): string {
  return kind === undefined ? "" : (SPAN_KIND_NAMES[kind] ?? "");
}

export const STATUS_CODE_ERROR_LITERAL = "Error";

export function timeColumnForSignal(signal: Signal): "TimeUnix" | "Timestamp" {
  return signal === "metrics" ? "TimeUnix" : "Timestamp";
}

// Temporal structural columns per signal. Stored as nanosecond integers, so
// numeric comparison filters on them are valid (used by the numeric-op
// validation below to avoid rejecting legitimate time-bound filters).
const TIME_STRUCTURAL_COLUMNS: Record<Signal, ReadonlySet<string>> = {
  traces: new Set(["Timestamp"]),
  logs: new Set(["Timestamp"]),
  metrics: new Set(["TimeUnix", "StartTimeUnix"]),
};

export const NUMBER_COMPARATOR_SQL = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
} as const;

export const METRIC_TYPE_TO_TABLE: Record<MetricType, string> = {
  Gauge: "otel_metrics_gauge",
  Sum: "otel_metrics_sum",
  Histogram: "otel_metrics_histogram",
  ExponentialHistogram: "otel_metrics_exponential_histogram",
  Summary: "otel_metrics_summary",
};

// ============================================================
// MetricType narrowing
// ============================================================
// Runtime-checked narrower so backends never `as MetricType`-cast a
// raw string into the typed union.

// Widened to ReadonlySet<string> so `.has(s)` accepts a plain string —
// the narrowed return type makes isMetricType a proper type guard
// without a cast inside the body.
const METRIC_TYPES_SET: ReadonlySet<string> = new Set<string>(METRIC_TYPES);

export function isMetricType(s: string): s is MetricType {
  return METRIC_TYPES_SET.has(s);
}

export function assertMetricType(s: string): MetricType {
  if (!isMetricType(s)) {
    throw new KopaiQueryValidationError(
      `Invalid MetricType "${s}". Expected one of: ${METRIC_TYPES.join(", ")}.`
    );
  }
  return s;
}

// ============================================================
// Column resolution
// ============================================================

export type ResolvedColumn =
  | { kind: "structural"; column: string }
  | { kind: "semconvAttr"; container: SemconvContainer; key: string }
  | { kind: "attribute"; container: string; key: string };

// Structural cols are PascalCase; semconv attrs are dotted-lowercase.
// Discriminate by case of the first character.
const STARTS_WITH_UPPER = /^[A-Z]/;
const structuralSet = (options: readonly string[]): Set<string> =>
  new Set(options.filter((v) => STARTS_WITH_UPPER.test(v)));

const TRACE_STRUCTURAL_SET = structuralSet(TraceColumn.options);
const LOG_STRUCTURAL_SET = structuralSet(LogColumn.options);
const METRIC_STRUCTURAL_SET = structuralSet(MetricColumn.options);

// Semconv → storage location.
// For now: every semconv attribute is stored inside ResourceAttributes
// (resource-scoped) or the signal-specific attribute container (record-
// scoped). The split mirrors the RESOURCE_SEMCONV vs *_SEMCONV lists in
// kopai-query.ts.
type SemconvContainer =
  | "SpanAttributes"
  | "ResourceAttributes"
  | "LogAttributes"
  | "ScopeAttributes"
  | "Attributes";

const RESOURCE_SEMCONV_KEYS = new Set<string>([
  "service.name",
  "service.namespace",
  "service.version",
  "service.instance.id",
  "deployment.environment.name",
  "host.name",
  "host.id",
  "host.arch",
  "host.type",
  "host.ip",
  "container.id",
  "container.name",
  "container.image.name",
  "container.image.tag",
  "container.runtime",
  "k8s.cluster.name",
  "k8s.cluster.uid",
  "k8s.namespace.name",
  "k8s.node.name",
  "k8s.node.uid",
  "k8s.pod.name",
  "k8s.pod.uid",
  "k8s.container.name",
  "k8s.container.restart_count",
  "k8s.deployment.name",
  "k8s.deployment.uid",
  "k8s.statefulset.name",
  "k8s.statefulset.uid",
  "k8s.daemonset.name",
  "k8s.daemonset.uid",
  "k8s.job.name",
  "k8s.job.uid",
  "k8s.cronjob.name",
  "k8s.cronjob.uid",
  "k8s.replicaset.name",
  "k8s.replicaset.uid",
  "cloud.provider",
  "cloud.region",
  "cloud.availability_zone",
  "cloud.account.id",
  "cloud.platform",
  "cloud.resource_id",
  "process.pid",
  "process.executable.name",
  "process.command",
  "process.command_line",
  "process.runtime.name",
  "process.runtime.version",
  "process.runtime.description",
  "telemetry.sdk.name",
  "telemetry.sdk.version",
  "telemetry.sdk.language",
  "telemetry.distro.name",
  "telemetry.distro.version",
  "os.type",
  "os.name",
  "os.version",
  "os.description",
]);

function recordSemconvContainerForSignal(signal: Signal): SemconvContainer {
  switch (signal) {
    case "traces":
      return "SpanAttributes";
    case "logs":
      return "LogAttributes";
    case "metrics":
      return "Attributes";
  }
}

export function resolveColumn(
  signal: Signal,
  ref: ColumnRefStructural
): ResolvedColumn {
  if (typeof ref === "object") {
    return { kind: "attribute", container: ref.container, key: ref.key };
  }
  const structuralSet =
    signal === "traces"
      ? TRACE_STRUCTURAL_SET
      : signal === "logs"
        ? LOG_STRUCTURAL_SET
        : METRIC_STRUCTURAL_SET;
  if (structuralSet.has(ref)) {
    return { kind: "structural", column: ref };
  }
  // Must be a semconv attribute (validated by zod enum upstream).
  const container = RESOURCE_SEMCONV_KEYS.has(ref)
    ? ("ResourceAttributes" as const)
    : recordSemconvContainerForSignal(signal);
  return { kind: "semconvAttr", container, key: ref };
}

// Projection key emitted in result rows for a column ref. Mirrors the
// aggregate-mode key convention (verbatim for structural, dotted-with-
// container for attribute refs).
export function columnRefProjectionKey(ref: ColumnRefStructural): string {
  if (typeof ref === "string") return ref;
  return `${ref.container}.${ref.key}`;
}

// Runtime guard for the structural column-ref shape. `orderBy[i].column`
// is typed as `unknown` (the underlying zod builder uses an untyped
// `z.ZodType`), so the validator narrows it with this guard instead of
// casting.
function isColumnRefStructural(v: unknown): v is ColumnRefStructural {
  if (typeof v === "string") return true;
  if (typeof v !== "object" || v === null) return false;
  // `in` narrows v to an object carrying the key, so the property reads are
  // typed `unknown` without an intermediate `as {...}` cast.
  return (
    "container" in v &&
    typeof v.container === "string" &&
    "key" in v &&
    typeof v.key === "string"
  );
}

function projectionKeyOrThrow(v: unknown, context: string): string {
  if (!isColumnRefStructural(v)) {
    throw new KopaiQueryValidationError(
      `${context}: expected a column reference (string or {container, key}), got ${typeof v}.`
    );
  }
  return columnRefProjectionKey(v);
}

// ============================================================
// Structural-column helpers (test helper + validator support)
// ============================================================

// Returns every structural top-level column name for a signal. Use in
// raw-mode tests as `dimensions: allStructuralColumns('traces')` to
// mirror the legacy "return everything" SDK behavior without typing
// out 20+ literals per test.
export function allStructuralColumns(signal: Signal): string[] {
  if (signal === "traces") return [...TRACE_STRUCTURAL_SET];
  if (signal === "logs") return [...LOG_STRUCTURAL_SET];
  return [...METRIC_STRUCTURAL_SET];
}

// ============================================================
// Query validation
// ============================================================

export function collectFilterColumns(
  filters: AnyFilterExpr[] | undefined
): AnyColumnRef[] {
  const out: AnyColumnRef[] = [];
  if (!filters) return out;
  for (const f of filters) {
    if ("and" in f) {
      out.push(...collectFilterColumns(f.and));
    } else if ("or" in f) {
      out.push(...collectFilterColumns(f.or));
    } else {
      out.push(f.column);
    }
  }
  return out;
}

// A non-logical (leaf) filter — same shape as the FilterExpr leaf variants,
// retaining op + value so validators can inspect them. Logical and/or nodes
// are flattened out by collectFilterLeaves.
export type FilterLeaf =
  | { column: AnyColumnRef; op: "eq" | "neq"; value: string | number | boolean }
  | {
      column: AnyColumnRef;
      op: "contains" | "notContains" | "startsWith" | "endsWith";
      value: string;
    }
  | { column: AnyColumnRef; op: "gt" | "gte" | "lt" | "lte"; value: number }
  | { column: AnyColumnRef; op: "in" | "notIn"; values: string[] | number[] }
  | { column: AnyColumnRef; op: "isNull" | "isNotNull" };

// Flattens the filter tree to its leaf predicates (recursing through and/or),
// preserving op + value/values for type/existence checks in validateKopaiQuery.
export function collectFilterLeaves(
  filters: AnyFilterExpr[] | undefined
): FilterLeaf[] {
  const out: FilterLeaf[] = [];
  if (!filters) return out;
  for (const f of filters) {
    if ("and" in f) {
      out.push(...collectFilterLeaves(f.and));
    } else if ("or" in f) {
      out.push(...collectFilterLeaves(f.or));
    } else {
      out.push(f);
    }
  }
  return out;
}

// Gathers every column reference a query points at — dimensions, filter
// columns, measure columns, and dimension-typed orderBy keys — for
// cross-field validation. orderBy.column is typed `unknown` upstream, so it
// is narrowed with the structural guard before inclusion.
// Returns ColumnRefStructural (the wider shape) rather than AnyColumnRef: every
// narrow ref is assignable to it, and the isColumnRefStructural guard narrows
// the `unknown` orderBy column to exactly this type — so no cast is needed. The
// sole consumer only inspects `typeof ref` and passes refs to resolveColumn /
// Set.has, all of which accept ColumnRefStructural.
function collectColumnRefsForValidation(q: KopaiQuery): ColumnRefStructural[] {
  const refs: ColumnRefStructural[] = [];
  if (q.dimensions) refs.push(...q.dimensions);
  refs.push(...collectFilterColumns(q.filters));
  if (q.mode === "aggregate") {
    for (const m of q.measures) {
      if ("column" in m) refs.push(m.column);
    }
  }
  if (q.orderBy) {
    for (const o of q.orderBy) {
      if (o.type === "dimension" && isColumnRefStructural(o.column)) {
        refs.push(o.column);
      }
    }
  }
  return refs;
}

// Looks for MetricType references anywhere in the filter tree. Returns:
//   - `pinned`: an AND-only branch that uniquely identifies a single
//     MetricType — the compiler can use it to pick a table.
//   - `ambiguous`: MetricType appears inside an OR / multi-value list /
//     conflicting eq+stringIn — can't pin to one table.
//   - `none`: no MetricType reference at all.
type MetricTypePinResult =
  | { kind: "pinned"; value: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "none" };

export function findMetricTypePin(
  filters: AnyFilterExpr[] | undefined,
  inAndContext: boolean
): MetricTypePinResult {
  if (!filters || filters.length === 0) return { kind: "none" };
  let pinned: string | null = null;

  for (const f of filters) {
    if ("and" in f || "or" in f) {
      const isAnd = "and" in f;
      const children = "and" in f ? f.and : f.or;
      const nested = findMetricTypePin(children, inAndContext && isAnd);
      if (nested.kind === "ambiguous") return nested;
      if (nested.kind === "pinned") {
        // A MetricType reference inside an OR can't be relied on to
        // narrow the whole query — flag as ambiguous unless we're still
        // in pure-AND territory.
        if (!inAndContext || !isAnd) {
          return {
            kind: "ambiguous",
            reason:
              "MetricType filter inside an OR branch cannot pin the metric table. Place MetricType at the top level (AND).",
          };
        }
        if (pinned !== null && pinned !== nested.value) {
          return {
            kind: "ambiguous",
            reason: `Conflicting MetricType filters (${pinned} vs ${nested.value}).`,
          };
        }
        pinned = nested.value;
      }
      continue;
    }

    if (f.column !== "MetricType") continue;
    // We have a direct MetricType filter at this level.
    if (!inAndContext) {
      return {
        kind: "ambiguous",
        reason:
          "MetricType filter inside an OR branch cannot pin the metric table. Place MetricType at the top level (AND).",
      };
    }
    if (f.op === "eq" && typeof f.value === "string") {
      if (pinned !== null && pinned !== f.value) {
        return {
          kind: "ambiguous",
          reason: `Conflicting MetricType filters (${pinned} vs ${f.value}).`,
        };
      }
      pinned = f.value;
    } else if (f.op === "in") {
      if (f.values.length !== 1) {
        return {
          kind: "ambiguous",
          reason: `v1 supports only a single MetricType per query (got ${String(f.values.length)} values).`,
        };
      }
      const v = f.values[0]!;
      if (typeof v !== "string") {
        return {
          kind: "ambiguous",
          reason: `MetricType filter values must be strings (got ${typeof v}).`,
        };
      }
      if (pinned !== null && pinned !== v) {
        return {
          kind: "ambiguous",
          reason: `Conflicting MetricType filters (${pinned} vs ${v}).`,
        };
      }
      pinned = v;
    } else {
      return {
        kind: "ambiguous",
        reason: `MetricType filter must use op 'eq' (string value) or 'in' (single string value); got op '${f.op}'.`,
      };
    }
  }

  if (pinned !== null) return { kind: "pinned", value: pinned };
  return { kind: "none" };
}

// Returns the MetricType that a (validated) metric query is pinned to.
// Throws if the query is non-metric or if no MetricType pin exists —
// callers are expected to run validateKopaiQuery first, but this is
// defensive in case they don't.
export function extractMetricType(q: KopaiQuery): MetricType {
  if (q.signal !== "metrics") {
    throw new KopaiQueryValidationError(
      "extractMetricType called for a non-metric query."
    );
  }
  const pin = findMetricTypePin(q.filters, true);
  if (pin.kind === "ambiguous") {
    throw new KopaiQueryValidationError(pin.reason);
  }
  if (pin.kind === "none") {
    throw new KopaiQueryValidationError(
      "Metric query missing MetricType filter."
    );
  }
  return assertMetricType(pin.value);
}

export function validateKopaiQuery(q: KopaiQuery): void {
  // Metric queries require a MetricType filter — both backends store
  // each metric type in a separate table, so the compiler needs an
  // unambiguous target.
  if (q.signal === "metrics") {
    const pin = findMetricTypePin(q.filters, true);
    if (pin.kind === "ambiguous") {
      throw new KopaiQueryValidationError(pin.reason);
    }
    if (pin.kind === "none") {
      throw new KopaiQueryValidationError(
        "Metric queries require a MetricType filter at the top level, e.g. {column:'MetricType', op:'eq', value:'Gauge'}."
      );
    }
    // Narrows the string into the typed union — throws a clear error if
    // the user passed an unrecognized type.
    const metricType = assertMetricType(pin.value);

    // Each MetricType is stored in its own table holding only that variant's
    // structural columns. Reject any referenced structural column that does
    // not exist on the pinned type's table — otherwise the backend emits SQL
    // against a missing column and surfaces a 500 instead of a clean 400.
    const allowed = METRIC_STRUCTURAL_COLUMNS_BY_TYPE[metricType];
    for (const ref of collectColumnRefsForValidation(q)) {
      if (typeof ref !== "string") continue; // attribute refs exist on all tables
      if (ref === "MetricType") continue; // synthetic; routes table selection
      if (resolveColumn("metrics", ref).kind !== "structural") continue; // semconv attr
      if (!allowed.has(ref)) {
        throw new KopaiQueryValidationError(
          `Column "${ref}" does not exist on MetricType "${metricType}". ` +
            `Structural columns available for ${metricType}: ${[...allowed].sort().join(", ")}.`
        );
      }
    }
  }

  if (q.mode === "aggregate") {
    // Alias uniqueness across measures.
    const aliases = new Set<string>();
    for (const m of q.measures) {
      if (aliases.has(m.as)) {
        throw new KopaiQueryValidationError(
          `Duplicate measure alias "${m.as}".`
        );
      }
      aliases.add(m.as);
    }

    // HAVING references must point at known aliases.
    if (q.havings) {
      for (const h of q.havings) {
        if (!aliases.has(h.measure)) {
          throw new KopaiQueryValidationError(
            `having.measure "${h.measure}" does not match any measure alias.`
          );
        }
      }
    }

    // orderBy: dimension orders must reference a column that appears in
    // dimensions; measure orders must reference a known alias.
    if (q.orderBy) {
      const dimKeys = new Set<string>();
      for (const d of q.dimensions ?? []) {
        dimKeys.add(columnRefProjectionKey(d));
      }
      for (const o of q.orderBy) {
        if (o.type === "measure") {
          if (!aliases.has(o.alias)) {
            throw new KopaiQueryValidationError(
              `orderBy measure "${o.alias}" does not match any measure alias.`
            );
          }
        } else {
          const key = projectionKeyOrThrow(o.column, "orderBy column");
          if (!dimKeys.has(key)) {
            throw new KopaiQueryValidationError(
              `orderBy dimension "${key}" must appear in dimensions.`
            );
          }
        }
      }
    }
  } else {
    // raw mode: backends return the full denormalized row regardless of
    // `dimensions` (which is only a hint), so any structural column is a
    // valid orderBy key. Only the measure-typed branch is disallowed.
    if (q.orderBy) {
      for (const o of q.orderBy) {
        if (o.type === "measure") {
          throw new KopaiQueryValidationError(
            "orderBy measure is not allowed in raw mode."
          );
        }
      }
    }
  }

  // Surface-level reference: ensure no column ref accidentally points
  // at MetricType when signal != metrics, etc. (cheap sanity).
  if (q.signal !== "metrics") {
    const measureCols: AnyColumnRef[] =
      q.mode === "aggregate"
        ? q.measures.flatMap((m) => ("column" in m ? [m.column] : []))
        : [];
    const allCols: AnyColumnRef[] = [
      ...(q.dimensions ?? []),
      ...collectFilterColumns(q.filters),
      ...measureCols,
    ];
    for (const c of allCols) {
      if (typeof c === "string" && c === "MetricType") {
        throw new KopaiQueryValidationError(
          `Column "MetricType" is only valid on metric queries.`
        );
      }
    }
  }

  // Numeric comparisons require a numeric (or temporal) column. A structural
  // String column compared to a number cannot be coerced by the backends and
  // surfaces as a 500. Time columns are nanosecond integers and may be
  // compared numerically. Attribute / semconv refs are dynamically typed and
  // coerced at the SQL layer (toFloat64OrNull / CAST), so they are exempt.
  const numericComparable = new Set<string>([
    ...NUMERIC_STRUCTURAL_COLUMNS[q.signal],
    ...TIME_STRUCTURAL_COLUMNS[q.signal],
  ]);
  for (const leaf of collectFilterLeaves(q.filters)) {
    const col = leaf.column;
    if (typeof col !== "string") continue;
    if (col === "MetricType") continue;
    if (resolveColumn(q.signal, col).kind !== "structural") continue;
    let wantsNumeric: boolean;
    switch (leaf.op) {
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        wantsNumeric = true;
        break;
      case "eq":
      case "neq":
        wantsNumeric = typeof leaf.value === "number";
        break;
      case "in":
      case "notIn":
        wantsNumeric = typeof leaf.values[0] === "number";
        break;
      default:
        wantsNumeric = false;
    }
    if (wantsNumeric && !numericComparable.has(col)) {
      throw new KopaiQueryValidationError(
        `Column "${col}" is not numeric; the "${leaf.op}" operator/value requires a numeric column. ` +
          `Use a string value, or choose a numeric column.`
      );
    }
  }
}
