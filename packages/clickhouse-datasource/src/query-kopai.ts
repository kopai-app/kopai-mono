import {
  kopaiQueryCompiler,
  type datasource,
  type kopaiQuery,
} from "@kopai/core";
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
  | { op: NumericOpName; column: ColumnRefStructural; as: string };

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

function resolveRefSql(signal: Signal, ref: ColumnRef): ResolvedRef {
  if (typeof ref === "object") {
    // Direct attribute lookup like SpanAttributes['http.route']
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
  // ClickHouse backtick-quoted identifiers — accept any printable chars in
  // our controlled namespace (alpha/num/underscore/dot/dash). The set is
  // intentionally narrow; aliases come from KopaiQuery zod-validated input
  // (Alias regex is even stricter), so this throw is defensive. Surface as
  // a validation error so the API maps it to 400, not 500.
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Refusing unsafe SQL identifier: ${JSON.stringify(name)}`
    );
  }
  return `\`${name}\``;
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

function compileMeasure(
  signal: Signal,
  m: MeasureExprShape,
  bucketSeconds: number | null,
  windowSeconds: number,
  ctx: ParamCtx
): string {
  const alias = escapeIdent(m.as);
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
    return `uniq(${r.sql}) AS ${alias}`;
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
      return `quantile(${String(QUANTILE_MAP[m.op])})(${numCol}) AS ${alias}`;
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
  return buildAggregateSql({
    signal: "metrics",
    table,
    q,
    stripFilters: true,
  });
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
  const first = orderBy[0];
  if (!first || first.type !== "dimension") return;
  const timeCol = kopaiQueryCompiler.timeColumnForSignal(signal);
  const col = first.column;
  if (typeof col === "string" && col === timeCol) return;
  throw new kopaiQueryCompiler.KopaiQueryValidationError(
    `Cursor pagination requires the primary orderBy to be the time column ("${timeCol}"). Got ${JSON.stringify(col)}.`
  );
}

function ensureTiebreaker(
  baseOrderSql: string,
  tiebreakerCol: string,
  dir: "asc" | "desc"
): string {
  const lower = baseOrderSql.toLowerCase();
  if (lower.includes(tiebreakerCol.toLowerCase())) return baseOrderSql;
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
