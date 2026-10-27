import { kopaiQueryCompiler, type datasource, kopaiQuery } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

type KopaiQuery = kopaiQuery.KopaiQuery;
type TraceRawQuery = kopaiQuery.TraceRawQuery;
type TraceAggregateQuery = kopaiQuery.TraceAggregateQuery;
type LogRawQuery = kopaiQuery.LogRawQuery;
type LogAggregateQuery = kopaiQuery.LogAggregateQuery;
type MetricRawQuery = kopaiQuery.MetricRawQuery;
type MetricAggregateQuery = kopaiQuery.MetricAggregateQuery;
type AnyFilterExpr = kopaiQueryCompiler.AnyFilterExpr;

// Structural shapes that accept any narrow per-signal variant from
// @kopai/core without a cast. The SQL builders work over these because
// none of the signal-specific structure (which ops are legal, which
// containers exist) affects the SQL shape — the validator already
// guarantees runtime correctness.
type ColumnRefStructural = kopaiQueryCompiler.ColumnRefStructural;
// `column` is `unknown` in the orderBy declaration because the underlying
// Zod schema uses an untyped `z.ZodType` for the column ref. We narrow it
// at runtime with `toColumnRef` before using it.
type OrderItemRaw =
  | { type: "dimension"; column: unknown; direction: "asc" | "desc" }
  | { type: "measure"; alias: string; direction: "asc" | "desc" };
type MeasureExprShape =
  | { op: "COUNT"; as: string }
  | { op: "ERROR_RATE"; as: string }
  | { op: "THROUGHPUT"; as: string }
  | { op: "COUNT_DISTINCT"; column: ColumnRefStructural; as: string }
  | { op: NumericOpName; column: ColumnRefStructural; as: string }
  | DistributionMeasureShape;
type DistributionMeasureShape =
  | { op: "HISTOGRAM_QUANTILE"; quantile: number; as: string }
  | { op: "HISTOGRAM_AVG"; as: string }
  | { op: "SUMMARY_QUANTILE"; quantile: number; as: string }
  | { op: "INCREASE"; column: ColumnRefStructural; as: string }
  | { op: "RATE"; column: ColumnRefStructural; as: string };

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function toColumnRef(value: unknown): ColumnRefStructural {
  if (typeof value === "string") return value;
  if (isStringRecord(value)) {
    const { container, key } = value;
    if (typeof container === "string" && typeof key === "string") {
      return { container, key };
    }
  }
  throw new Error(
    `Invalid column ref shape: ${JSON.stringify(value)} — expected string or { container, key }`
  );
}

// ---------------------------------------------------------------------------
// Per-signal column references that exist as top-level columns in ClickHouse.
// Derived from core's per-signal structural enums so a new structural column
// in @kopai/core is picked up automatically. "ServiceName" is an additional
// override: it isn't exposed in the public TraceColumn/LogColumn/MetricColumn
// enum (callers see it as the "service.name" semconv), but it's a real
// top-level column in CH storage, so we add it explicitly so resolved
// attribute lookups hit the fast column instead of ResourceAttributes[...].
// ---------------------------------------------------------------------------

const SERVICE_NAME_COLUMN = "ServiceName";

const TRACE_TOPLEVEL_COLUMNS = new Set<string>([
  ...kopaiQueryCompiler.allStructuralColumns("traces"),
  SERVICE_NAME_COLUMN,
]);

const LOG_TOPLEVEL_COLUMNS = new Set<string>([
  ...kopaiQueryCompiler.allStructuralColumns("logs"),
  SERVICE_NAME_COLUMN,
]);

// All metric structural columns (common + type-specific). The validator's
// MetricType pin guarantees a single target table; we trust that the caller
// only references columns that exist on the chosen table.
const METRIC_TOPLEVEL_COLUMNS = new Set<string>([
  ...kopaiQueryCompiler.allStructuralColumns("metrics"),
  SERVICE_NAME_COLUMN,
]);

// Maps semconv keys to a top-level column when one exists.
const TOPLEVEL_FOR_SEMCONV: Record<string, string> = {
  "service.name": SERVICE_NAME_COLUMN,
};

const METRIC_TABLE_BY_TYPE = kopaiQueryCompiler.METRIC_TYPE_TO_TABLE;

// ---------------------------------------------------------------------------
// SQL fragment builders
// ---------------------------------------------------------------------------

interface ParamCtx {
  params: Record<string, unknown>;
  counter: { n: number };
}

function newParamCtx(): ParamCtx {
  return { params: {}, counter: { n: 0 } };
}

function nextParam(ctx: ParamCtx, value: unknown, prefix = "p"): string {
  const name = `${prefix}_${String(ctx.counter.n++)}`;
  ctx.params[name] = value;
  return name;
}

type Signal = "traces" | "logs" | "metrics";

type ColumnRef = ColumnRefStructural;

interface ResolvedRef {
  sql: string; // SQL expression to read the value (no alias)
  projectionKey: string; // result key (aggregate row key + orderBy key)
  isString: boolean; // attribute Map() lookups return String — useful for numeric ops
}

// Attribute-map containers are the only identifiers in this builder that come
// from the request body. Zod constrains them to the per-signal *AttrContainer
// enums upstream, but `buildKopaiSql` is also called directly (tests, and any
// future caller that skips validation), so re-check here rather than trust the
// type. The `key` is escaped via quoteLiteral; the container is interpolated as
// a bare identifier, so it must be an exact match to a known column name.
// Mirrors TraceAttrContainer ∪ LogAttrContainer ∪ MetricAttrContainer in core.
const KNOWN_ATTR_CONTAINERS = new Set<string>([
  "SpanAttributes",
  "ResourceAttributes",
  "LogAttributes",
  "ScopeAttributes",
  "Attributes",
]);

function assertKnownContainer(container: string): void {
  if (!KNOWN_ATTR_CONTAINERS.has(container)) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Unknown attribute container "${container}". Expected one of: ${[
        ...KNOWN_ATTR_CONTAINERS,
      ].join(", ")}.`
    );
  }
}

function resolveRefSql(signal: Signal, ref: ColumnRef): ResolvedRef {
  if (typeof ref === "object") {
    // Direct attribute lookup like SpanAttributes['http.route']
    assertKnownContainer(ref.container);
    return {
      sql: `${ref.container}[${quoteLiteral(ref.key)}]`,
      projectionKey: `${ref.container}.${ref.key}`,
      isString: true,
    };
  }
  const topLevelSet =
    signal === "traces"
      ? TRACE_TOPLEVEL_COLUMNS
      : signal === "logs"
        ? LOG_TOPLEVEL_COLUMNS
        : METRIC_TOPLEVEL_COLUMNS;
  if (topLevelSet.has(ref)) {
    return { sql: `\`${ref}\``, projectionKey: ref, isString: false };
  }
  // semconv attribute — check the override map for ServiceName-style shortcuts.
  const override = TOPLEVEL_FOR_SEMCONV[ref];
  if (override && topLevelSet.has(override)) {
    return { sql: `\`${override}\``, projectionKey: ref, isString: false };
  }
  // semconv attribute — use compiler to find the right container.
  const resolved = kopaiQueryCompiler.resolveColumn(signal, ref);
  if (resolved.kind === "semconvAttr") {
    return {
      sql: `${resolved.container}[${quoteLiteral(resolved.key)}]`,
      projectionKey: ref,
      isString: true,
    };
  }
  // structural fallback (shouldn't happen because we checked uppercase above)
  return { sql: `\`${ref}\``, projectionKey: ref, isString: false };
}

