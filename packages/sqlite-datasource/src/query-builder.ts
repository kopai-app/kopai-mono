// SQLite-side compiler for KopaiQuery. Backend-agnostic concerns
// (validation, time-window math, column resolution) live in
// @kopai/core/kopai-query-compiler.

import {
  kopaiQueryCompiler,
  type denormalizedSignals,
  type kopaiQuery as kopaiQueryNs,
  type datasource,
} from "@kopai/core";
import type { DatabaseSync } from "node:sqlite";

import {
  mapRowToOtelLogs,
  mapRowToOtelMetrics,
  mapRowToOtelTraces,
} from "./db-datasource.js";

type KopaiQuery = kopaiQueryNs.KopaiQuery;
type Signal = kopaiQueryNs.Signal;
type AnyFilterExpr = kopaiQueryCompiler.AnyFilterExpr;
type ColumnRef = kopaiQueryCompiler.ColumnRefStructural;

type SqlParam = string | number | bigint | null;

const TRACE_FULL_COLUMNS = [
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
  '"Events.Timestamp"',
  '"Events.Name"',
  '"Events.Attributes"',
  '"Links.TraceId"',
  '"Links.SpanId"',
  '"Links.TraceState"',
  '"Links.Attributes"',
];

const LOG_FULL_COLUMNS = [
  "Timestamp",
  "TraceId",
  "SpanId",
  "TraceFlags",
  "SeverityText",
  "SeverityNumber",
  "Body",
  "EventName",
  "LogAttributes",
  "ResourceAttributes",
  "ResourceSchemaUrl",
  "ServiceName",
  "ScopeName",
  "ScopeVersion",
  "ScopeAttributes",
  "ScopeSchemaUrl",
];

const METRIC_TABLE_BY_TYPE = kopaiQueryCompiler.METRIC_TYPE_TO_TABLE;

