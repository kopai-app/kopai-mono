/**
 * Translate a KopaiQuery AST into a SQLite-compatible Kysely CompiledQuery.
 *
 * Pure: produces SQL + parameters only — no DB access. The datasource layer
 * runs the compiled query against `DatabaseSync` and handles row decoding /
 * cursor encoding.
 *
 * Cursor format (opaque to the SDK; format owned here): `"<ts>:<tiebreaker>"`.
 * Tiebreaker is `SpanId` for traces and `rowid` for logs / metrics. Matches
 * the format used by the existing `getTraces` / `getLogs` / `getMetrics`
 * methods so old and new endpoints can share clients.
 */
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  sql as kyselySql,
  type CompiledQuery,
  type RawBuilder,
  type SelectQueryBuilder,
} from "kysely";
import type {
  TracesKopaiQuery,
  LogsKopaiQuery,
  MetricsKopaiQuery,
  ExprNode,
  ColumnRefNode,
  AggCallNode,
  MetricsType,
  TracesColumnName,
  LogsColumnName,
} from "@kopai/core";
import {
  SqliteDatasourceBadRequestError,
  SqliteDatasourceNotImplementedError,
} from "./sqlite-datasource-error.js";
import { escapeJsonPath } from "./json-path.js";
import type { DB } from "./db-types.js";

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

const DEFAULT_LIMIT = 100;

/** Hidden SELECT aliases used to read cursor components after fetch. */
export const CURSOR_TS_ALIAS = "__kopai_cursor_ts";
export const CURSOR_TB_ALIAS = "__kopai_cursor_tb";

/**
 * How the datasource should coerce each row alias before returning:
 * - `json`        — JSON.parse the string value (top-level attribute-map cols).
 * - `nanoString`  — coerce bigint → string (nanosecond timestamps/durations).
 * - `none`        — bigint → number, otherwise pass through (aggregates, ints).
 */
export type DecoderKind = "none" | "json" | "nanoString";

export interface TranslateResult {
  readonly compiled: CompiledQuery;
  readonly isAgg: boolean;
  readonly effectiveLimit: number;
  readonly decoders: Readonly<Record<string, DecoderKind>>;
}

const jsonDecodableTracesColumns = new Set<string>([
  "SpanAttributes",
  "ResourceAttributes",
  "Events.Attributes",
  "Events.Name",
  "Events.Timestamp",
  "Links.Attributes",
  "Links.SpanId",
  "Links.TraceId",
  "Links.TraceState",
]);
const jsonDecodableLogsColumns = new Set<string>([
  "LogAttributes",
  "ResourceAttributes",
  "ScopeAttributes",
]);
const jsonDecodableMetricsColumns = new Set<string>([
  "Attributes",
  "ResourceAttributes",
  "ScopeAttributes",
  "Exemplars.FilteredAttributes",
  "Exemplars.SpanId",
  "Exemplars.TimeUnix",
  "Exemplars.TraceId",
  "Exemplars.Value",
  "BucketCounts",
  "ExplicitBounds",
  "PositiveBucketCounts",
  "NegativeBucketCounts",
  "ValueAtQuantiles.Quantile",
  "ValueAtQuantiles.Value",
]);

function isJsonDecodableDbColumn(
  signal: "traces" | "logs" | "metrics",
  dbName: string
): boolean {
  if (signal === "traces") return jsonDecodableTracesColumns.has(dbName);
  if (signal === "logs") return jsonDecodableLogsColumns.has(dbName);
  return jsonDecodableMetricsColumns.has(dbName);
}

/** DB columns whose bigint values should be stringified (nanosecond fields). */
const nanoStringDbColumns = new Set<string>([
  "Timestamp",
  "Duration",
  "TimeUnix",
  "StartTimeUnix",
]);

// ---------------------------------------------------------------------------
// Column maps (camelCase → DB PascalCase)
// ---------------------------------------------------------------------------

const tracesColumnMap: Record<TracesColumnName, string> = {
  spanId: "SpanId",
  timestamp: "Timestamp",
  traceId: "TraceId",
  duration: "Duration",
  eventsAttributes: "Events.Attributes",
  eventsName: "Events.Name",
  eventsTimestamp: "Events.Timestamp",
  linksAttributes: "Links.Attributes",
  linksSpanId: "Links.SpanId",
  linksTraceId: "Links.TraceId",
  linksTraceState: "Links.TraceState",
  parentSpanId: "ParentSpanId",
  resourceAttributes: "ResourceAttributes",
  scopeName: "ScopeName",
  scopeVersion: "ScopeVersion",
  serviceName: "ServiceName",
  spanAttributes: "SpanAttributes",
  spanKind: "SpanKind",
  spanName: "SpanName",
  statusCode: "StatusCode",
  statusMessage: "StatusMessage",
  traceState: "TraceState",
};

