// Backend-agnostic helpers for compiling a KopaiQuery into SQL bits.
// Each datasource (sqlite, clickhouse) wraps these with its own dialect.

import {
  LogColumn,
  METRIC_TYPES,
  MetricColumn,
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

const DURATION_UNIT_NS: Record<string, bigint> = {
  s: 1_000_000_000n,
  m: 60n * 1_000_000_000n,
  h: 60n * 60n * 1_000_000_000n,
  d: 24n * 60n * 60n * 1_000_000_000n,
  w: 7n * 24n * 60n * 60n * 1_000_000_000n,
};

const DURATION_UNIT_S: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
};

function parseDurationParts(s: string): { value: bigint; unit: string } {
  const m = /^(\d+)([smhdw])$/.exec(s);
  if (!m) {
    throw new KopaiQueryValidationError(
      `Invalid duration "${s}". Expected positive integer + unit (s,m,h,d,w).`
    );
  }
  return { value: BigInt(m[1]!), unit: m[2]! };
}

export function durationToNanos(s: string): bigint {
  const { value, unit } = parseDurationParts(s);
  return value * DURATION_UNIT_NS[unit]!;
}

export function granularityToSeconds(s: string): number {
  const { value, unit } = parseDurationParts(s);
  return Number(value) * DURATION_UNIT_S[unit]!;
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
  compareStartNs?: bigint;
  compareEndNs?: bigint;
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
  const out: CompiledTimeWindow = { startNs, endNs };
  if (td.compareOffset) {
    const offsetNs = durationToNanos(td.compareOffset);
    out.compareStartNs = startNs - offsetNs;
    out.compareEndNs = endNs - offsetNs;
  }
  return out;
}

// ============================================================
// MetricType narrowing
// ============================================================
// Runtime-checked narrower so backends never `as MetricType`-cast a
// raw string into the typed union.

const METRIC_TYPES_SET: ReadonlySet<MetricType> = new Set(METRIC_TYPES);

export function isMetricType(s: string): s is MetricType {
  return METRIC_TYPES_SET.has(s as MetricType);
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

// Top-level enum of structural columns per signal (mirrors STRUCTURAL
// arrays inside kopai-query.ts). We re-derive from the exported enums
// rather than duplicating the literal arrays.
const TRACE_STRUCTURAL_SET = new Set<string>();
const LOG_STRUCTURAL_SET = new Set<string>();
const METRIC_STRUCTURAL_SET = new Set<string>();

// Pull options out of the exported enum schemas. Structural cols are
// PascalCase; semconv attrs are dotted-lowercase. Discriminate by case
// of the first character (cheap and unambiguous given the convention).
for (const v of TraceColumn.options) {
  if (v[0]! >= "A" && v[0]! <= "Z") TRACE_STRUCTURAL_SET.add(v);
}
for (const v of LogColumn.options) {
  if (v[0]! >= "A" && v[0]! <= "Z") LOG_STRUCTURAL_SET.add(v);
}
for (const v of MetricColumn.options) {
  if (v[0]! >= "A" && v[0]! <= "Z") METRIC_STRUCTURAL_SET.add(v);
}

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

function collectFilterColumns(
  filters: AnyFilterExpr[] | undefined
): AnyColumnRef[] {
  const out: AnyColumnRef[] = [];
  if (!filters) return out;
  for (const f of filters) {
    if (f.kind === "logical") {
      out.push(...collectFilterColumns(f.filters));
    } else {
      out.push(f.column);
    }
  }
  return out;
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

function findMetricTypePin(
  filters: AnyFilterExpr[] | undefined,
  inAndContext: boolean
): MetricTypePinResult {
  if (!filters || filters.length === 0) return { kind: "none" };
  let pinned: string | null = null;

  for (const f of filters) {
    if (f.kind === "logical") {
      const nested = findMetricTypePin(
        f.filters,
        inAndContext && f.op === "and"
      );
      if (nested.kind === "ambiguous") return nested;
      if (nested.kind === "pinned") {
        // A MetricType reference inside an OR can't be relied on to
        // narrow the whole query — flag as ambiguous unless we're still
        // in pure-AND territory.
        if (!inAndContext || f.op !== "and") {
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
    if (f.kind === "string") {
      if (f.op !== "eq") {
        return {
          kind: "ambiguous",
          reason: `MetricType filter must use op 'eq' (got '${f.op}').`,
        };
      }
      if (pinned !== null && pinned !== f.value) {
        return {
          kind: "ambiguous",
          reason: `Conflicting MetricType filters (${pinned} vs ${f.value}).`,
        };
      }
      pinned = f.value;
    } else if (f.kind === "stringIn") {
      if (f.op !== "in") {
        return {
          kind: "ambiguous",
          reason: `MetricType filter must use op 'in' (got '${f.op}').`,
        };
      }
      if (f.values.length !== 1) {
        return {
          kind: "ambiguous",
          reason: `v1 supports only a single MetricType per query (got ${String(f.values.length)} values).`,
        };
      }
      const v = f.values[0];
      if (v === undefined) {
        return { kind: "ambiguous", reason: "Empty MetricType values." };
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
        reason: `MetricType filter must be a string equality (got kind '${f.kind}').`,
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
  // compareOffset is out of scope for v1.
  if (q.timeDimension.compareOffset !== undefined) {
    throw new KopaiQueryValidationError(
      "timeDimension.compareOffset is not yet supported. Run two separate queries instead."
    );
  }

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
        "Metric queries require a MetricType filter at the top level, e.g. {kind:'string', column:'MetricType', op:'eq', value:'Gauge'}."
      );
    }
    // Narrows the string into the typed union — throws a clear error if
    // the user passed an unrecognized type.
    assertMetricType(pin.value);
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
          const key = columnRefProjectionKey(o.column as ColumnRefStructural);
          if (!dimKeys.has(key)) {
            throw new KopaiQueryValidationError(
              `orderBy dimension "${key}" must appear in dimensions.`
            );
          }
        }
      }
    }
  } else {
    // raw mode: orderBy dimension column must be one of dimensions.
    if (q.orderBy) {
      const dimKeys = new Set<string>();
      for (const d of q.dimensions) {
        dimKeys.add(columnRefProjectionKey(d));
      }
      for (const o of q.orderBy) {
        if (o.type === "measure") {
          throw new KopaiQueryValidationError(
            "orderBy measure is not allowed in raw mode."
          );
        }
        const key = columnRefProjectionKey(o.column as ColumnRefStructural);
        if (!dimKeys.has(key)) {
          throw new KopaiQueryValidationError(
            `orderBy dimension "${key}" must appear in dimensions.`
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
}
