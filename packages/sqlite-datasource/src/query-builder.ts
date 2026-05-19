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

// Structural shapes used by the SQL builders. All narrow per-signal
// variants from @kopai/core assign here without `as unknown as` —
// validator already enforces runtime correctness so we don't need to
// preserve signal narrowness inside the SQL layer.
type OrderItemShape =
  | { type: "dimension"; column: ColumnRef; direction: "asc" | "desc" }
  | { type: "measure"; alias: string; direction: "asc" | "desc" };
type MeasureExprShape =
  | { op: "COUNT"; as: string }
  | { op: "ERROR_RATE"; as: string }
  | { op: "THROUGHPUT"; as: string }
  | { op: "COUNT_DISTINCT"; column: ColumnRef; as: string }
  | {
      op:
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
      column: ColumnRef;
      as: string;
    };

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

const METRIC_TABLE_BY_TYPE: Record<string, string> = {
  Gauge: "otel_metrics_gauge",
  Sum: "otel_metrics_sum",
  Histogram: "otel_metrics_histogram",
  ExponentialHistogram: "otel_metrics_exponential_histogram",
  Summary: "otel_metrics_summary",
};

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

function timeColumnFor(signal: Signal): string {
  return signal === "metrics" ? "TimeUnix" : "Timestamp";
}