const logsColumnMap: Record<LogsColumnName, string> = {
  timestamp: "Timestamp",
  body: "Body",
  eventName: "EventName",
  logAttributes: "LogAttributes",
  resourceAttributes: "ResourceAttributes",
  resourceSchemaUrl: "ResourceSchemaUrl",
  scopeAttributes: "ScopeAttributes",
  scopeName: "ScopeName",
  scopeSchemaUrl: "ScopeSchemaUrl",
  scopeVersion: "ScopeVersion",
  serviceName: "ServiceName",
  severityNumber: "SeverityNumber",
  severityText: "SeverityText",
  spanId: "SpanId",
  traceFlags: "TraceFlags",
  traceId: "TraceId",
};

const metricsBaseColumnMap = {
  timeUnix: "TimeUnix",
  startTimeUnix: "StartTimeUnix",
  attributes: "Attributes",
  metricName: "MetricName",
  metricDescription: "MetricDescription",
  metricUnit: "MetricUnit",
  resourceAttributes: "ResourceAttributes",
  resourceSchemaUrl: "ResourceSchemaUrl",
  scopeAttributes: "ScopeAttributes",
  scopeDroppedAttrCount: "ScopeDroppedAttrCount",
  scopeName: "ScopeName",
  scopeSchemaUrl: "ScopeSchemaUrl",
  scopeVersion: "ScopeVersion",
  serviceName: "ServiceName",
  exemplarsFilteredAttributes: "Exemplars.FilteredAttributes",
  exemplarsSpanId: "Exemplars.SpanId",
  exemplarsTimeUnix: "Exemplars.TimeUnix",
  exemplarsTraceId: "Exemplars.TraceId",
  exemplarsValue: "Exemplars.Value",
  // `metricType` is the discriminator on the query, not a stored column —
  // mapping it to a synthetic literal keeps select shapes uniform.
  metricType: "__metricType__",
} as const;

const gaugeColumnMap: Record<string, string> = {
  ...metricsBaseColumnMap,
  value: "Value",
  flags: "Flags",
};

const sumColumnMap: Record<string, string> = {
  ...metricsBaseColumnMap,
  value: "Value",
  flags: "Flags",
  aggregationTemporality: "AggregationTemporality",
  isMonotonic: "IsMonotonic",
};

const histogramColumnMap: Record<string, string> = {
  ...metricsBaseColumnMap,
  count: "Count",
  sum: "Sum",
  min: "Min",
  max: "Max",
  bucketCounts: "BucketCounts",
  explicitBounds: "ExplicitBounds",
  aggregationTemporality: "AggregationTemporality",
};

const exponentialHistogramColumnMap: Record<string, string> = {
  ...metricsBaseColumnMap,
  count: "Count",
  sum: "Sum",
  min: "Min",
  max: "Max",
  scale: "Scale",
  zeroCount: "ZeroCount",
  positiveBucketCounts: "PositiveBucketCounts",
  positiveOffset: "PositiveOffset",
  negativeBucketCounts: "NegativeBucketCounts",
  negativeOffset: "NegativeOffset",
  zeroThreshold: "ZeroThreshold",
  aggregationTemporality: "AggregationTemporality",
};

const summaryColumnMap: Record<string, string> = {
  ...metricsBaseColumnMap,
  count: "Count",
  sum: "Sum",
  valueAtQuantilesQuantile: "ValueAtQuantiles.Quantile",
  valueAtQuantilesValue: "ValueAtQuantiles.Value",
};

const metricsColumnMaps: Record<MetricsType, Record<string, string>> = {
  gauge: gaugeColumnMap,
  sum: sumColumnMap,
  histogram: histogramColumnMap,
  exponentialHistogram: exponentialHistogramColumnMap,
  summary: summaryColumnMap,
};

const metricsTableMap: Record<MetricsType, keyof DB> = {
  gauge: "otel_metrics_gauge",
  sum: "otel_metrics_sum",
  histogram: "otel_metrics_histogram",
  exponentialHistogram: "otel_metrics_exponential_histogram",
  summary: "otel_metrics_summary",
};