function quoteLiteral(s: string): string {
  // SQL string literal inside a Map[...] access. ClickHouse uses
  // backslash escapes for single-quote and backslash. Keys come from
  // zod-validated KopaiQuery input (OTel-spec attribute names can
  // contain ., /, _, alphanumerics, etc.) so we escape rather than
  // allowlist.
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function escapeIdent(name: string): string {
  // ClickHouse backtick-quoted identifier. Names include measure aliases
  // (strict Alias regex) and dimension projection keys, which for attribute
  // refs are `${container}.${key}` where the OTel key may contain arbitrary
  // characters (spaces, '/', ':', etc.). Escape backslashes and backticks
  // rather than allowlisting, so any valid key is accepted (parity with the
  // SQLite backend) while interpolation stays safe.
  return `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

// ---------------------------------------------------------------------------
// WHERE / filter compilation
// ---------------------------------------------------------------------------

function compileFilters(
  signal: Signal,
  filters: AnyFilterExpr[] | undefined,
  ctx: ParamCtx
): string {
  if (!filters || filters.length === 0) return "";
  const parts = filters.map((f) => compileFilter(signal, f, ctx));
  return parts.join(" AND ");
}

function compileFilter(
  signal: Signal,
  f: AnyFilterExpr,
  ctx: ParamCtx
): string {
  if ("and" in f || "or" in f) {
    const children = "and" in f ? f.and : f.or;
    const joiner = "and" in f ? " AND " : " OR ";
    if (children.length === 0) return "1=1";
    const inner = children
      .map((sub) => compileFilter(signal, sub, ctx))
      .join(joiner);
    return `(${inner})`;
  }
  const col = resolveRefSql(signal, f.column);
  switch (f.op) {
    case "eq":
    case "neq": {
      if (typeof f.value === "boolean") {
        const eq = f.op === "eq" ? "=" : "!=";
        if (col.isString) {
          // Attribute Map() values are stored as String — bind a string
          // literal so the equality matches stringified booleans.
          const v = f.value ? "true" : "false";
          const p = nextParam(ctx, v, "b");
          return `${col.sql} ${eq} {${p}:String}`;
        }
        // Top-level Bool column (e.g. IsMonotonic) — bind as :Bool so CH
        // doesn't have to coerce a string literal.
        const p = nextParam(ctx, f.value, "b");
        return `${col.sql} ${eq} {${p}:Bool}`;
      }
      if (typeof f.value === "number") {
        const numCol = numericCast(col);
        const p = nextParam(ctx, f.value, "n");
        return `${numCol} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[f.op]} {${p}:Float64}`;
      }
      const p = nextParam(ctx, f.value, "s");
      return f.op === "eq"
        ? `${col.sql} = {${p}:String}`
        : `${col.sql} != {${p}:String}`;
    }
    case "contains": {
      const p = nextParam(ctx, `%${escapeLikePattern(f.value)}%`, "s");
      return `${col.sql} ILIKE {${p}:String}`;
    }
    case "notContains": {
      const p = nextParam(ctx, `%${escapeLikePattern(f.value)}%`, "s");
      return `${col.sql} NOT ILIKE {${p}:String}`;
    }
    case "startsWith": {
      const p = nextParam(ctx, `${escapeLikePattern(f.value)}%`, "s");
      return `${col.sql} ILIKE {${p}:String}`;
    }
    case "endsWith": {
      const p = nextParam(ctx, `%${escapeLikePattern(f.value)}`, "s");
      return `${col.sql} ILIKE {${p}:String}`;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const numCol = numericCast(col);
      const p = nextParam(ctx, f.value, "n");
      return `${numCol} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[f.op]} {${p}:Float64}`;
    }
    case "in":
    case "notIn": {
      const not = f.op === "notIn" ? "NOT " : "";
      // Pick element type from the first value — Zod guarantees array
      // contents are uniform string|number (the LLM can mix, but we trust
      // upstream validation). If empty, default to String.
      const first = f.values[0];
      if (typeof first === "number") {
        const numCol = numericCast(col);
        const p = nextParam(ctx, f.values, "nin");
        return `${numCol} ${not}IN {${p}:Array(Float64)}`;
      }
      const p = nextParam(ctx, f.values, "sin");
      return `${col.sql} ${not}IN {${p}:Array(String)}`;
    }
    case "isNull":
    case "isNotNull": {
      // Map[] returns empty string when key missing; top-level CH otel cols
      // are non-nullable Strings — empty()/notEmpty() works for both.
      return f.op === "isNull" ? `empty(${col.sql})` : `notEmpty(${col.sql})`;
    }
  }
}

function numericCast(col: ResolvedRef): string {
  if (col.isString) {
    return `toFloat64OrNull(${col.sql})`;
  }
  return col.sql;
}

function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ---------------------------------------------------------------------------
// Time window
// ---------------------------------------------------------------------------

function compileTimeRange(
  signal: Signal,
  win: kopaiQueryCompiler.CompiledTimeWindow,
  ctx: ParamCtx
): string {
  const col = kopaiQueryCompiler.timeColumnForSignal(signal);
  const lo = nextParam(ctx, nanosToDateTime64(win.startNs.toString()), "tsLo");
  const hi = nextParam(ctx, nanosToDateTime64(win.endNs.toString()), "tsHi");
  return `${col} >= {${lo}:DateTime64(9)} AND ${col} < {${hi}:DateTime64(9)}`;
}

// ---------------------------------------------------------------------------
// Order BY
// ---------------------------------------------------------------------------

function compileOrderByRaw(
  signal: Signal,
  orderBy: OrderItemRaw[] | undefined,
  defaultCol: string
): { sql: string; sortKeySqls: string[] } {
  if (!orderBy || orderBy.length === 0) {
    return {
      sql: `ORDER BY ${defaultCol} DESC`,
      sortKeySqls: [defaultCol],
    };
  }
  const sortKeySqls: string[] = [];
  const parts: string[] = [];
  for (const o of orderBy) {
    if (o.type === "measure") {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        "Raw mode does not allow measure-typed orderBy."
      );
    }
    const r = resolveRefSql(signal, toColumnRef(o.column));
    sortKeySqls.push(r.sql);
    parts.push(`${r.sql} ${o.direction.toUpperCase()}`);
  }
  return { sql: `ORDER BY ${parts.join(", ")}`, sortKeySqls };
}

function compileOrderByAggregate(
  signal: Signal,
  orderBy: OrderItemRaw[] | undefined
): string {
  if (!orderBy || orderBy.length === 0) return "";
  const parts: string[] = [];
  for (const o of orderBy) {
    if (o.type === "measure") {
      parts.push(`${escapeIdent(o.alias)} ${o.direction.toUpperCase()}`);
    } else {
      const r = resolveRefSql(signal, toColumnRef(o.column));
      parts.push(`${r.sql} ${o.direction.toUpperCase()}`);
    }
  }
  return `ORDER BY ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Measures (aggregate)
// ---------------------------------------------------------------------------

type NumericOpName =
  | "SUM"
  | "AVG"
  | "MIN"
  | "MAX"
  | "P50"
  | "P75"
  | "P90"
  | "P95"
  | "P99"
  | "P999"
  | "RATE_AVG"
  | "RATE_SUM"
  | "RATE_MAX";

const QUANTILE_MAP: Record<
  "P50" | "P75" | "P90" | "P95" | "P99" | "P999",
  number
> = {
  P50: 0.5,
  P75: 0.75,
  P90: 0.9,
  P95: 0.95,
  P99: 0.99,
  P999: 0.999,
};

// OTel stream identity (spec 4.1): the per-series walk partitions on it, and
// the metrics percentile determinator hashes it. Not the raw cursor's
// _rowHash, which omits ResourceAttributes and the scope.
const METRIC_SERIES_KEY_SQL =
  "sipHash64(MetricName, MetricUnit, ScopeName, ScopeVersion, toString(ResourceAttributes), toString(Attributes))";