function escapeJsonPath(key: string): string {
  return `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  if (f.kind === "logical") {
    if (f.filters.length === 0) return { sql: "1=1", params: [] };
    const parts = f.filters.map((c) => buildFilter(signal, c));
    const joiner = f.op === "and" ? " AND " : " OR ";
    return {
      sql: "(" + parts.map((p) => p.sql).join(joiner) + ")",
      params: parts.flatMap((p) => p.params),
    };
  }

  // MetricType is synthetic on metrics — it routes table selection but
  // isn't a stored column. Drop the predicate; table choice enforces it.
  if (signal === "metrics" && f.kind !== "null" && f.column === "MetricType") {
    return { sql: "1=1", params: [] };
  }
  if (signal === "metrics" && f.kind === "null" && f.column === "MetricType") {
    return { sql: "1=1", params: [] };
  }

  const col = columnSqlExpr(signal, f.column);

  if (f.kind === "null") {
    return {
      sql: `${col.sql} ${f.op === "isNull" ? "IS NULL" : "IS NOT NULL"}`,
      params: col.params,
    };
  }

  if (f.kind === "string") {
    switch (f.op) {
      case "eq":
        return { sql: `${col.sql} = ?`, params: [...col.params, f.value] };
      case "neq":
        return { sql: `${col.sql} <> ?`, params: [...col.params, f.value] };
      // TODO: escape `%`, `_`, and `\` in f.value before interpolating
      // into the LIKE pattern below. Without escaping, a needle like
      // "50%" matches "5" + anything. The ClickHouse backend uses
      // escapeLikePattern() in query-kopai.ts; SQLite should match
      // (with `... LIKE ? ESCAPE '\\'`). Pre-existing gap shared by
      // startsWith/endsWith; tracked separately from the contains-as-
      // LIKE switch.
      case "contains":
        // LIKE (not INSTR) so behavior matches the ClickHouse backend's
        // ILIKE — SQLite's default LIKE is case-insensitive for ASCII,
        // which is the parity guarantee for log-body searches.
        return {
          sql: `${col.sql} LIKE ?`,
          params: [...col.params, `%${f.value}%`],
        };
      case "notContains":
        return {
          sql: `${col.sql} NOT LIKE ?`,
          params: [...col.params, `%${f.value}%`],
        };
      case "startsWith":
        return {
          sql: `${col.sql} LIKE ?`,
          params: [...col.params, `${f.value}%`],
        };
      case "endsWith":
        return {
          sql: `${col.sql} LIKE ?`,
          params: [...col.params, `%${f.value}`],
        };
    }
  }

  if (f.kind === "stringIn") {
    const placeholders = f.values.map(() => "?").join(", ");
    const opSql = f.op === "in" ? "IN" : "NOT IN";
    return {
      sql: `${col.sql} ${opSql} (${placeholders})`,
      params: [...col.params, ...f.values],
    };
  }

  if (f.kind === "number") {
    const opMap = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    } as const;
    return {
      sql: `${col.sql} ${opMap[f.op]} ?`,
      params: [...col.params, f.value],
    };
  }

  if (f.kind === "numberIn") {
    const placeholders = f.values.map(() => "?").join(", ");
    const opSql = f.op === "in" ? "IN" : "NOT IN";
    return {
      sql: `${col.sql} ${opSql} (${placeholders})`,
      params: [...col.params, ...f.values],
    };
  }

  // boolean
  return {
    sql: `${col.sql} ${f.op === "eq" ? "=" : "<>"} ?`,
    params: [...col.params, f.value ? 1 : 0],
  };
}

// Wraps core's extractMetricType so the rest of this file keeps using
// a thin local name. Returns the typed MetricType (already runtime-
// validated by extractMetricType).
function metricTypeFromQuery(q: KopaiQuery): datasource.MetricType {
  return kopaiQueryCompiler.extractMetricType(q);
}

function buildTimeWhere(
  signal: Signal,
  td: KopaiQuery["timeDimension"]
): SqlFragment {
  const win = kopaiQueryCompiler.compileTimeWindow(td);
  const col = timeColumnFor(signal);
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
  const pipeIdx = cursor.indexOf("|");
  if (pipeIdx === -1) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      `Invalid cursor format "${cursor}". Expected "<timestamp>|<id>".`
    );
  }
  const tsStr = cursor.slice(0, pipeIdx);
  const idStr = cursor.slice(pipeIdx + 1);
  const tsNs = BigInt(tsStr);
  const timeCol = timeColumnFor(signal);

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

interface RawResult {
  data:
    | denormalizedSignals.OtelTracesRow[]
    | denormalizedSignals.OtelLogsRow[]
    | denormalizedSignals.OtelMetricsRow[];
  nextCursor: string | null;
}

function runRaw(
  conn: DatabaseSync,
  q: KopaiQuery & { mode: "raw" }
): RawResult {
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

  const wheres: SqlFragment[] = [buildTimeWhere(signal, q.timeDimension)];
  for (const f of filters) wheres.push(buildFilter(signal, f));

  const order = q.orderBy as OrderItemShape[] | undefined;
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
      const colExpr = columnSqlExpr(signal, o.column);
      orderParams.push(...colExpr.params);
      orderParts.push(`${colExpr.sql} ${o.direction.toUpperCase()}`);
    }
  } else {
    const timeCol = timeColumnFor(signal);
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

  const stmt = conn.prepare(sql);
  stmt.setReadBigInts(true);
  const rawRows = stmt.all(...params) as Record<string, unknown>[];

  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];

  let nextCursor: string | null = null;
  if (hasMore && lastRow) {
    const ts = signal === "metrics" ? lastRow.TimeUnix : lastRow.Timestamp;
    const id =
      signal === "traces" ? String(lastRow.SpanId) : String(lastRow._rowid);
    nextCursor = `${ts}|${id}`;
  }

  if (signal === "traces") {
    return { data: pageRows.map(mapRowToOtelTraces), nextCursor };
  }
  if (signal === "logs") {
    return { data: pageRows.map(mapRowToOtelLogs), nextCursor };
  }
  if (resolvedMetricType === null) {
    throw new kopaiQueryCompiler.KopaiQueryValidationError(
      "Metric raw query is missing MetricType filter."
    );
  }
  return {
    data: pageRows.map((r) => mapRowToOtelMetrics(r, resolvedMetricType)),
    nextCursor,
  };
}

// ============================================================
// Aggregate mode
// ============================================================

const PERCENTILE_OPS = new Set(["P50", "P75", "P90", "P95", "P99", "P999"]);

interface AggregateResult {
  data: kopaiQueryNs.KopaiAggregateRow[];
}

function runAggregate(
  conn: DatabaseSync,
  q: KopaiQuery & { mode: "aggregate" }
): AggregateResult {
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
  const timeCol = timeColumnFor(signal);
  const windowSeconds = Number((win.endNs - win.startNs) / 1_000_000_000n) || 1;

  const isTimeSeries = q.output.type === "timeSeries";
  const granularitySeconds =
    q.output.type === "timeSeries"
      ? kopaiQueryCompiler.granularityToSeconds(q.output.granularity)
      : null;
  const bucketWidthSeconds = granularitySeconds ?? windowSeconds;

  // Dimensions + GROUP BY
  const dimensions = (q.dimensions ?? []) as ColumnRef[];
  const dimAliases: { alias: string; key: string }[] = [];
  const dimSelectParts: string[] = [];
  const dimSelectParams: SqlParam[] = [];
  const groupByExprs: string[] = [];
  const groupByParams: SqlParam[] = [];

  if (isTimeSeries) {
    const bucketNs = BigInt(granularitySeconds!) * 1_000_000_000n;
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
  const measures = q.measures as MeasureExprShape[];
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
        `AVG(CASE WHEN StatusCode = 'STATUS_CODE_ERROR' THEN 1.0 ELSE 0.0 END) AS ${quoteAlias(m.as)}`
      );
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
    // Numeric ops
    const expr = columnSqlExpr(signal, m.column);
    if (m.op === "SUM") {
      measureSelectParts.push(`SUM(${expr.sql}) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params);
    } else if (m.op === "AVG") {
      measureSelectParts.push(`AVG(${expr.sql}) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params);
    } else if (m.op === "MIN") {
      measureSelectParts.push(`MIN(${expr.sql}) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params);
    } else if (m.op === "MAX") {
      measureSelectParts.push(`MAX(${expr.sql}) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params);
    } else if (m.op === "RATE_AVG") {
      measureSelectParts.push(`(AVG(${expr.sql}) / ?) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params, bucketWidthSeconds);
    } else if (m.op === "RATE_SUM") {
      measureSelectParts.push(`(SUM(${expr.sql}) / ?) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params, bucketWidthSeconds);
    } else if (m.op === "RATE_MAX") {
      measureSelectParts.push(`(MAX(${expr.sql}) / ?) AS ${quoteAlias(m.as)}`);
      measureSelectParams.push(...expr.params, bucketWidthSeconds);
    }
  }

  // WHERE
  const wheres: SqlFragment[] = [buildTimeWhere(signal, q.timeDimension)];
  for (const f of filters) wheres.push(buildFilter(signal, f));

  // HAVING
  let havingSql = "";
  const havingParams: SqlParam[] = [];
  if (q.havings && q.havings.length > 0) {
    const opMap = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    } as const;
    const parts = q.havings.map((h) => {
      havingParams.push(h.value);
      return `${quoteAlias(h.measure)} ${opMap[h.op]} ?`;
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
        const expr = columnSqlExpr(signal, o.column as ColumnRef);
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

  const stmt = conn.prepare(sql);
  stmt.setReadBigInts(true);
  const rawRows = stmt.all(...params) as Record<string, unknown>[];

  const data: kopaiQueryNs.KopaiAggregateRow[] = rawRows.map((row) => {
    const out: kopaiQueryNs.KopaiAggregateRow = {};
    if (isTimeSeries) {
      const ns = row.bucket_start_ns;
      const ms =
        typeof ns === "bigint" ? Number(ns / 1_000_000n) : Number(ns) / 1e6;
      out.bucket_start = new Date(ms).toISOString();
    }
    for (const dim of dimAliases) {
      out[dim.key] = normalizeCellValue(row[dim.alias]);
    }
    for (const alias of measureAliases) {
      out[alias] = normalizeCellValue(row[alias]);
    }
    return out;
  });

  return { data };
}

function normalizeCellValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v);
}

// ============================================================
// Public entry point
// ============================================================

export function executeKopaiQuery(
  conn: DatabaseSync,
  q: KopaiQuery
): RawResult | AggregateResult {
  kopaiQueryCompiler.validateKopaiQuery(q);
  if (q.mode === "raw") return runRaw(conn, q);
  return runAggregate(conn, q);
}