const attributeMapColumnByMap: Record<string, string> = {
  spanAttributes: "SpanAttributes",
  resourceAttributes: "ResourceAttributes",
  logAttributes: "LogAttributes",
  scopeAttributes: "ScopeAttributes",
  eventAttributes: "Events.Attributes",
  attributes: "Attributes",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SignalContext {
  signal: "traces" | "logs" | "metrics";
  columnMap: Record<string, string>;
}

function colNameToDb(name: string, ctx: SignalContext): string {
  const dbName = ctx.columnMap[name];
  if (dbName === undefined) {
    throw new SqliteDatasourceNotImplementedError(
      `Column '${name}' is not available for signal '${ctx.signal}' in this datasource.`
    );
  }
  if (dbName === "__metricType__") {
    throw new SqliteDatasourceNotImplementedError(
      `Column 'metricType' is a query discriminator; selecting it is not supported.`
    );
  }
  return dbName;
}

function colRefExpr(
  col: ColumnRefNode,
  ctx: SignalContext
): RawBuilder<unknown> {
  if (col.kind === "col") {
    const dbName = colNameToDb(col.name, ctx);
    return kyselySql`${kyselySql.id(dbName)}`;
  }
  const mapColName = attributeMapColumnByMap[col.map];
  if (!mapColName) {
    throw new SqliteDatasourceNotImplementedError(
      `Unknown attribute map: '${col.map}'.`
    );
  }
  const path = escapeJsonPath(col.key);
  return kyselySql`json_extract(${kyselySql.id(mapColName)}, ${path})`;
}

function buildAggExpr(
  agg: AggCallNode,
  ctx: SignalContext
): RawBuilder<unknown> {
  switch (agg.fn) {
    case "count":
      return kyselySql`count(*)`;
    case "countDistinct": {
      if (!agg.col) {
        throw new SqliteDatasourceNotImplementedError(
          `countDistinct requires a column argument.`
        );
      }
      return kyselySql`count(distinct ${colRefExpr(agg.col, ctx)})`;
    }
    case "sum":
    case "avg":
    case "min":
    case "max": {
      if (!agg.col) {
        throw new SqliteDatasourceNotImplementedError(
          `${agg.fn} requires a column argument.`
        );
      }
      const colExpr = colRefExpr(agg.col, ctx);
      // Build via raw literal so the function name isn't user-controlled.
      if (agg.fn === "sum") return kyselySql`sum(${colExpr})`;
      if (agg.fn === "avg") return kyselySql`avg(${colExpr})`;
      if (agg.fn === "min") return kyselySql`min(${colExpr})`;
      return kyselySql`max(${colExpr})`;
    }
    default:
      throw new SqliteDatasourceNotImplementedError(
        `Aggregation function '${agg.fn}' is not implemented by this datasource. Supported: count, countDistinct, sum, avg, min, max.`
      );
  }
}

function buildExpr(expr: ExprNode, ctx: SignalContext): RawBuilder<boolean> {
  switch (expr.kind) {
    case "eq":
      return kyselySql`${colRefExpr(expr.col, ctx)} = ${expr.value}`;
    case "ne":
      return kyselySql`${colRefExpr(expr.col, ctx)} != ${expr.value}`;
    case "gt":
      return kyselySql`${colRefExpr(expr.col, ctx)} > ${expr.value}`;
    case "gte":
      return kyselySql`${colRefExpr(expr.col, ctx)} >= ${expr.value}`;
    case "lt":
      return kyselySql`${colRefExpr(expr.col, ctx)} < ${expr.value}`;
    case "lte":
      return kyselySql`${colRefExpr(expr.col, ctx)} <= ${expr.value}`;
    case "like":
      return kyselySql`${colRefExpr(expr.col, ctx)} like ${expr.value}`;
    case "isNull":
      return kyselySql`${colRefExpr(expr.col, ctx)} is null`;
    case "isNotNull":
      return kyselySql`${colRefExpr(expr.col, ctx)} is not null`;
    case "in": {
      const placeholders = expr.values.map((v) => kyselySql`${v}`);
      return kyselySql`${colRefExpr(expr.col, ctx)} in (${kyselySql.join(placeholders, kyselySql`, `)})`;
    }
    case "notIn": {
      const placeholders = expr.values.map((v) => kyselySql`${v}`);
      return kyselySql`${colRefExpr(expr.col, ctx)} not in (${kyselySql.join(placeholders, kyselySql`, `)})`;
    }
    case "and": {
      if (expr.exprs.length === 0) return kyselySql`1 = 1`;
      const subs = expr.exprs.map((e) => buildExpr(e, ctx));
      return kyselySql`(${kyselySql.join(subs, kyselySql` and `)})`;
    }
    case "or": {
      if (expr.exprs.length === 0) return kyselySql`1 = 1`;
      const subs = expr.exprs.map((e) => buildExpr(e, ctx));
      return kyselySql`(${kyselySql.join(subs, kyselySql` or `)})`;
    }
    case "not":
      return kyselySql`(not ${buildExpr(expr.expr, ctx)})`;
  }
}

// ---------------------------------------------------------------------------
// Per-signal translators
// ---------------------------------------------------------------------------

interface BuildOpts {
  table: keyof DB;
  timeColumn: "Timestamp" | "TimeUnix";
  tiebreaker: { kind: "col"; name: string } | { kind: "rowid" };
}

function buildQuery(
  query:
    | TracesKopaiQuery
    | LogsKopaiQuery
    | (MetricsKopaiQuery & { signal: "metrics" }),
  ctx: SignalContext,
  opts: BuildOpts
): TranslateResult {
  let qb: SelectQueryBuilder<
    DB,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    Record<string, unknown>
  > = queryBuilder.selectFrom(opts.table) as unknown as SelectQueryBuilder<
    DB,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    Record<string, unknown>
  >;

  // SELECT — single pass that also detects whether any node is an aggregation.
  let isAgg = false;
  const decoders: Record<string, DecoderKind> = {};
  const selectExprs: RawBuilder<unknown>[] = [];
  for (const [alias, node] of Object.entries(query.select)) {
    let expr: RawBuilder<unknown>;
    if (node.kind === "col") {
      const dbName = ctx.columnMap[node.name];
      if (dbName !== undefined && isJsonDecodableDbColumn(ctx.signal, dbName)) {
        decoders[alias] = "json";
      } else if (dbName !== undefined && nanoStringDbColumns.has(dbName)) {
        decoders[alias] = "nanoString";
      } else {
        decoders[alias] = "none";
      }
      expr = colRefExpr(node, ctx);
    } else if (node.kind === "attr") {
      // json_extract returns the underlying scalar — no decoding needed
      decoders[alias] = "none";
      expr = colRefExpr(node, ctx);
    } else {
      isAgg = true;
      decoders[alias] = "none";
      expr = buildAggExpr(node, ctx);
    }
    selectExprs.push(expr.as(alias) as unknown as RawBuilder<unknown>);
  }

  // Hidden cursor-source columns for non-agg queries. Always present so the
  // datasource can build the cursor regardless of what the user selected.
  if (!isAgg) {
    selectExprs.push(
      kyselySql`${kyselySql.id(opts.timeColumn)}`.as(
        CURSOR_TS_ALIAS
      ) as unknown as RawBuilder<unknown>
    );
    const tbExpr =
      opts.tiebreaker.kind === "rowid"
        ? kyselySql`rowid`
        : kyselySql`${kyselySql.id(opts.tiebreaker.name)}`;
    selectExprs.push(
      tbExpr.as(CURSOR_TB_ALIAS) as unknown as RawBuilder<unknown>
    );
  }
  qb = qb.select(selectExprs as never);

  // WHERE
  const conditions: RawBuilder<boolean>[] = [];
  if (query.where) conditions.push(buildExpr(query.where, ctx));

  if (query.timeRange) {
    const startNs = BigInt(query.timeRange.start);
    const endNs = BigInt(query.timeRange.end);
    conditions.push(kyselySql`${kyselySql.id(opts.timeColumn)} >= ${startNs}`);
    conditions.push(kyselySql`${kyselySql.id(opts.timeColumn)} <= ${endNs}`);
  }

  // CURSOR (non-agg only — schema enforces, defense in depth)
  if (query.cursor !== undefined) {
    if (isAgg) {
      throw new SqliteDatasourceNotImplementedError(
        `cursor is not supported on aggregated queries.`
      );
    }
    const direction = inferDirection(query.orderBy);
    conditions.push(buildCursorPredicate(query.cursor, opts, direction));
  }

  for (const c of conditions) qb = qb.where(c as never);

  // GROUP BY
  if (query.groupBy) {
    for (const col of query.groupBy) {
      qb = qb.groupBy(colRefExpr(col, ctx) as never);
    }
  }

  // ORDER BY (with default tiebreaker for non-agg)
  const direction = inferDirection(query.orderBy);
  if (!isAgg) {
    qb = qb.orderBy(
      kyselySql`${kyselySql.id(opts.timeColumn)} ${kyselySql.raw(direction)}` as never
    );
    qb = qb.orderBy(
      opts.tiebreaker.kind === "rowid"
        ? (kyselySql`rowid ${kyselySql.raw(direction)}` as never)
        : (kyselySql`${kyselySql.id(opts.tiebreaker.name)} ${kyselySql.raw(direction)}` as never)
    );
  } else if (query.orderBy) {
    for (const ob of query.orderBy) {
      qb = qb.orderBy(
        kyselySql`${colRefExpr(ob.col, ctx)} ${kyselySql.raw(ob.dir)}` as never
      );
    }
  }

  // LIMIT (request limit+1 for hasMore detection when non-agg)
  const effectiveLimit = query.limit ?? DEFAULT_LIMIT;
  const fetchLimit = isAgg ? effectiveLimit : effectiveLimit + 1;
  qb = qb.limit(fetchLimit);

  return { compiled: qb.compile(), isAgg, effectiveLimit, decoders };
}

function inferDirection(
  orderBy: { dir: "asc" | "desc" }[] | undefined
): "asc" | "desc" {
  if (orderBy && orderBy.length > 0 && orderBy[0]) return orderBy[0].dir;
  return "desc";
}

function buildCursorPredicate(
  cursor: string,
  opts: BuildOpts,
  direction: "asc" | "desc"
): RawBuilder<boolean> {
  const colonIdx = cursor.indexOf(":");
  if (colonIdx < 0) {
    throw new SqliteDatasourceBadRequestError(
      `Cursor '${cursor}' is not in '<timestamp>:<tiebreaker>' format.`
    );
  }
  const tsPart = cursor.slice(0, colonIdx);
  const tbPart = cursor.slice(colonIdx + 1);
  let cursorTs: bigint;
  try {
    cursorTs = BigInt(tsPart);
  } catch {
    throw new SqliteDatasourceBadRequestError(
      `Cursor timestamp '${tsPart}' is not a valid integer.`
    );
  }
  const op = direction === "desc" ? "<" : ">";
  const opSql = kyselySql.raw(op);
  const tbExpr =
    opts.tiebreaker.kind === "rowid"
      ? kyselySql`rowid`
      : kyselySql`${kyselySql.id(opts.tiebreaker.name)}`;
  let tbValue: string | number;
  if (opts.tiebreaker.kind === "rowid") {
    if (tbPart === "" || !/^-?\d+$/.test(tbPart)) {
      throw new SqliteDatasourceBadRequestError(
        `Cursor rowid '${tbPart}' is not a valid integer.`
      );
    }
    tbValue = Number(tbPart);
  } else {
    tbValue = tbPart;
  }
  return kyselySql`(${kyselySql.id(opts.timeColumn)} ${opSql} ${cursorTs} or (${kyselySql.id(opts.timeColumn)} = ${cursorTs} and ${tbExpr} ${opSql} ${tbValue}))`;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function translateTracesQuery(query: TracesKopaiQuery): TranslateResult {
  return buildQuery(
    query,
    { signal: "traces", columnMap: tracesColumnMap },
    {
      table: "otel_traces",
      timeColumn: "Timestamp",
      tiebreaker: { kind: "col", name: "SpanId" },
    }
  );
}

export function translateLogsQuery(query: LogsKopaiQuery): TranslateResult {
  return buildQuery(
    query,
    { signal: "logs", columnMap: logsColumnMap },
    {
      table: "otel_logs",
      timeColumn: "Timestamp",
      tiebreaker: { kind: "rowid" },
    }
  );
}

export function translateMetricsQuery(
  query: MetricsKopaiQuery
): TranslateResult {
  const table = metricsTableMap[query.metricType];
  const columnMap = metricsColumnMaps[query.metricType];
  return buildQuery(
    query,
    { signal: "metrics", columnMap },
    {
      table,
      timeColumn: "TimeUnix",
      tiebreaker: { kind: "rowid" },
    }
  );
}