// Row hash fed to quantileDeterministic, so the same rows always give the same
// percentile (spec 4.8). Log lines identical down to the nanosecond share a
// hash; the sampler then keeps or drops them together, which is accepted.
const PERCENTILE_DETERMINATOR: Record<Signal, string> = {
  traces: "cityHash64(TraceId, SpanId)",
  logs: "sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId)",
  metrics: `sipHash64(${METRIC_SERIES_KEY_SQL}, TimeUnix)`,
};

function isPercentileOp(op: string): op is keyof typeof QUANTILE_MAP {
  return op in QUANTILE_MAP;
}

function compileMeasure(
  signal: Signal,
  m: MeasureExprShape,
  bucketSeconds: number | null,
  windowSeconds: number,
  ctx: ParamCtx
): string {
  const alias = escapeIdent(m.as);
  if (
    m.op === "HISTOGRAM_QUANTILE" ||
    m.op === "HISTOGRAM_AVG" ||
    m.op === "SUMMARY_QUANTILE" ||
    m.op === "INCREASE" ||
    m.op === "RATE"
  ) {
    // Unreachable through buildKopaiSql, which routes these to the staged path.
    throw new Error(`${m.op} compiles only through the staged metric path.`);
  }
  if (m.op === "COUNT") {
    return `count() AS ${alias}`;
  }
  if (m.op === "ERROR_RATE") {
    const p = nextParam(
      ctx,
      kopaiQueryCompiler.STATUS_CODE_ERROR_LITERAL,
      "errStatus"
    );
    return `avg(if(StatusCode = {${p}:String}, 1, 0)) AS ${alias}`;
  }
  if (m.op === "THROUGHPUT") {
    const denom = bucketSeconds ?? windowSeconds;
    return `(count() / ${String(denom)}) AS ${alias}`;
  }
  if (m.op === "COUNT_DISTINCT") {
    const r = resolveRefSql(signal, m.column);
    // For attribute Map lookups, a missing key returns the value-type default
    // "" — without nullIf, uniq() would count that empty string as a distinct
    // value (N+1). nullIf maps missing/empty to NULL (which uniq ignores),
    // matching SQLite's COUNT(DISTINCT NULLIF(...)). Structural columns are
    // counted directly.
    const expr = r.isString ? `nullIf(${r.sql}, '')` : r.sql;
    return `uniq(${expr}) AS ${alias}`;
  }
  const r = resolveRefSql(signal, m.column);
  const numCol = numericCast(r);
  const denom = bucketSeconds ?? windowSeconds;
  switch (m.op) {
    case "SUM":
      return `sum(${numCol}) AS ${alias}`;
    case "AVG":
      return `avg(${numCol}) AS ${alias}`;
    case "MIN":
      return `min(${numCol}) AS ${alias}`;
    case "MAX":
      return `max(${numCol}) AS ${alias}`;
    case "RATE_AVG":
      return `(avg(${numCol}) / ${String(denom)}) AS ${alias}`;
    case "RATE_SUM":
      return `(sum(${numCol}) / ${String(denom)}) AS ${alias}`;
    case "RATE_MAX":
      return `(max(${numCol}) / ${String(denom)}) AS ${alias}`;
    case "P50":
    case "P75":
    case "P90":
    case "P95":
    case "P99":
    case "P999":
      return `quantileDeterministic(${String(QUANTILE_MAP[m.op])})(${numCol}, ${PERCENTILE_DETERMINATOR[signal]}) AS ${alias}`;
  }
  const exhaustive: never = m;
  throw new Error(`Unknown measure: ${JSON.stringify(exhaustive)}`);
}

// ---------------------------------------------------------------------------
// Window seconds (summary/throughput denominator)
// ---------------------------------------------------------------------------

function windowSecondsFromWindow(
  win: kopaiQueryCompiler.CompiledTimeWindow
): number {
  const diffNs = win.endNs - win.startNs;
  const seconds = Number(diffNs) / 1e9;
  return Math.max(seconds, 1);
}

// ---------------------------------------------------------------------------
// Cursor encoding (raw mode)
// ---------------------------------------------------------------------------

export interface RawCursorParts {
  ts: string;
  id: string;
}

// UInt64 max as a BigInt — used to validate that cursor ids bound against
// `{:UInt64}` parameters (logs/metrics sipHash) actually fit. ClickHouse
// rejects out-of-range UInt64 literals at execution time, which would
// otherwise surface as a 500.
const U64_MAX = (1n << 64n) - 1n;

export function parseCursor(
  cursor: string,
  opts: { requireUInt64Id?: boolean } = {}
): RawCursorParts {
  const colon = cursor.indexOf(":");
  if (colon === -1) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      "Invalid cursor format: expected '{timestamp}:{id}'"
    );
  }
  const ts = cursor.slice(0, colon);
  const id = cursor.slice(colon + 1);
  if (!/^\d+$/.test(ts)) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Invalid cursor timestamp: expected numeric string, got '${ts}'`
    );
  }
  if (opts.requireUInt64Id) {
    if (!/^\d+$/.test(id)) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Invalid cursor id: expected unsigned 64-bit integer, got '${id}'`
      );
    }
    if (BigInt(id) > U64_MAX) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Invalid cursor id: '${id}' exceeds UInt64 range.`
      );
    }
  }
  return { ts, id };
}

// ---------------------------------------------------------------------------
// Raw mode builders
// ---------------------------------------------------------------------------

const TRACE_RAW_SELECT = [
  "Timestamp",
  "TraceId",
  "SpanId",
  "ParentSpanId",
  "TraceState",
  "SpanName",
  "SpanKind",
  "ServiceName",
  "ResourceAttributes",
  "ScopeName",
  "ScopeVersion",
  "SpanAttributes",
  "Duration",
  "StatusCode",
  "StatusMessage",
  "`Events.Timestamp`",
  "`Events.Name`",
  "`Events.Attributes`",
  "`Links.TraceId`",
  "`Links.SpanId`",
  "`Links.TraceState`",
  "`Links.Attributes`",
];

function buildTraceRaw(q: TraceRawQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  const ctx = newParamCtx();
  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const conds: string[] = [];
  conds.push(compileTimeRange("traces", win, ctx));

  const filterSql = compileFilters("traces", q.filters, ctx);
  if (filterSql) conds.push(filterSql);

  if (q.cursor) {
    assertCursorCompatibleOrderBy("traces", q.orderBy);
    const c = parseCursor(q.cursor);
    const tsParam = nextParam(ctx, nanosToDateTime64(c.ts), "curTs");
    const idParam = nextParam(ctx, c.id, "curId");
    const sortDir = inferPrimaryDir(q.orderBy);
    if (sortDir === "desc") {
      conds.push(
        `(Timestamp < {${tsParam}:DateTime64(9)} OR (Timestamp = {${tsParam}:DateTime64(9)} AND SpanId < {${idParam}:String}))`
      );
    } else {
      conds.push(
        `(Timestamp > {${tsParam}:DateTime64(9)} OR (Timestamp = {${tsParam}:DateTime64(9)} AND SpanId > {${idParam}:String}))`
      );
    }
  }

  const orderInfo = compileOrderByRaw("traces", q.orderBy, "Timestamp");
  // Ensure secondary tiebreaker on SpanId for stable cursor.
  const orderSql = ensureTiebreaker(
    orderInfo.sql,
    "SpanId",
    inferPrimaryDir(q.orderBy)
  );

  const limit = (q.limit ?? 100) + 1;
  const limitParam = nextParam(ctx, limit, "lim");

  const sql = `SELECT
  ${TRACE_RAW_SELECT.join(",\n  ")}