function metricFullColumns(metricType: string): string[] {
  const common = [
    "TimeUnix",
    "StartTimeUnix",
    "Attributes",
    "MetricName",
    "MetricDescription",
    "MetricUnit",
    "ResourceAttributes",
    "ResourceSchemaUrl",
    "ScopeAttributes",
    "ScopeDroppedAttrCount",
    "ScopeName",
    "ScopeSchemaUrl",
    "ScopeVersion",
    "ServiceName",
    "rowid AS _rowid",
  ];
  const exemplars = [
    '"Exemplars.FilteredAttributes"',
    '"Exemplars.SpanId"',
    '"Exemplars.TimeUnix"',
    '"Exemplars.TraceId"',
    '"Exemplars.Value"',
  ];
  switch (metricType) {
    case "Gauge":
      return [...common, ...exemplars, "Value", "Flags"];
    case "Sum":
      return [
        ...common,
        ...exemplars,
        "Value",
        "Flags",
        "AggregationTemporality",
        "IsMonotonic",
      ];
    case "Histogram":
      return [
        ...common,
        ...exemplars,
        "Count",
        "Sum",
        "BucketCounts",
        "ExplicitBounds",
        "Min",
        "Max",
        "AggregationTemporality",
      ];
    case "ExponentialHistogram":
      return [
        ...common,
        ...exemplars,
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
        "ZeroThreshold",
        "AggregationTemporality",
      ];
    case "Summary":
      return [
        ...common,
        "Count",
        "Sum",
        '"ValueAtQuantiles.Quantile"',
        '"ValueAtQuantiles.Value"',
      ];
    default:
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Unknown MetricType "${metricType}".`
      );
  }
}

function escapeJsonPath(key: string): string {
  return `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Escapes user input for use inside a SQLite LIKE pattern with ESCAPE
// '\'. Without this, literal `%` and `_` in the needle act as
// wildcards (e.g. contains("50%") would match "5" + anything).
function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Type guard for ColumnRef. The per-signal column refs (TraceColumnRef,
// LogColumnRef, MetricColumnRef) all share the structural shape
// `string | { container: string; key: string }`. When iterating over
// `q.orderBy[i].column` across the signal union, TS resolves the
// property type to `unknown` — this guard re-narrows it without an
// `as` cast. Validator has already verified the runtime shape.
function assertColumnRef(v: unknown): asserts v is ColumnRef {
  if (typeof v === "string") return;
  if (
    typeof v === "object" &&
    v !== null &&
    "container" in v &&
    "key" in v &&
    typeof v.container === "string" &&
    typeof v.key === "string"
  ) {
    return;
  }
  throw new kopaiQueryCompiler.KopaiQueryValidationError(
    "Internal: orderBy.column is not a valid ColumnRef shape."
  );
}

function quoteIdent(col: string): string {
  return `"${col}"`;
}

function quoteAlias(alias: string): string {
  return `"${alias.replace(/"/g, '""')}"`;
}

interface SqlFragment {
  sql: string;
  params: SqlParam[];
}

function columnSqlExpr(signal: Signal, ref: ColumnRef): SqlFragment {
  const resolved = kopaiQueryCompiler.resolveColumn(signal, ref);
  if (resolved.kind === "structural") {
    return { sql: quoteIdent(resolved.column), params: [] };
  }
  const path = escapeJsonPath(resolved.key);
  return {
    sql: `json_extract(${quoteIdent(resolved.container)}, ?)`,
    params: [path],
  };
}

function buildFilter(signal: Signal, f: AnyFilterExpr): SqlFragment {
  // Logical: key-based discrimination on `and`/`or`.
  if ("and" in f || "or" in f) {
    const children = "and" in f ? f.and : f.or;
    if (children.length === 0) return { sql: "1=1", params: [] };
    const parts = children.map((c) => buildFilter(signal, c));
    const joiner = "and" in f ? " AND " : " OR ";
    return {
      sql: "(" + parts.map((p) => p.sql).join(joiner) + ")",
      params: parts.flatMap((p) => p.params),
    };
  }

  // MetricType is synthetic on metrics — it routes table selection but
  // isn't a stored column. Drop the predicate; table choice enforces it.
  if (signal === "metrics" && f.column === "MetricType") {
    return { sql: "1=1", params: [] };
  }

  const col = columnSqlExpr(signal, f.column);

  switch (f.op) {
    case "isNull":
      return { sql: `${col.sql} IS NULL`, params: col.params };
    case "isNotNull":
      return { sql: `${col.sql} IS NOT NULL`, params: col.params };

    case "eq":
    case "neq": {
      // Polymorphic value — typeof picks the SQL coercion. Booleans
      // serialize to 0/1 (matches SQLite storage); strings/numbers
      // bind through directly.
      const opSql = f.op === "eq" ? "=" : "<>";
      const param = typeof f.value === "boolean" ? (f.value ? 1 : 0) : f.value;
      return { sql: `${col.sql} ${opSql} ?`, params: [...col.params, param] };
    }

    case "contains":
      // LIKE (not INSTR) matches the ClickHouse backend's ILIKE:
      // SQLite's default LIKE is case-insensitive for ASCII. We escape
      // `%`, `_`, `\` in the needle and declare `\` as the escape
      // character so user input is matched literally.
      return {
        sql: `${col.sql} LIKE ? ESCAPE '\\'`,
        params: [...col.params, `%${escapeLikePattern(f.value)}%`],
      };
    case "notContains":
      return {
        sql: `${col.sql} NOT LIKE ? ESCAPE '\\'`,
        params: [...col.params, `%${escapeLikePattern(f.value)}%`],
      };
    case "startsWith":
      return {
        sql: `${col.sql} LIKE ? ESCAPE '\\'`,
        params: [...col.params, `${escapeLikePattern(f.value)}%`],
      };
    case "endsWith":
      return {
        sql: `${col.sql} LIKE ? ESCAPE '\\'`,
        params: [...col.params, `%${escapeLikePattern(f.value)}`],
      };

    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return {
        sql: `${col.sql} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[f.op]} ?`,
        params: [...col.params, f.value],
      };

    case "in":
    case "notIn": {
      const placeholders = f.values.map(() => "?").join(", ");
      const opSql = f.op === "in" ? "IN" : "NOT IN";
      return {
        sql: `${col.sql} ${opSql} (${placeholders})`,
        params: [...col.params, ...f.values],
      };
    }
  }
}

// Wraps core's extractMetricType so the rest of this file keeps using
// a thin local name. Returns the typed MetricType (already runtime-
// validated by extractMetricType).
function metricTypeFromQuery(q: KopaiQuery): datasource.MetricType {
  return kopaiQueryCompiler.extractMetricType(q);
}

function buildTimeWhere(
  signal: Signal,
  win: kopaiQueryCompiler.CompiledTimeWindow
): SqlFragment {
  const col = kopaiQueryCompiler.timeColumnForSignal(signal);
  return {
    sql: `${col} >= ? AND ${col} < ?`,
    params: [win.startNs, win.endNs],
  };
}

// ============================================================
// Raw mode
// ============================================================

function defaultRawDirection(): "asc" | "desc" {
  return "desc";
}

function buildCursorWhere(
  signal: Signal,
  cursor: string,
  direction: "asc" | "desc"
): SqlFragment {
  // Canonical "<timestamp-nanos>:<id>" matches the clickhouse backend so
  // cursors round-trip identically regardless of which datasource served
  // the previous page.
  const sepIdx = cursor.indexOf(":");
  if (sepIdx === -1) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Invalid cursor format "${cursor}". Expected "<timestamp>:<id>".`
    );
  }
  const tsStr = cursor.slice(0, sepIdx);
  const idStr = cursor.slice(sepIdx + 1);
  const tsNs = BigInt(tsStr);
  const timeCol = kopaiQueryCompiler.timeColumnForSignal(signal);

  if (signal === "traces") {
    if (direction === "desc") {
      return {
        sql: `(${timeCol} < ? OR (${timeCol} = ? AND SpanId < ?))`,
        params: [tsNs, tsNs, idStr],
      };
    }
    return {
      sql: `(${timeCol} > ? OR (${timeCol} = ? AND SpanId > ?))`,
      params: [tsNs, tsNs, idStr],
    };
  }

  const rowid = parseInt(idStr, 10);
  if (Number.isNaN(rowid)) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Invalid cursor id "${idStr}" — expected integer rowid.`
    );
  }
  if (direction === "desc") {
    return {
      sql: `(${timeCol} < ? OR (${timeCol} = ? AND rowid < ?))`,
      params: [tsNs, tsNs, rowid],
    };
  }
  return {
    sql: `(${timeCol} > ? OR (${timeCol} = ? AND rowid > ?))`,
    params: [tsNs, tsNs, rowid],
  };
}

export interface RawTracesResult {
  data: denormalizedSignals.OtelTracesRow[];
  nextCursor: string | null;
}

export interface RawLogsResult {
  data: denormalizedSignals.OtelLogsRow[];
  nextCursor: string | null;
}

export interface RawMetricsResult {
  data: denormalizedSignals.OtelMetricsRow[];
  nextCursor: string | null;
}

interface RawPage {
  rows: Record<string, unknown>[];
  nextCursor: string | null;
  resolvedMetricType: datasource.MetricType | null;
}

interface CompiledRaw {
  sql: string;
  params: SqlParam[];
  signal: Signal;
  limit: number;
  resolvedMetricType: datasource.MetricType | null;
}

/**
 * Pure SQL+params build for a raw query. Split from the executor so
 * tests can assert on emitted SQL without a live DB connection (the
 * public entrypoint is `buildKopaiSql`).
 */
function compileRawSql(q: KopaiQuery & { mode: "raw" }): CompiledRaw {
  const signal = q.signal;
  const filters: AnyFilterExpr[] = q.filters ?? [];

  let table: string;
  let selectCols: string[];
  let resolvedMetricType: datasource.MetricType | null = null;

  if (signal === "traces") {
    table = "otel_traces";
    selectCols = [...TRACE_FULL_COLUMNS];
  } else if (signal === "logs") {
    table = "otel_logs";
    selectCols = [...LOG_FULL_COLUMNS, "rowid AS _rowid"];
  } else {
    resolvedMetricType = metricTypeFromQuery(q);
    table = METRIC_TABLE_BY_TYPE[resolvedMetricType] ?? "";
    if (!table) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Unknown MetricType "${resolvedMetricType}".`
      );
    }
    selectCols = metricFullColumns(resolvedMetricType);
  }

  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const wheres: SqlFragment[] = [buildTimeWhere(signal, win)];
  for (const f of filters) wheres.push(buildFilter(signal, f));

  const order = q.orderBy;
  const direction: "asc" | "desc" =
    order?.[0]?.direction ?? defaultRawDirection();

  if (q.cursor) {
    wheres.push(buildCursorWhere(signal, q.cursor, direction));
  }

  const orderParts: string[] = [];
  const orderParams: SqlParam[] = [];
  if (order && order.length > 0) {
    for (const o of order) {
      if (o.type === "measure") {
        throw new kopaiQueryCompiler.KopaiQueryValidationError(
          "orderBy measure is not allowed in raw mode."
        );
      }
      assertColumnRef(o.column);
      const colExpr = columnSqlExpr(signal, o.column);
      orderParams.push(...colExpr.params);
      orderParts.push(`${colExpr.sql} ${o.direction.toUpperCase()}`);
    }
  } else {
    const timeCol = kopaiQueryCompiler.timeColumnForSignal(signal);
    orderParts.push(`${timeCol} ${direction.toUpperCase()}`);
  }
  // Always append tiebreaker for stable pagination.
  const tiebreak = signal === "traces" ? "SpanId" : "rowid";
  orderParts.push(`${tiebreak} ${direction.toUpperCase()}`);

  const limit = q.limit ?? 100;

  const sql = [
    `SELECT ${selectCols.join(", ")}`,
    `FROM ${table}`,
    `WHERE ${wheres.map((w) => w.sql).join(" AND ")}`,
    `ORDER BY ${orderParts.join(", ")}`,
    `LIMIT ?`,
  ].join(" ");

  const params: SqlParam[] = [
    ...wheres.flatMap((w) => w.params),
    ...orderParams,
    limit + 1,
  ];

  return { sql, params, signal, limit, resolvedMetricType };
}

/**
 * Shared SQL build + fetch for raw queries across all three signals.
 * Returns the still-raw rows plus the resolved metric type (for the
 * metrics row mapper). The per-signal narrow runners below own the
 * mapping step so each has a concrete return shape.
 */
function runRawCore(
  conn: DatabaseSync,
  q: KopaiQuery & { mode: "raw" }
): RawPage {
  const compiled = compileRawSql(q);
  const stmt = conn.prepare(compiled.sql);
  stmt.setReadBigInts(true);
  const rawRows = stmt.all(...compiled.params);

  const hasMore = rawRows.length > compiled.limit;
  const pageRows = hasMore ? rawRows.slice(0, compiled.limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];

  let nextCursor: string | null = null;
  if (hasMore && lastRow) {
    const ts =
      compiled.signal === "metrics" ? lastRow.TimeUnix : lastRow.Timestamp;
    const id =
      compiled.signal === "traces"
        ? String(lastRow.SpanId)
        : String(lastRow._rowid);
    nextCursor = `${ts}:${id}`;
  }

  return {
    rows: pageRows,
    nextCursor,
    resolvedMetricType: compiled.resolvedMetricType,
  };
}

export function runRawTraces(
  conn: DatabaseSync,
  q: kopaiQueryNs.TraceRawQuery
): RawTracesResult {
  const page = runRawCore(conn, q);
  return {
    data: page.rows.map(mapRowToOtelTraces),
    nextCursor: page.nextCursor,
  };
}

export function runRawLogs(
  conn: DatabaseSync,
  q: kopaiQueryNs.LogRawQuery
): RawLogsResult {
  const page = runRawCore(conn, q);
  return { data: page.rows.map(mapRowToOtelLogs), nextCursor: page.nextCursor };
}

export function runRawMetrics(
  conn: DatabaseSync,
  q: kopaiQueryNs.MetricRawQuery
): RawMetricsResult {
  const page = runRawCore(conn, q);
  if (page.resolvedMetricType === null) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      "Metric raw query is missing MetricType filter."
    );
  }
  const metricType = page.resolvedMetricType;
  return {
    data: page.rows.map((r) => mapRowToOtelMetrics(r, metricType)),
    nextCursor: page.nextCursor,
  };
}

// ============================================================
// Aggregate mode
// ============================================================

const PERCENTILE_OPS = new Set(["P50", "P75", "P90", "P95", "P99", "P999"]);

const NUMERIC_AGG: Record<string, { fn: string; rate: boolean }> = {
  SUM: { fn: "SUM", rate: false },
  AVG: { fn: "AVG", rate: false },
  MIN: { fn: "MIN", rate: false },
  MAX: { fn: "MAX", rate: false },
  RATE_SUM: { fn: "SUM", rate: true },
  RATE_AVG: { fn: "AVG", rate: true },
  RATE_MAX: { fn: "MAX", rate: true },
};

export interface AggregateResult {
  data: kopaiQueryNs.KopaiAggregateRow[];
}

interface CompiledAggregate {
  sql: string;
  params: SqlParam[];
  dimAliases: { alias: string; key: string }[];
  measureAliases: string[];
  isTimeSeries: boolean;
}

/**
 * Pure SQL+params build for an aggregate query. Tests assert on the
 * emitted SQL via `buildKopaiSql`; runAggregate calls this and then
 * executes + post-processes the rows.
 */
function compileAggregateSql(
  q: KopaiQuery & { mode: "aggregate" }
): CompiledAggregate {
  const signal = q.signal;
  const filters: AnyFilterExpr[] = q.filters ?? [];

  let table: string;
  if (signal === "traces") table = "otel_traces";
  else if (signal === "logs") table = "otel_logs";
  else {
    const metricType = metricTypeFromQuery(q);
    table = METRIC_TABLE_BY_TYPE[metricType] ?? "";
    if (!table) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Unknown MetricType "${metricType}".`
      );
    }
  }

  const win = kopaiQueryCompiler.compileTimeWindow(q.timeDimension);
  const timeCol = kopaiQueryCompiler.timeColumnForSignal(signal);
  // BigInt division here would truncate sub-second components and skew
  // per-second rates (THROUGHPUT, SUM/denom, etc.). Convert to Number first.
  const windowSeconds = Math.max(Number(win.endNs - win.startNs) / 1e9, 1);

  const granularitySeconds =
    q.output.type === "timeSeries"
      ? kopaiQueryCompiler.granularityToSeconds(q.output.granularity)
      : null;
  const isTimeSeries = granularitySeconds !== null;
  const bucketWidthSeconds = granularitySeconds ?? windowSeconds;

  // Dimensions + GROUP BY
  const dimensions = q.dimensions ?? [];
  const dimAliases: { alias: string; key: string }[] = [];
  const dimSelectParts: string[] = [];
  const dimSelectParams: SqlParam[] = [];
  const groupByExprs: string[] = [];
  const groupByParams: SqlParam[] = [];

  if (isTimeSeries) {
    const bucketNs = BigInt(granularitySeconds) * 1_000_000_000n;
    dimSelectParts.push(`(${timeCol} / ?) * ? AS "bucket_start_ns"`);
    dimSelectParams.push(bucketNs, bucketNs);
    groupByExprs.push(`(${timeCol} / ?) * ?`);
    groupByParams.push(bucketNs, bucketNs);
  }

  for (const [i, d] of dimensions.entries()) {
    const expr = columnSqlExpr(signal, d);
    const alias = `dim_${String(i)}`;
    const projectionKey = kopaiQueryCompiler.columnRefProjectionKey(d);
    dimSelectParts.push(`${expr.sql} AS ${quoteAlias(alias)}`);
    dimSelectParams.push(...expr.params);
    groupByExprs.push(expr.sql);
    groupByParams.push(...expr.params);
    dimAliases.push({ alias, key: projectionKey });
  }

  // Measures
  const measures = q.measures;
  const measureSelectParts: string[] = [];
  const measureSelectParams: SqlParam[] = [];
  const measureAliases: string[] = [];

  for (const m of measures) {
    measureAliases.push(m.as);
    if (m.op === "COUNT") {
      measureSelectParts.push(`COUNT(*) AS ${quoteAlias(m.as)}`);
      continue;
    }
    if (m.op === "ERROR_RATE") {
      measureSelectParts.push(
        `AVG(CASE WHEN StatusCode = ? THEN 1.0 ELSE 0.0 END) AS ${quoteAlias(m.as)}`
      );
      measureSelectParams.push(kopaiQueryCompiler.STATUS_CODE_ERROR_LITERAL);
      continue;
    }
    if (m.op === "THROUGHPUT") {
      measureSelectParts.push(
        `(CAST(COUNT(*) AS REAL) / ?) AS ${quoteAlias(m.as)}`
      );
      measureSelectParams.push(bucketWidthSeconds);
      continue;
    }
    if (m.op === "COUNT_DISTINCT") {
      const expr = columnSqlExpr(signal, m.column);
      measureSelectParts.push(
        `COUNT(DISTINCT ${expr.sql}) AS ${quoteAlias(m.as)}`
      );
      measureSelectParams.push(...expr.params);
      continue;
    }
    if (PERCENTILE_OPS.has(m.op)) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        "Percentile measures (P50-P999) are not yet supported on the sqlite backend."
      );
    }
    // Numeric ops: every remaining measure compiles to `FN(expr)`,
    // optionally divided by the bucket window seconds for the RATE_*
    // variants. The op→fn map collapses 7 near-identical branches.
    const agg = NUMERIC_AGG[m.op];
    if (!agg) {
      throw new kopaiQueryCompiler.KopaiQueryValidationError(
        `Unsupported numeric measure op "${m.op}".`
      );
    }
    const expr = columnSqlExpr(signal, m.column);
    if (agg.rate) {
      measureSelectParts.push(
        `(${agg.fn}(${expr.sql}) / ?) AS ${quoteAlias(m.as)}`
      );
      measureSelectParams.push(...expr.params, bucketWidthSeconds);
    } else {
      measureSelectParts.push(`${agg.fn}(${expr.sql}) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params);
    }
  }

  // WHERE — reuses the time window already compiled above.
  const wheres: SqlFragment[] = [buildTimeWhere(signal, win)];
  for (const f of filters) wheres.push(buildFilter(signal, f));

  // HAVING
  let havingSql = "";
  const havingParams: SqlParam[] = [];
  if (q.havings && q.havings.length > 0) {
    const parts = q.havings.map((h) => {
      havingParams.push(h.value);
      return `${quoteAlias(h.measure)} ${kopaiQueryCompiler.NUMBER_COMPARATOR_SQL[h.op]} ?`;
    });
    havingSql = ` HAVING ${parts.join(" AND ")}`;
  }

  // ORDER BY
  let orderSql = "";
  const orderParams: SqlParam[] = [];
  if (q.orderBy && q.orderBy.length > 0) {
    const parts: string[] = [];
    for (const o of q.orderBy) {
      if (o.type === "measure") {
        parts.push(`${quoteAlias(o.alias)} ${o.direction.toUpperCase()}`);
      } else {
        assertColumnRef(o.column);
        const expr = columnSqlExpr(signal, o.column);
        orderParams.push(...expr.params);
        parts.push(`${expr.sql} ${o.direction.toUpperCase()}`);
      }
    }
    orderSql = ` ORDER BY ${parts.join(", ")}`;
  }

  // LIMIT
  let limitSql = "";
  const limitParams: SqlParam[] = [];
  if (q.limit !== undefined) {
    limitSql = ` LIMIT ?`;
    limitParams.push(q.limit);
  }

  const selectPieces = [...dimSelectParts, ...measureSelectParts];
  const selectParams = [...dimSelectParams, ...measureSelectParams];

  const groupBySql =
    groupByExprs.length > 0 ? ` GROUP BY ${groupByExprs.join(", ")}` : "";

  const whereSql = wheres.map((w) => w.sql).join(" AND ");
  const whereParams = wheres.flatMap((w) => w.params);

  const sql =
    `SELECT ${selectPieces.join(", ")} FROM ${table} WHERE ${whereSql}` +
    groupBySql +
    havingSql +
    orderSql +
    limitSql;

  const params: SqlParam[] = [
    ...selectParams,
    ...whereParams,
    ...groupByParams,
    ...havingParams,
    ...orderParams,
    ...limitParams,
  ];

  return { sql, params, dimAliases, measureAliases, isTimeSeries };
}

export function runAggregate(
  conn: DatabaseSync,
  q: KopaiQuery & { mode: "aggregate" }
): AggregateResult {
  const compiled = compileAggregateSql(q);

  const stmt = conn.prepare(compiled.sql);
  stmt.setReadBigInts(true);
  const rawRows = stmt.all(...compiled.params);

  const data: kopaiQueryNs.KopaiAggregateRow[] = rawRows.map((row) => {
    const out: kopaiQueryNs.KopaiAggregateRow = {};
    if (compiled.isTimeSeries) {
      const ns = row.bucket_start_ns;
      const ms =
        typeof ns === "bigint" ? Number(ns / 1_000_000n) : Number(ns) / 1e6;
      out.bucket_start = new Date(ms).toISOString();
    }
    for (const dim of compiled.dimAliases) {
      out[dim.key] = normalizeCellValue(row[dim.alias]);
    }
    for (const alias of compiled.measureAliases) {
      out[alias] = normalizeCellValue(row[alias]);
    }
    return out;
  });

  return { data };
}

/**
 * Top-level dispatcher: returns the SQL string + positional params that
 * would be prepared for `q`, without touching a connection. Tests use
 * this to assert on emitted SQL; production paths call the runners,
 * which call this internally.
 */
export function buildKopaiSql(q: KopaiQuery): {
  sql: string;
  params: SqlParam[];
} {
  if (q.mode === "raw") {
    const compiled = compileRawSql(q);
    return { sql: compiled.sql, params: compiled.params };
  }
  const compiled = compileAggregateSql(q);
  return { sql: compiled.sql, params: compiled.params };
}

function normalizeCellValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v);
}