FROM otel_traces
WHERE ${conds.join(" AND ")}
${orderSql}
LIMIT {${limitParam}:UInt32}`;
  return { sql, params: ctx.params };
}

const LOG_RAW_SELECT = [
  "Timestamp",
  "TraceId",
  "SpanId",
  "TraceFlags",
  "SeverityText",
  "SeverityNumber",
  "ServiceName",
  "Body",
  "ResourceSchemaUrl",
  "ResourceAttributes",
  "ScopeSchemaUrl",
  "ScopeName",
  "ScopeVersion",
  "ScopeAttributes",
  "LogAttributes",
  "EventName",
  "sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) AS _rowHash",
];

function buildLogRaw(q: LogRawQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  const ctx = newParamCtx();
  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const conds: string[] = [];
  conds.push(compileTimeRange("logs", win, ctx));

  const filterSql = compileFilters("logs", q.filters, ctx);
  if (filterSql) conds.push(filterSql);

  if (q.cursor) {
    assertCursorCompatibleOrderBy("logs", q.orderBy);
    const c = parseCursor(q.cursor, { requireUInt64Id: true });
    const tsParam = nextParam(ctx, nanosToDateTime64(c.ts), "curTs");
    const hashParam = nextParam(ctx, c.id, "curHash");
    const sortDir = inferPrimaryDir(q.orderBy);
    if (sortDir === "desc") {
      conds.push(
        `(Timestamp < {${tsParam}:DateTime64(9)} OR (Timestamp = {${tsParam}:DateTime64(9)} AND sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) < {${hashParam}:UInt64}))`
      );
    } else {
      conds.push(
        `(Timestamp > {${tsParam}:DateTime64(9)} OR (Timestamp = {${tsParam}:DateTime64(9)} AND sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) > {${hashParam}:UInt64}))`
      );
    }
  }

  const orderInfo = compileOrderByRaw("logs", q.orderBy, "Timestamp");
  const orderSql = ensureTiebreaker(
    orderInfo.sql,
    "_rowHash",
    inferPrimaryDir(q.orderBy)
  );

  const limit = (q.limit ?? 100) + 1;
  const limitParam = nextParam(ctx, limit, "lim");

  const sql = `SELECT
  ${LOG_RAW_SELECT.join(",\n  ")}
FROM otel_logs
WHERE ${conds.join(" AND ")}
${orderSql}
LIMIT {${limitParam}:UInt32}`;
  return { sql, params: ctx.params };
}

const METRIC_COMMON_COLS = [
  "ResourceAttributes",
  "ResourceSchemaUrl",
  "ScopeName",
  "ScopeVersion",
  "ScopeAttributes",
  "ScopeDroppedAttrCount",
  "ScopeSchemaUrl",
  "ServiceName",
  "MetricName",
  "MetricDescription",
  "MetricUnit",
  "Attributes",
  "StartTimeUnix",
  "TimeUnix",
];

const METRIC_EXEMPLAR_COLS = [
  "`Exemplars.FilteredAttributes`",
  "`Exemplars.TimeUnix`",
  "`Exemplars.Value`",
  "`Exemplars.SpanId`",
  "`Exemplars.TraceId`",
];

const METRIC_TYPE_SPECIFIC_COLS: Record<string, string[]> = {
  Gauge: ["Value", "Flags"],
  Sum: ["Value", "Flags", "AggregationTemporality", "IsMonotonic"],
  Histogram: [
    "Count",
    "Sum",
    "BucketCounts",
    "ExplicitBounds",
    "Min",
    "Max",
    "AggregationTemporality",
  ],
  ExponentialHistogram: [
    "Count",
    "Sum",
    "Scale",
    "ZeroCount",
    "PositiveOffset",
    "PositiveBucketCounts",
    "NegativeOffset",
    "NegativeBucketCounts",
    "Min",
    "Max",
    "AggregationTemporality",
  ],
  Summary: [
    "Count",
    "Sum",
    "`ValueAtQuantiles.Quantile`",
    "`ValueAtQuantiles.Value`",
  ],
};

export function metricTypeFromQuery(q: KopaiQuery): datasource.MetricType {
  return kopaiQueryCompiler.extractMetricType(q);
}

function buildMetricRaw(q: MetricRawQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  const metricType = metricTypeFromQuery(q);
  const table = METRIC_TABLE_BY_TYPE[metricType];
  if (!table) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Unknown metric type: ${metricType}`
    );
  }
  const typeSpecific = METRIC_TYPE_SPECIFIC_COLS[metricType] ?? [];
  const includeExemplars = metricType !== "Summary";
  const cols = [
    ...METRIC_COMMON_COLS,
    ...(includeExemplars ? METRIC_EXEMPLAR_COLS : []),
    ...typeSpecific,
  ];

  const ctx = newParamCtx();
  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const conds: string[] = [];
  conds.push(compileTimeRange("metrics", win, ctx));

  const stripped = stripMetricTypeFilter(q.filters);
  const filterSql = compileFilters("metrics", stripped, ctx);
  if (filterSql) conds.push(filterSql);

  if (q.cursor) {
    assertCursorCompatibleOrderBy("metrics", q.orderBy);
    const c = parseCursor(q.cursor, { requireUInt64Id: true });
    const tsParam = nextParam(ctx, nanosToDateTime64(c.ts), "curTs");
    const hashParam = nextParam(ctx, c.id, "curHash");
    const sortDir = inferPrimaryDir(q.orderBy);
    if (sortDir === "desc") {
      conds.push(
        `(TimeUnix < {${tsParam}:DateTime64(9)} OR (TimeUnix = {${tsParam}:DateTime64(9)} AND sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) < {${hashParam}:UInt64}))`
      );
    } else {
      conds.push(
        `(TimeUnix > {${tsParam}:DateTime64(9)} OR (TimeUnix = {${tsParam}:DateTime64(9)} AND sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) > {${hashParam}:UInt64}))`
      );
    }
  }

  const orderInfo = compileOrderByRaw("metrics", q.orderBy, "TimeUnix");
  const orderSql = ensureTiebreaker(
    orderInfo.sql,
    "_rowHash",
    inferPrimaryDir(q.orderBy)
  );

  const limit = (q.limit ?? 100) + 1;
  const limitParam = nextParam(ctx, limit, "lim");

  const sql = `SELECT
  ${cols.join(",\n  ")},
  sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) AS _rowHash
FROM ${table}
WHERE ${conds.join(" AND ")}
${orderSql}
LIMIT {${limitParam}:UInt32}`;
  return { sql, params: ctx.params };
}

// ---------------------------------------------------------------------------
// Aggregate builders
// ---------------------------------------------------------------------------

function buildTraceAggregate(q: TraceAggregateQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  return buildAggregateSql({
    signal: "traces",
    table: "otel_traces",
    q,
  });
}

function buildLogAggregate(q: LogAggregateQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  return buildAggregateSql({
    signal: "logs",
    table: "otel_logs",
    q,
  });
}

function buildMetricAggregate(q: MetricAggregateQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  const metricType = metricTypeFromQuery(q);
  const table = METRIC_TABLE_BY_TYPE[metricType];
  if (!table) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Unknown metric type: ${metricType}`
    );
  }
  if (kopaiQueryCompiler.distributionMeasures(q).length > 0) {
    return buildStagedMetricAggregateSql(q, metricType, table);
  }
  return buildAggregateSql({
    signal: "metrics",
    table,
    q,
    stripFilters: true,
  });
}

// ---------------------------------------------------------------------------
// Staged metric aggregate: distribution and counter ops (KOP-70)
// ---------------------------------------------------------------------------
// nibbler spec-kopaiquery-distribution-ops sections 4 and 5; ADR-062 has the
// reasons. A query with one of the new ops runs in three stages:
//
//   $w, $s    row stage: scan the window plus a 5-minute lookback; a window
//             function pairs each point with the previous eligible point of
//             its series and temporality; $s turns the pair into a step.
//   $series   one row per (group, bucket, series[, bucket layout]): sums of
//             in-window eligible steps, and -State partials of every other
//             measure, so those still see every in-window row.
//   final     merges the partials per (group, bucket), merges histogram
//             vectors onto their shared bounds and interpolates.
//
// Internal names start with $ and are backtick-quoted. No result key can
// equal one: an alias matches the Alias regex (no $) and an attribute key
// is `${container}.${key}` (has a dot). ClickHouse resolves an alias before
// a column of the same name, so a shared name would silently change values.

function internal(name: string): string {
  return "`$" + name + "`";
}

const LOOKBACK_NS = 300n * 1_000_000_000n;
const QUANTILE_EPSILON = "1e-9";

type StagedType = "Sum" | "Histogram" | "Summary";

function stagedType(metricType: string): StagedType {
  if (
    metricType === "Sum" ||
    metricType === "Histogram" ||
    metricType === "Summary"
  ) {
    return metricType;
  }
  // The validator refuses the new ops on every other type (V1, V10).
  throw new kopaiQueryCompiler.KopaiQueryValidationError(
    `Distribution and counter ops are not supported on MetricType ${metricType}.`
  );
}

interface StagedMeasure {
  /** Expressions the row stage must project (inputs to -State). */
  rowExprs: string[];
  /** Series-stage aggregates. */
  seriesExprs: string[];
  /** Final-stage expressions, aliased to result keys. */
  finalExprs: string[];
}

function buildStagedMetricAggregateSql(
  q: MetricAggregateQuery,
  metricType: string,
  table: string
): { sql: string; params: Record<string, unknown> } {
  const type = stagedType(metricType);
  const ctx = newParamCtx();
  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const startP = nextParam(
    ctx,
    nanosToDateTime64(win.startNs.toString()),
    "tsLo"
  );
  const endP = nextParam(ctx, nanosToDateTime64(win.endNs.toString()), "tsHi");
  const scanP = nextParam(
    ctx,
    nanosToDateTime64((win.startNs - LOOKBACK_NS).toString()),
    "tsScan"
  );
  const start = `{${startP}:DateTime64(9)}`;

  const conds = [
    `TimeUnix >= {${scanP}:DateTime64(9)}`,
    `TimeUnix < {${endP}:DateTime64(9)}`,
  ];
  const filterSql = compileFilters(
    "metrics",
    stripMetricTypeFilter(q.filters),
    ctx
  );
  if (filterSql) conds.push(filterSql);

  const bucketSeconds =
    q.output.type === "timeSeries"
      ? kopaiQueryCompiler.granularityToSeconds(q.output.granularity)
      : null;
  const seconds = bucketSeconds ?? windowSecondsFromWindow(win);

  // Dimensions and bucket: group keys at every stage.
  const dims = (q.dimensions ?? []).map((d, i) => {
    const r = resolveRefSql("metrics", toColumnRef(d));
    return {
      name: internal(`d${String(i)}`),
      sql: r.sql,
      key: r.projectionKey,
    };
  });
  const groupKeys = dims.map((d) => d.name);
  const rowSelect = dims.map((d) => `${d.sql} AS ${d.name}`);
  const finalSelect = dims.map((d) => `${d.name} AS ${escapeIdent(d.key)}`);
  if (bucketSeconds !== null) {
    rowSelect.push(
      `toStartOfInterval(TimeUnix, INTERVAL ${String(bucketSeconds)} SECOND) AS \`$bucket\``
    );
    groupKeys.push("`$bucket`");
    finalSelect.push("`$bucket` AS bucket_start");
  }

  // Row stage: series key, eligibility, values and their previous values.
  const hasTemp = type !== "Summary";
  const eligibleSql = hasTemp
    ? "(bitAnd(Flags, 1) = 0 AND AggregationTemporality IN (1, 2))"
    : "(bitAnd(Flags, 1) = 0)";
  const orderValue = type === "Sum" ? "Value" : "Count";
  const partition = [METRIC_SERIES_KEY_SQL, eligibleSql];
  if (hasTemp) partition.push("AggregationTemporality");
  rowSelect.push(
    `${METRIC_SERIES_KEY_SQL} AS \`$sk\``,
    "TimeUnix AS `$t`",
    "StartTimeUnix AS `$st`",
    "MetricUnit AS `$unit`",
    `${eligibleSql} AS \`$eligible\``,
    `TimeUnix >= ${start} AS \`$in_window\``,
    "row_number() OVER `$win` AS `$rn`",
    "lagInFrame(StartTimeUnix) OVER `$win` AS `$p_st`"
  );
  if (hasTemp) rowSelect.push("AggregationTemporality AS `$temp`");
  if (type === "Sum") {
    rowSelect.push("Value AS `$v`", "lagInFrame(Value) OVER `$win` AS `$p_v`");
  } else if (type === "Histogram") {
    rowSelect.push(
      "toInt64(Count) AS `$count`",
      "Sum AS `$sum`",
      "arrayMap(x -> toInt64(x), BucketCounts) AS `$bc`",
      "ExplicitBounds AS `$bounds`",
      "lagInFrame(toInt64(Count)) OVER `$win` AS `$p_count`",
      "lagInFrame(Sum) OVER `$win` AS `$p_sum`",
      "lagInFrame(arrayMap(x -> toInt64(x), BucketCounts)) OVER `$win` AS `$p_bc`",
      "lagInFrame(ExplicitBounds) OVER `$win` AS `$p_bounds`"
    );
  } else {
    rowSelect.push(
      "Count AS `$count`",
      "`ValueAtQuantiles.Quantile` AS `$qs`",
      "`ValueAtQuantiles.Value` AS `$qv`"
    );
  }

  // Step stage (spec 4.2). $mode: 1 = the point is the step (delta, reset,
  // or a series that started inside the window), 0 = baseline only,
  // 2 = difference from the previous point.
  const plausible = "(toUnixTimestamp64Nano(`$st`) > 0 AND `$st` < `$t`)";
  const startReset = `(\`$st\` > \`$p_st\` AND ${plausible})`;
  const firstPoint = `if(${plausible} AND \`$st\` >= ${start}, 1, 0)`;
  const stepSelect = ["*"];
  if (type === "Sum") {
    stepSelect.push(
      `multiIf(\`$temp\` = 1, 1, \`$rn\` = 1, ${firstPoint}, \`$v\` < \`$p_v\` OR ${startReset}, 1, 2) AS \`$mode\``,
      "multiIf(`$mode` = 1, `$v`, `$mode` = 0, 0, `$v` - `$p_v`) AS `$step_v`"
    );
  } else if (type === "Histogram") {
    // Arrays of unequal length make element-wise functions throw, and the
    // previous vector is [] on a series' first point or a different length
    // after a layout change: normalise it before any arithmetic. Only a
    // change of bounds resets; counts of another length (malformed, spec
    // 4.4 step 0) are differenced against zeros.
    stepSelect.push(
      "(`$rn` > 1 AND `$p_bounds` = `$bounds`) AS `$same_bounds`",
      "(`$same_bounds` AND length(`$p_bc`) = length(`$bc`)) AS `$same_layout`",
      "if(`$same_layout`, `$p_bc`, arrayWithConstant(length(`$bc`), toInt64(0))) AS `$prev_bc`",
      "((length(`$bc`) > 0 AND length(`$bc`) != length(`$bounds`) + 1) OR (`$rn` > 1 AND length(`$p_bc`) > 0 AND length(`$p_bc`) != length(`$p_bounds`) + 1)) AS `$malformed`",
      `multiIf(\`$temp\` = 1, 1, \`$rn\` = 1, ${firstPoint}, \`$count\` < \`$p_count\` OR NOT \`$same_bounds\` OR arrayExists((c, p) -> c < p, \`$bc\`, \`$prev_bc\`) OR ${startReset}, 1, 2) AS \`$mode\``,
      "multiIf(`$mode` = 1, `$count`, `$mode` = 0, 0, `$count` - `$p_count`) AS `$step_count`",
      "multiIf(`$mode` = 1, `$sum`, `$mode` = 0, 0, `$sum` - `$p_sum`) AS `$step_sum`",
      "multiIf(`$mode` = 1, `$bc`, `$mode` = 0, arrayWithConstant(length(`$bc`), toInt64(0)), arrayMap((c, p) -> c - p, `$bc`, `$prev_bc`)) AS `$step_vec`"
    );
  }

  // Measures.
  const seriesGroup = [...groupKeys, "`$sk`"];
  if (type === "Histogram") seriesGroup.push("`$bounds`");
  const seriesSelect = [...groupKeys, "`$sk`", "any(`$unit`) AS `$unit`"];
  if (type === "Histogram") seriesSelect.push("`$bounds`");
  const finalMeasures: string[] = [];
  const histogramAliases = new Set<string>();
  const quantiles: { as: string; quantile: number; i: number }[] = [];
  let avgPartsNeeded = false;

  q.measures.forEach((raw, i) => {
    const m = raw as MeasureExprShape;
    const alias = escapeIdent(m.as);
    switch (m.op) {
      case "INCREASE":
      case "RATE": {
        const step =
          type === "Sum"
            ? "`$step_v`"
            : m.column === "Sum"
              ? "`$step_sum`"
              : "`$step_count`";
        const inc = internal(`inc${String(i)}`);
        // sumIf over no matching rows is 0, not NULL: guard it, so a series
        // with no eligible point stays NULL through the group-stage sum.
        seriesSelect.push(
          `if(countIf(\`$eligible\`) = 0, NULL, sumIf(${step}, \`$eligible\`)) AS ${inc}`
        );
        finalMeasures.push(
          m.op === "INCREASE"
            ? `sum(${inc}) AS ${alias}`
            : `(sum(${inc}) / ${String(seconds)}) AS ${alias}`
        );
        return;
      }
      case "SUMMARY_QUANTILE": {
        const match = `abs(x - ${String(m.quantile)}) < ${QUANTILE_EPSILON}`;
        const sq = internal(`sq${String(i)}`);
        // Latest eligible point per series and bucket; it counts only if it
        // carries the quantile (spec 4.6).
        seriesSelect.push(
          `argMaxIf(tuple(arrayExists(x -> ${match}, \`$qs\`), \`$qv\`[arrayFirstIndex(x -> ${match}, \`$qs\`)]), tuple(\`$t\`, \`$st\`, \`$count\`), \`$eligible\`) AS ${sq}`
        );
        finalMeasures.push(
          `if(countIf(tupleElement(${sq}, 1)) = 0, NULL, maxIf(tupleElement(${sq}, 2), tupleElement(${sq}, 1))) AS ${alias}`
        );
        return;
      }
      case "HISTOGRAM_AVG": {
        avgPartsNeeded = true;
        histogramAliases.add(m.as);
        const mixed = "uniqExactIf(`$unit`, `$hc` != 0) > 1";
        finalMeasures.push(
          `if(${mixed} OR sum(\`$hc\`) = 0, NULL, sum(\`$hs\`) / sum(\`$hc\`)) AS ${alias}`,
          `if(${mixed}, 'mixed_units', NULL) AS ${escapeIdent(`${m.as}_error`)}`
        );
        return;
      }
      case "HISTOGRAM_QUANTILE": {
        histogramAliases.add(m.as);
        quantiles.push({ as: m.as, quantile: m.quantile, i });
        return;
      }
      default: {
        const staged = stagedExistingMeasure(m, i, seconds);
        rowSelect.push(...staged.rowExprs);
        seriesSelect.push(...staged.seriesExprs);
        finalMeasures.push(...staged.finalExprs);
      }
    }
  });
  // Histogram quantiles past the GROUP BY. Each intermediate gets its own
  // query level so the next one reads it as a column: an alias would be
  // inlined at every use, and these nest ($hRM ← $hM ← $hS ← $hv), so
  // the expression tree, and planning time, grow with every reference.
  const levels: string[][] = [];
  if (quantiles.length > 0) {
    seriesSelect.push(
      "sumForEachIf(`$step_vec`, `$eligible`) AS `$vec`",
      "countIf(`$eligible` AND `$malformed`) AS `$hbad`"
    );
    // Kept vectors (spec 4.4 step 1): one per series and layout.
    finalMeasures.push(
      "arrayFilter(x -> arrayExists(c -> c != 0, tupleElement(x, 2)), groupArray(tuple(`$bounds`, `$vec`, `$unit`))) AS `$hv`",
      "sum(`$hbad`) AS `$hbad_n`"
    );
    levels.push(
      [
        "arrayDistinct(arrayMap(x -> tupleElement(x, 3), `$hv`)) AS `$hunits`",
        "arrayDistinct(arrayMap(x -> tupleElement(x, 1), `$hv`)) AS `$hlayouts`",
      ],
      [
        "arraySort(arrayFold((acc, b) -> arrayIntersect(acc, b), `$hlayouts`, `$hlayouts`[1])) AS `$hS`",
      ],
      [
        // Coarsen each vector onto $hS: running totals read off at the
        // shared bounds, the total appended, neighbours subtracted; then sum.
        "arrayReduce('sumForEach', arrayMap(x -> arrayPopFront(arrayDifference(arrayPushFront(arrayPushBack(arrayFilter((r, b) -> has(`$hS`, b), arrayResize(arrayCumSum(tupleElement(x, 2)), length(tupleElement(x, 1))), tupleElement(x, 1)), arraySum(tupleElement(x, 2))), toInt64(0)))), `$hv`)) AS `$hM`",
        "multiIf(`$hbad_n` > 0, 'malformed_buckets', length(`$hv`) = 0, 'none', length(`$hunits`) > 1, 'mixed_units', arrayAll(x -> length(tupleElement(x, 1)) = 0, `$hv`), 'none', length(`$hS`) = 0, 'no_shared_bounds', 'ok') AS `$hstate`",
      ],
      ["arrayCumSum(`$hM`) AS `$hRM`"]
    );
    const parts = quantiles.map((h) =>
      histogramQuantileSql(h.as, h.quantile, h.i)
    );
    levels.push(
      parts.map((p) => p.target),
      parts.map((p) => p.index),
      parts.flatMap((p) => p.keys)
    );
  }
  if (avgPartsNeeded) {
    seriesSelect.push(
      "sumIf(`$step_sum`, `$eligible`) AS `$hs`",
      "sumIf(`$step_count`, `$eligible`) AS `$hc`"
    );
  }

  // HAVING (spec 4.7): a histogram op's errored group always survives. Applied
  // on the outer query, where every result key is a plain column.
  let havingSql = "";
  if (q.havings && q.havings.length > 0) {
    const parts = q.havings.map((h) => {
      const p = nextParam(ctx, h.value, "hv");
      const cond = `${escapeIdent(h.measure)} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[h.op]} {${p}:Float64}`;
      return histogramAliases.has(h.measure)
        ? `((${cond}) OR ${escapeIdent(`${h.measure}_error`)} IS NOT NULL)`
        : `(${cond})`;
    });
    havingSql = `WHERE ${parts.join(" AND ")}`;
  }

  let orderSql = "";
  if (q.orderBy && q.orderBy.length > 0) {
    const parts = q.orderBy.map((o) => {
      const dir = o.direction.toUpperCase();
      if (o.type === "measure") {
        return `${escapeIdent(o.alias)} ${dir} NULLS LAST`;
      }
      const key = resolveRefSql("metrics", toColumnRef(o.column)).projectionKey;
      return `${escapeIdent(key)} ${dir}`;
    });
    orderSql = `ORDER BY ${parts.join(", ")}`;
  }

  let limitSql = "";
  if (q.limit !== undefined) {
    const p = nextParam(ctx, q.limit, "lim");
    limitSql = `LIMIT {${p}:UInt32}`;
  }

  // The final stage also projects its intermediates ($hv, $hS, …); the
  // outer query keeps only the result keys, in dimension-then-measure order.
  const resultKeys = dims.map((d) => d.key);
  if (bucketSeconds !== null) resultKeys.push("bucket_start");
  for (const m of q.measures) {
    resultKeys.push(m.as);
    if (kopaiQueryCompiler.isDistributionOp(m.op)) {
      for (const suffix of kopaiQuery.DISTRIBUTION_OP_EXTRA_KEYS[m.op]) {
        resultKeys.push(`${m.as}${suffix}`);
      }
    }
  }

  const finalGroup =
    groupKeys.length > 0 ? `GROUP BY ${groupKeys.join(", ")}` : "";
  let body = `SELECT
    ${[...finalSelect, ...finalMeasures].join(",\n    ")}
  FROM \`$series\`
  ${finalGroup}`;
  for (const level of levels) {
    body = `SELECT *, ${level.join(", ")}
  FROM (
  ${body}
  )`;
  }
  const sql = `WITH
\`$w\` AS (
  SELECT
    ${rowSelect.join(",\n    ")}
  FROM ${table}
  WHERE ${conds.join(" AND ")}
  WINDOW \`$win\` AS (PARTITION BY ${partition.join(", ")} ORDER BY TimeUnix, StartTimeUnix, ${orderValue} ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
),
\`$s\` AS (
  SELECT ${stepSelect.join(",\n    ")}
  FROM \`$w\`
),
\`$series\` AS (
  SELECT
    ${seriesSelect.join(",\n    ")}
  FROM \`$s\`
  WHERE \`$in_window\`
  GROUP BY ${seriesGroup.join(", ")}
)
SELECT ${resultKeys.map(escapeIdent).join(", ")}
FROM (
  ${body}
)
${havingSql}
${orderSql}
${limitSql}`.trim();
  return { sql, params: ctx.params };
}

// The five keys of one HISTOGRAM_QUANTILE (spec 4.4 step 9), in three
// levels: the target rank, the bucket it falls in, then the keys. Reads the
// $hS/$hM/$hRM/$hstate columns of the levels before.
function histogramQuantileSql(
  as: string,
  quantile: number,
  i: number
): { target: string; index: string; keys: string[] } {
  const n = "length(`$hS`)";
  const target = internal(`ht${String(i)}`);
  const idx = internal(`hi${String(i)}`);
  const ok = "`$hstate` = 'ok'";
  return {
    target: `(${String(quantile)} * \`$hRM\`[-1]) AS ${target}`,
    index: `arrayFirstIndex(x -> x >= ${target}, \`$hRM\`) AS ${idx}`,
    keys: [
      `multiIf(NOT ${ok}, NULL, ${idx} = ${n} + 1, \`$hS\`[${n}], ${idx} = 1, if(\`$hS\`[1] > 0, \`$hS\`[1] * ${target} / \`$hM\`[1], \`$hS\`[1]), \`$hS\`[${idx} - 1] + (\`$hS\`[${idx}] - \`$hS\`[${idx} - 1]) * (${target} - \`$hRM\`[${idx} - 1]) / \`$hM\`[${idx}]) AS ${escapeIdent(as)}`,
      `multiIf(NOT ${ok}, NULL, ${idx} = ${n} + 1, \`$hS\`[${n}], ${idx} = 1, if(\`$hS\`[1] > 0, 0, NULL), \`$hS\`[${idx} - 1]) AS ${escapeIdent(`${as}_low`)}`,
      `multiIf(NOT ${ok}, NULL, ${idx} = ${n} + 1, NULL, \`$hS\`[${idx}]) AS ${escapeIdent(`${as}_high`)}`,
      `multiIf(\`$hstate\` = 'no_shared_bounds', 1, ${ok}, length(\`$hlayouts\`) > 1, 0) AS ${escapeIdent(`${as}_coarsened`)}`,
      `if(\`$hstate\` IN ('malformed_buckets', 'mixed_units', 'no_shared_bounds'), \`$hstate\`, NULL) AS ${escapeIdent(`${as}_error`)}`,
    ],
  };
}

// Existing measures next to a new op: -State per series, -Merge per group, so
// a P* or COUNT gives the same value with or without the new op present.
function stagedExistingMeasure(
  m: MeasureExprShape,
  i: number,
  seconds: number
): StagedMeasure {
  const alias = escapeIdent(m.as);
  const input = internal(`in${String(i)}`);
  const state = internal(`m${String(i)}`);
  if (m.op === "COUNT") {
    return {
      rowExprs: [],
      seriesExprs: [`countState() AS ${state}`],
      finalExprs: [`countMerge(${state}) AS ${alias}`],
    };
  }
  if (!("column" in m)) {
    throw new Error(`Measure ${m.op} is not available on metrics.`);
  }
  const r = resolveRefSql("metrics", m.column);
  if (m.op === "COUNT_DISTINCT") {
    return {
      rowExprs: [`${r.isString ? `nullIf(${r.sql}, '')` : r.sql} AS ${input}`],
      seriesExprs: [`uniqState(${input}) AS ${state}`],
      finalExprs: [`uniqMerge(${state}) AS ${alias}`],
    };
  }
  const rowExprs = [`${numericCast(r)} AS ${input}`];
  if (isPercentileOp(m.op)) {
    const level = String(QUANTILE_MAP[m.op]);
    const det = internal(`det${String(i)}`);
    return {
      rowExprs: [...rowExprs, `${PERCENTILE_DETERMINATOR.metrics} AS ${det}`],
      seriesExprs: [
        `quantileDeterministicState(${level})(${input}, ${det}) AS ${state}`,
      ],
      finalExprs: [
        `quantileDeterministicMerge(${level})(${state}) AS ${alias}`,
      ],
    };
  }
  const fn: Record<string, [string, boolean]> = {
    SUM: ["sum", false],
    AVG: ["avg", false],
    MIN: ["min", false],
    MAX: ["max", false],
    RATE_SUM: ["sum", true],
    RATE_AVG: ["avg", true],
    RATE_MAX: ["max", true],
  };
  const spec = fn[m.op];
  if (!spec) throw new Error(`Unknown measure: ${JSON.stringify(m)}`);
  const [agg, rate] = spec;
  const merged = `${agg}Merge(${state})`;
  return {
    rowExprs,
    seriesExprs: [`${agg}State(${input}) AS ${state}`],
    finalExprs: [
      `${rate ? `(${merged} / ${String(seconds)})` : merged} AS ${alias}`,
    ],
  };
}

function buildAggregateSql(args: {
  signal: Signal;
  table: string;
  q: TraceAggregateQuery | LogAggregateQuery | MetricAggregateQuery;
  stripFilters?: boolean;
}): { sql: string; params: Record<string, unknown> } {
  const { signal, table, q } = args;
  const ctx = newParamCtx();
  // Compute the time window once: both the WHERE-clause range and the
  // per-window RATE_*/THROUGHPUT denominator derive from the same
  // `now`. Recomputing would let the two disagree by sub-ms.
  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const conds: string[] = [];
  conds.push(compileTimeRange(signal, win, ctx));
  const filters = args.stripFilters
    ? stripMetricTypeFilter(q.filters)
    : q.filters;
  const filterSql = compileFilters(signal, filters, ctx);
  if (filterSql) conds.push(filterSql);

  // bucketing
  const bucketSeconds =
    q.output.type === "timeSeries"
      ? kopaiQueryCompiler.granularityToSeconds(q.output.granularity)
      : null;
  const windowSeconds = windowSecondsFromWindow(win);

  // dimensions
  const dims: unknown[] = q.dimensions ?? [];
  const groupBySql: string[] = [];
  const selectDimSql: string[] = [];
  for (const d of dims) {
    const r = resolveRefSql(signal, toColumnRef(d));
    const alias = escapeIdent(r.projectionKey);
    selectDimSql.push(`${r.sql} AS ${alias}`);
    groupBySql.push(r.sql);
  }
  if (bucketSeconds !== null) {
    const tsCol = kopaiQueryCompiler.timeColumnForSignal(signal);
    const bucketExpr = `toStartOfInterval(${tsCol}, INTERVAL ${String(bucketSeconds)} SECOND)`;
    selectDimSql.push(`${bucketExpr} AS bucket_start`);
    groupBySql.push(bucketExpr);
  }

  // measures
  const measureSql = q.measures.map((m) =>
    compileMeasure(signal, m, bucketSeconds, windowSeconds, ctx)
  );

  const selectAll = [...selectDimSql, ...measureSql];

  // HAVING
  let havingSql = "";
  if (q.havings && q.havings.length > 0) {
    const parts: string[] = [];
    for (const h of q.havings) {
      const p = nextParam(ctx, h.value, "hv");
      parts.push(
        `${escapeIdent(h.measure)} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[h.op]} {${p}:Float64}`
      );
    }
    havingSql = `HAVING ${parts.join(" AND ")}`;
  }

  // ORDER BY
  const orderSql = compileOrderByAggregate(signal, q.orderBy);

  // LIMIT
  let limitSql = "";
  if (q.limit !== undefined) {
    const p = nextParam(ctx, q.limit, "lim");
    limitSql = `LIMIT {${p}:UInt32}`;
  }

  const groupBySqlStr =
    groupBySql.length > 0 ? `GROUP BY ${groupBySql.join(", ")}` : "";

  const sql = `SELECT
  ${selectAll.join(",\n  ")}
FROM ${table}
WHERE ${conds.join(" AND ")}
${groupBySqlStr}
${havingSql}
${orderSql}
${limitSql}`.trim();
  return { sql, params: ctx.params };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsMetricTypeFilter(filters: AnyFilterExpr[]): boolean {
  for (const f of filters) {
    if ("and" in f) {
      if (containsMetricTypeFilter(f.and)) return true;
    } else if ("or" in f) {
      if (containsMetricTypeFilter(f.or)) return true;
    } else if (f.column === "MetricType") {
      return true;
    }
  }
  return false;
}

function stripMetricTypeFilter(
  filters: AnyFilterExpr[] | undefined
): AnyFilterExpr[] | undefined {
  if (!filters) return filters;
  const out: AnyFilterExpr[] = [];
  for (const f of filters) {
    if ("and" in f) {
      const inner = stripMetricTypeFilter(f.and);
      if (inner && inner.length > 0) {
        out.push({ and: inner });
      }
    } else if ("or" in f) {
      // OR groups can't be partially stripped without changing semantics.
      // The validator rejects MetricType inside OR as ambiguous, but the
      // SQL builder is also called directly in tests — duplicate the check
      // so a bypassed validation can't produce SQL referencing a column
      // (`MetricType`) that doesn't exist on the per-type metric tables.
      if (containsMetricTypeFilter(f.or)) {
        throw new kopaiQueryCompiler.KopaiQueryValidationError(
          "MetricType filter inside an OR branch is not supported. Place MetricType at the top level (AND)."
        );
      }
      out.push(f);
    } else if (
      f.column === "MetricType" &&
      (f.op === "eq" || f.op === "neq" || f.op === "in" || f.op === "notIn")
    ) {
      // drop
    } else {
      out.push(f);
    }
  }
  return out;
}

function inferPrimaryDir(orderBy: OrderItemRaw[] | undefined): "asc" | "desc" {
  if (!orderBy || orderBy.length === 0) return "desc";
  const first = orderBy[0];
  return first?.direction === "asc" ? "asc" : "desc";
}

// The raw-mode cursor predicate is keyed off the time column + a structural
// tiebreaker (SpanId for traces; the sipHash for logs/metrics). If the user
// specifies a non-time primary sort, ORDER BY no longer matches the predicate
// and pagination silently skips or repeats rows. Reject the combination so
// callers either drop the orderBy or sort on the time column.
function assertCursorCompatibleOrderBy(
  signal: Signal,
  orderBy: OrderItemRaw[] | undefined
): void {
  if (!orderBy || orderBy.length === 0) return;
  const timeCol = kopaiQueryCompiler.timeColumnForSignal(signal);
  // The keyset predicate resumes on (timeColumn, tiebreaker) only. Any other
  // sort key — a non-time primary OR a secondary key after the time column —
  // makes the ORDER BY disagree with the predicate and silently skips/repeats
  // rows. Allow only an empty orderBy or exactly the time column.
  const only = orderBy[0];
  const ok =
    orderBy.length === 1 &&
    only !== undefined &&
    only.type === "dimension" &&
    typeof only.column === "string" &&
    only.column === timeCol;
  if (!ok) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Cursor pagination requires orderBy to be empty or exactly the time column ("${timeCol}"); a secondary or non-time sort key desyncs keyset pagination. Got ${JSON.stringify(
        orderBy.map((o) =>
          o.type === "measure" ? `measure:${o.alias}` : o.column
        )
      )}.`
    );
  }
}

function ensureTiebreaker(
  baseOrderSql: string,
  tiebreakerCol: string,
  dir: "asc" | "desc"
): string {
  // Compare the tiebreaker against each ORDER BY key by its bare column token
  // — a loose substring check wrongly treats `ParentSpanId` as already
  // containing `SpanId` and drops the tiebreaker, leaving a non-unique sort.
  const body = baseOrderSql.replace(/^\s*ORDER BY\s+/i, "");
  const existingTokens = body.split(",").map((seg) => {
    const token = seg.trim().split(/\s+/)[0] ?? "";
    return token.replace(/`/g, "").toLowerCase();
  });
  if (existingTokens.includes(tiebreakerCol.toLowerCase())) return baseOrderSql;
  return `${baseOrderSql}, ${tiebreakerCol} ${dir.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export function buildKopaiSql(q: KopaiQuery): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (q.signal === "traces") {
    return q.mode === "raw" ? buildTraceRaw(q) : buildTraceAggregate(q);
  }
  if (q.signal === "logs") {
    return q.mode === "raw" ? buildLogRaw(q) : buildLogAggregate(q);
  }
  return q.mode === "raw" ? buildMetricRaw(q) : buildMetricAggregate(q);
}

// ---------------------------------------------------------------------------
// Raw cursor helper exposed to datasource
// ---------------------------------------------------------------------------

export function rawCursorIdField(signal: Signal): string {
  if (signal === "traces") return "SpanId";
  return "_rowHash";
}
