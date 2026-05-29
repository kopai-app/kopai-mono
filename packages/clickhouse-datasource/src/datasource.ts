import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ResultSet } from "@clickhouse/client";
import {
  kopaiQueryCompiler,
  type dataFilterSchemas,
  type denormalizedSignals,
  type datasource,
  type kopaiQuery,
} from "@kopai/core";
import type z from "zod";
import {
  assertClickHouseRequestContext,
  type Logger,
  type ClickHouseRequestContext,
} from "./types.js";
import {
  buildTracesQuery,
  buildServicesQuery,
  buildOperationsQuery,
  buildTraceSummariesQuery,
} from "./query-traces.js";
import { buildLogsQuery } from "./query-logs.js";
import {
  buildMetricsQuery,
  buildAggregatedMetricsQuery,
  buildDiscoverMetricsFromMV,
} from "./query-metrics.js";
import {
  parseChRow,
  chTracesRowSchema,
  chLogsRowSchema,
  chDiscoverNameRowSchema,
  chDiscoverAttrRowSchema,
  metricSchemaMap,
} from "./ch-row-schemas.js";
import { buildKopaiSql } from "./query-kopai.js";
import { dateTime64ToNanos } from "./timestamp.js";
import { getDiscoverMVSchema } from "./discover-mv-schema.js";

// Coerces a ClickHouse JSON cell into the KopaiAggregateRow value union.
// Mirrors the sqlite backend's normalizeCellValue: a bigint outside the
// 53-bit safe-integer range is preserved as a string rather than silently
// rounded by Number(). (ClickHouse usually serializes UInt64 as a string, so
// the bigint branch is rare — this keeps the two backends consistent.)
export function coerceAggregateCellValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") {
    return v > BigInt(Number.MAX_SAFE_INTEGER) ||
      v < BigInt(Number.MIN_SAFE_INTEGER)
      ? v.toString()
      : Number(v);
  }
  return String(v);
}

// Coerces a measure column (count/sum/min/max/avg/percentiles/...). ClickHouse
// serializes integer aggregates (UInt64/Int64 from count/sum/min/max) as JSON
// strings while Float64 aggregates (avg/percentiles) arrive as numbers. The
// SQLite backend returns numbers for all of these, so we coerce strings to
// numbers here to keep the two backends consistent. The bigint>safe-integer
// guard from coerceAggregateCellValue is preserved: a stringified integer that
// overflows the 53-bit safe range stays a string rather than being silently
// rounded by Number() (matching sqlite's normalizeCellValue).
export function coerceMeasureCellValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") {
    return v > BigInt(Number.MAX_SAFE_INTEGER) ||
      v < BigInt(Number.MIN_SAFE_INTEGER)
      ? v.toString()
      : Number(v);
  }
  if (typeof v === "string") {
    // Preserve full-precision integers beyond the 53-bit safe range as strings
    // (e.g. huge UInt64 counts), matching the bigint guard above.
    if (/^-?\d+$/.test(v)) {
      const asBig = BigInt(v);
      if (
        asBig > BigInt(Number.MAX_SAFE_INTEGER) ||
        asBig < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        return v;
      }
      return Number(asBig);
    }
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  return String(v);
}

const MAX_ATTR_VALUES = 100;

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

function getLogger(ctx: ClickHouseRequestContext): Logger {
  return ctx.logger ?? noopLogger;
}

const CH_NODE_HEADER = "x-clickhouse-server-display-name";

/** Extract short ClickHouse node identifier from response headers. */
function getChNode(rs: ResultSet<"JSONEachRow">): string | undefined {
  const raw = rs.response_headers[CH_NODE_HEADER];
  if (typeof raw !== "string") return undefined;
  // Header value is a full FQDN like "chi-clickhouse-prod-prod-cluster-0-0-0.ns.svc.cluster.local"
  // Extract just the pod name (first segment before the dot).
  return raw.split(".")[0];
}

/** ClickHouse error code for TABLE_DOES_NOT_EXIST */
const CH_ERR_TABLE_NOT_FOUND = "60";

function isChError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === code
  );
}

/** Type predicate: narrows unknown to a string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collect all rows from a ResultSet stream, parsing each with the given schema. */
async function streamParse<S extends z.ZodType>(
  resultSet: ResultSet<"JSONEachRow">,
  schema: S
): Promise<z.output<S>[]> {
  const rows: z.output<S>[] = [];
  for await (const batch of resultSet.stream()) {
    for (const row of batch) {
      rows.push(parseChRow(schema, row.json()));
    }
  }
  return rows;
}

export class ClickHouseReadDatasource
  implements datasource.ReadTelemetryDatasource
{
  private readonly client: ClickHouseClient;

  constructor(
    baseUrl: string,
    options?: {
      maxOpenConnections?: number;
      requestTimeout?: number;
    }
  ) {
    this.client = createClient({
      url: baseUrl,
      application: "kopai",
      max_open_connections: options?.maxOpenConnections ?? 10,
      request_timeout: options?.requestTimeout ?? 30_000,
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async clientQuery(
    ctx: ClickHouseRequestContext,
    query: string,
    params: Record<string, unknown> = {}
  ): Promise<ResultSet<"JSONEachRow">> {
    const { username, password, database, clickhouseSettings } = ctx;
    return this.client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      auth: { username, password },
      http_headers: { "X-ClickHouse-Database": database },
      ...(clickhouseSettings && { clickhouse_settings: clickhouseSettings }),
    });
  }

  /**
   * Run a statement that returns no result set (DDL / INSERT … SELECT).
   * Used by discoverMetrics to provision + backfill the discover MVs.
   */
  private async clientCommand(
    ctx: ClickHouseRequestContext,
    query: string,
    params: Record<string, unknown> = {}
  ): Promise<void> {
    const { username, password, database, clickhouseSettings } = ctx;
    await this.client.command({
      query,
      query_params: params,
      auth: { username, password },
      http_headers: { "X-ClickHouse-Database": database },
      ...(clickhouseSettings && { clickhouse_settings: clickhouseSettings }),
    });
  }

  /**
   * Idempotently provision the metrics-discovery materialized views and seed
   * them with already-ingested base-table data.
   *
   * The OTel Collector contrib ClickHouse exporter creates the base metric
   * tables but not these discovery MVs. A ClickHouse MV only captures rows
   * inserted after its creation, so we (1) CREATE … IF NOT EXISTS the target
   * tables + MVs and (2) backfill the existing base-table rows into the target
   * tables. Re-running is safe: the target tables are ReplacingMergeTree /
   * AggregatingMergeTree, and the discover read queries already use FINAL /
   * groupUniqArrayMerge to collapse duplicates/partials.
   */
  private async provisionDiscoverMVs(
    ctx: ClickHouseRequestContext
  ): Promise<void> {
    const { targetTables, materializedViews, backfill } = getDiscoverMVSchema(
      ctx.database
    );
    // Target tables first, then MVs (which TO those tables), then backfill so
    // the MVs already exist to capture any concurrent inserts.
    for (const stmt of targetTables) {
      await this.clientCommand(ctx, stmt);
    }
    for (const stmt of materializedViews) {
      await this.clientCommand(ctx, stmt);
    }
    for (const stmt of backfill) {
      await this.clientCommand(ctx, stmt);
    }
  }

  async getTraces(
    filter: dataFilterSchemas.TracesDataFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: denormalizedSignals.OtelTracesRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let rows;
    let chNode: string | undefined;
    try {
      const { query, params } = buildTracesQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      rows = await streamParse(resultSet, chTracesRowSchema);
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        { database, username, method: "getTraces", durationMs, chNode, err },
        "query failed"
      );
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    const limit = filter.limit ?? 100;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const lastRow = data[data.length - 1];
    const nextCursor =
      hasMore && lastRow ? `${lastRow.Timestamp}:${lastRow.SpanId}` : null;

    log.info(
      {
        database,
        username,
        method: "getTraces",
        durationMs,
        rowCount: rows.length,
        chNode,
      },
      "query complete"
    );
    return { data, nextCursor };
  }

  async getLogs(
    filter: dataFilterSchemas.LogsDataFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: denormalizedSignals.OtelLogsRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let rows: { parsed: z.output<typeof chLogsRowSchema>; _rowHash: string }[];
    let chNode: string | undefined;
    try {
      const { query, params } = buildLogsQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      rows = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json() as Record<string, unknown>;
          rows.push({
            parsed: parseChRow(chLogsRowSchema, json),
            _rowHash: String(json._rowHash),
          });
        }
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        { database, username, method: "getLogs", durationMs, chNode, err },
        "query failed"
      );
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    const limit = filter.limit ?? 100;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const data = items.map((r) => r.parsed);

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? `${lastItem.parsed.Timestamp}:${lastItem._rowHash}`
        : null;

    log.info(
      {
        database,
        username,
        method: "getLogs",
        durationMs,
        rowCount: rows.length,
        chNode,
      },
      "query complete"
    );
    return { data, nextCursor };
  }

  async getMetrics(
    filter: dataFilterSchemas.MetricsDataFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: denormalizedSignals.OtelMetricsRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    const metricType = filter.metricType;
    const schema = metricSchemaMap[metricType];

    let rows: { parsed: z.output<typeof schema>; _rowHash: string }[];
    let chNode: string | undefined;
    try {
      const { query, params } = buildMetricsQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      rows = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json() as Record<string, unknown>;
          rows.push({
            parsed: parseChRow(schema, json),
            _rowHash: String(json._rowHash),
          });
        }
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        { database, username, method: "getMetrics", durationMs, chNode, err },
        "query failed"
      );
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    const limit = filter.limit ?? 100;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const data = items.map((r) => r.parsed);

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? `${lastItem.parsed.TimeUnix}:${lastItem._rowHash}`
        : null;

    log.info(
      {
        database,
        username,
        method: "getMetrics",
        durationMs,
        rowCount: rows.length,
        chNode,
      },
      "query complete"
    );
    return { data, nextCursor };
  }

  async getAggregatedMetrics(
    filter: dataFilterSchemas.MetricsDataFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: denormalizedSignals.AggregatedMetricRow[];
    nextCursor: null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildAggregatedMetricsQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      const groupByKeys = filter.groupBy ?? [];
      const data: denormalizedSignals.AggregatedMetricRow[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json();
          if (!isRecord(json)) continue;
          const groups: Record<string, string> = {};
          for (let i = 0; i < groupByKeys.length; i++) {
            const key = groupByKeys[i];
            if (key !== undefined) {
              groups[key] = String(json[`group_${String(i)}`] ?? "");
            }
          }
          data.push({ groups, value: Number(json.value) });
        }
      }

      const durationMs = Math.round(performance.now() - start);
      log.info(
        {
          database,
          username,
          method: "getAggregatedMetrics",
          durationMs,
          rowCount: data.length,
          chNode,
        },
        "query complete"
      );
      return { data, nextCursor: null };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        {
          database,
          username,
          method: "getAggregatedMetrics",
          durationMs,
          chNode,
          err,
        },
        "query failed"
      );
      throw err;
    }
  }

  async getServices(opts?: {
    requestContext?: unknown;
  }): Promise<{ services: string[] }> {
    const requestContext = opts?.requestContext;
    assertClickHouseRequestContext(requestContext);
    const { database, username } = requestContext;
    const log = getLogger(requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildServicesQuery();

      const resultSet = await this.clientQuery(requestContext, query, params);
      chNode = getChNode(resultSet);

      const services: string[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json() as { ServiceName: string };
          services.push(json.ServiceName);
        }
      }

      const durationMs = Math.round(performance.now() - start);
      log.info(
        {
          database,
          username,
          method: "getServices",
          durationMs,
          rowCount: services.length,
          chNode,
        },
        "query complete"
      );
      return { services };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        {
          database,
          username,
          method: "getServices",
          durationMs,
          chNode,
          err,
        },
        "query failed"
      );
      throw err;
    }
  }

  async getOperations(filter: {
    serviceName: string;
    requestContext?: unknown;
  }): Promise<{ operations: string[] }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildOperationsQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      const operations: string[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json() as { SpanName: string };
          operations.push(json.SpanName);
        }
      }

      const durationMs = Math.round(performance.now() - start);
      log.info(
        {
          database,
          username,
          method: "getOperations",
          durationMs,
          rowCount: operations.length,
          chNode,
        },
        "query complete"
      );
      return { operations };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        {
          database,
          username,
          method: "getOperations",
          durationMs,
          chNode,
          err,
        },
        "query failed"
      );
      throw err;
    }
  }

  async getTraceSummaries(
    filter: dataFilterSchemas.TraceSummariesFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: dataFilterSchemas.TraceSummaryRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildTraceSummariesQuery(filter);

      const resultSet = await this.clientQuery(
        filter.requestContext,
        query,
        params
      );
      chNode = getChNode(resultSet);

      const rawRows: Array<{
        TraceId: string;
        rootServiceName: string;
        rootSpanName: string;
        startTimeNs: string;
        durationNs: string;
        spanCount: number;
        errorCount: number;
        _serviceData: Array<[string, string]>;
      }> = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          rawRows.push(row.json() as (typeof rawRows)[number]);
        }
      }

      const limit = filter.limit ?? 20;
      const hasMore = rawRows.length > limit;
      const items = hasMore ? rawRows.slice(0, limit) : rawRows;

      const data: dataFilterSchemas.TraceSummaryRow[] = items.map((r) => {
        // Aggregate per-service breakdown from _serviceData tuples
        const serviceMap = new Map<
          string,
          { count: number; hasError: boolean }
        >();
        for (const [svcName, statusCode] of r._serviceData) {
          const isError =
            statusCode === kopaiQueryCompiler.STATUS_CODE_ERROR_LITERAL;
          const existing = serviceMap.get(svcName);
          if (existing) {
            existing.count++;
            if (isError) existing.hasError = true;
          } else {
            serviceMap.set(svcName, {
              count: 1,
              hasError: isError,
            });
          }
        }

        return {
          traceId: r.TraceId,
          rootServiceName: r.rootServiceName || "",
          rootSpanName: r.rootSpanName || "",
          startTimeNs: r.startTimeNs,
          durationNs: r.durationNs,
          spanCount: r.spanCount,
          errorCount: r.errorCount,
          services: Array.from(serviceMap.entries()).map(([name, s]) => ({
            name,
            count: s.count,
            hasError: s.hasError,
          })),
        };
      });

      const lastRow = items[items.length - 1];
      const nextCursor =
        hasMore && lastRow ? `${lastRow.startTimeNs}:${lastRow.TraceId}` : null;

      const durationMs = Math.round(performance.now() - start);
      log.info(
        {
          database,
          username,
          method: "getTraceSummaries",
          durationMs,
          rowCount: rawRows.length,
          chNode,
        },
        "query complete"
      );
      return { data, nextCursor };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        {
          database,
          username,
          method: "getTraceSummaries",
          durationMs,
          chNode,
          err,
        },
        "query failed"
      );
      throw err;
    }
  }

  async queryTracesRaw(
    q: kopaiQuery.TraceRawQuery & { requestContext?: unknown }
  ): Promise<{
    data: denormalizedSignals.OtelTracesRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(q.requestContext);
    const ctx = q.requestContext;
    const log = getLogger(ctx);
    const start = performance.now();
    const method = "queryTracesRaw";
    kopaiQueryCompiler.validateKopaiQuery(q);

    let chNode: string | undefined;
    try {
      const { sql, params } = buildKopaiSql(q);
      const resultSet = await this.clientQuery(ctx, sql, params);
      chNode = getChNode(resultSet);

      const limit = q.limit ?? 100;
      const rows: denormalizedSignals.OtelTracesRow[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          rows.push(parseChRow(chTracesRowSchema, row.json()));
        }
      }
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const last = data[data.length - 1];
      const nextCursor =
        hasMore && last ? `${last.Timestamp}:${last.SpanId}` : null;
      this.logQuerySuccess({ ctx, chNode, start, log, method }, rows.length);
      return { data, nextCursor };
    } catch (err) {
      this.logQueryFailure({ ctx, chNode, start, log, method }, err);
      throw err;
    }
  }

  async queryLogsRaw(
    q: kopaiQuery.LogRawQuery & { requestContext?: unknown }
  ): Promise<{
    data: denormalizedSignals.OtelLogsRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(q.requestContext);
    const ctx = q.requestContext;
    const log = getLogger(ctx);
    const start = performance.now();
    const method = "queryLogsRaw";
    kopaiQueryCompiler.validateKopaiQuery(q);

    let chNode: string | undefined;
    try {
      const { sql, params } = buildKopaiSql(q);
      const resultSet = await this.clientQuery(ctx, sql, params);
      chNode = getChNode(resultSet);

      const limit = q.limit ?? 100;
      const rows: {
        parsed: denormalizedSignals.OtelLogsRow;
        _rowHash: string;
      }[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json();
          if (!isRecord(json)) continue;
          rows.push({
            parsed: parseChRow(chLogsRowSchema, json),
            _rowHash: String(json._rowHash),
          });
        }
      }
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const data = items.map((r) => r.parsed);
      const lastItem = items[items.length - 1];
      const nextCursor =
        hasMore && lastItem
          ? `${lastItem.parsed.Timestamp}:${lastItem._rowHash}`
          : null;
      this.logQuerySuccess({ ctx, chNode, start, log, method }, rows.length);
      return { data, nextCursor };
    } catch (err) {
      this.logQueryFailure({ ctx, chNode, start, log, method }, err);
      throw err;
    }
  }

  async queryMetricsRaw(
    q: kopaiQuery.MetricRawQuery & { requestContext?: unknown }
  ): Promise<{
    data: denormalizedSignals.OtelMetricsRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(q.requestContext);
    const ctx = q.requestContext;
    const log = getLogger(ctx);
    const start = performance.now();
    const method = "queryMetricsRaw";
    kopaiQueryCompiler.validateKopaiQuery(q);

    let chNode: string | undefined;
    try {
      const { sql, params } = buildKopaiSql(q);
      const resultSet = await this.clientQuery(ctx, sql, params);
      chNode = getChNode(resultSet);

      const limit = q.limit ?? 100;
      const metricType = kopaiQueryCompiler.extractMetricType(q);
      const schema = metricSchemaMap[metricType];
      const rows: {
        parsed: z.output<typeof schema>;
        _rowHash: string;
      }[] = [];
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json();
          if (!isRecord(json)) continue;
          rows.push({
            parsed: parseChRow(schema, json),
            _rowHash: String(json._rowHash),
          });
        }
      }
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const data = items.map((r) => r.parsed);
      const lastItem = items[items.length - 1];
      const nextCursor =
        hasMore && lastItem
          ? `${lastItem.parsed.TimeUnix}:${lastItem._rowHash}`
          : null;
      this.logQuerySuccess({ ctx, chNode, start, log, method }, rows.length);
      return { data, nextCursor };
    } catch (err) {
      this.logQueryFailure({ ctx, chNode, start, log, method }, err);
      throw err;
    }
  }

  async queryTracesAggregate(
    q: kopaiQuery.TraceAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: kopaiQuery.KopaiAggregateRow[] }> {
    return this.runAggregate(q, "queryTracesAggregate");
  }

  async queryLogsAggregate(
    q: kopaiQuery.LogAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: kopaiQuery.KopaiAggregateRow[] }> {
    return this.runAggregate(q, "queryLogsAggregate");
  }

  async queryMetricsAggregate(
    q: kopaiQuery.MetricAggregateQuery & { requestContext?: unknown }
  ): Promise<{ data: kopaiQuery.KopaiAggregateRow[] }> {
    return this.runAggregate(q, "queryMetricsAggregate");
  }

  /**
   * Shared aggregate execution: all three aggregate variants share an
   * identical pipeline (validate → build SQL → stream → coerce JSON →
   * collect). Per-signal SQL specialization happens entirely inside
   * `buildKopaiSql`.
   */
  private async runAggregate(
    q:
      | (kopaiQuery.TraceAggregateQuery & { requestContext?: unknown })
      | (kopaiQuery.LogAggregateQuery & { requestContext?: unknown })
      | (kopaiQuery.MetricAggregateQuery & { requestContext?: unknown }),
    method: string
  ): Promise<{ data: kopaiQuery.KopaiAggregateRow[] }> {
    assertClickHouseRequestContext(q.requestContext);
    const ctx = q.requestContext;
    const log = getLogger(ctx);
    const start = performance.now();
    kopaiQueryCompiler.validateKopaiQuery(q);

    let chNode: string | undefined;
    try {
      const { sql, params } = buildKopaiSql(q);
      const resultSet = await this.clientQuery(ctx, sql, params);
      chNode = getChNode(resultSet);

      const data: kopaiQuery.KopaiAggregateRow[] = [];
      const isTimeSeries = q.output.type === "timeSeries";
      // Measure-aliased columns hold numeric aggregates. ClickHouse serializes
      // integer aggregates (count/sum/min/max → UInt64/Int64) as JSON strings,
      // so coerce them to numbers to match the SQLite backend. Dimension columns
      // and bucket_start stay strings (a dimension like "service.name" must not
      // be numerically coerced).
      const measureAliases = new Set(q.measures.map((m) => m.as));
      for await (const batch of resultSet.stream()) {
        for (const row of batch) {
          const json = row.json() as Record<string, unknown>;
          const out: Record<string, string | number | null> = {};
          for (const [k, v] of Object.entries(json)) {
            if (k === "bucket_start" && isTimeSeries) {
              // ClickHouse serializes the bucket as a DateTime64 string
              // ("YYYY-MM-DD HH:MM:SS.nnnnnnnnn"). Normalize to canonical
              // ISO-8601 UTC so the same timeSeries query returns identical
              // bucket_start strings on the ClickHouse and SQLite backends.
              const nanos = BigInt(
                dateTime64ToNanos(typeof v === "string" ? v : String(v))
              );
              out[k] = new Date(Number(nanos / 1_000_000n)).toISOString();
            } else if (measureAliases.has(k)) {
              out[k] = coerceMeasureCellValue(v);
            } else {
              out[k] = coerceAggregateCellValue(v);
            }
          }
          data.push(out);
        }
      }
      this.logQuerySuccess({ ctx, chNode, start, log, method }, data.length);
      return { data };
    } catch (err) {
      this.logQueryFailure({ ctx, chNode, start, log, method }, err);
      throw err;
    }
  }

  async query<Q extends kopaiQuery.KopaiQuery>(
    q: Q & { requestContext?: unknown }
  ): Promise<kopaiQuery.KopaiQueryResult<Q>> {
    // Dispatch on (signal, mode) to one of the six narrow methods. Each
    // narrow method returns a concrete shape; the conditional
    // `KopaiQueryResult<Q>` can't be proven through this dispatch tree,
    // so a single cast bridges the concrete union to the conditional
    // return type. Same justification as the sqlite-datasource dispatcher.
    let result:
      | {
          data: denormalizedSignals.OtelTracesRow[];
          nextCursor: string | null;
        }
      | { data: denormalizedSignals.OtelLogsRow[]; nextCursor: string | null }
      | {
          data: denormalizedSignals.OtelMetricsRow[];
          nextCursor: string | null;
        }
      | { data: kopaiQuery.KopaiAggregateRow[] };
    if (q.signal === "traces" && q.mode === "raw") {
      result = await this.queryTracesRaw(q);
    } else if (q.signal === "traces") {
      result = await this.queryTracesAggregate(q);
    } else if (q.signal === "logs" && q.mode === "raw") {
      result = await this.queryLogsRaw(q);
    } else if (q.signal === "logs") {
      result = await this.queryLogsAggregate(q);
    } else if (q.mode === "raw") {
      result = await this.queryMetricsRaw(q);
    } else {
      result = await this.queryMetricsAggregate(q);
    }
    return result as kopaiQuery.KopaiQueryResult<Q>;
  }

  private logQuerySuccess(
    meta: {
      ctx: ClickHouseRequestContext;
      chNode: string | undefined;
      start: number;
      log: Logger;
      method: string;
    },
    rowCount: number
  ): void {
    const durationMs = Math.round(performance.now() - meta.start);
    meta.log.info(
      {
        database: meta.ctx.database,
        username: meta.ctx.username,
        method: meta.method,
        durationMs,
        rowCount,
        chNode: meta.chNode,
      },
      "query complete"
    );
  }

  private logQueryFailure(
    meta: {
      ctx: ClickHouseRequestContext;
      chNode: string | undefined;
      start: number;
      log: Logger;
      method: string;
    },
    err: unknown
  ): void {
    const durationMs = Math.round(performance.now() - meta.start);
    meta.log.error(
      {
        database: meta.ctx.database,
        username: meta.ctx.username,
        method: meta.method,
        durationMs,
        chNode: meta.chNode,
        err,
      },
      "query failed"
    );
  }

  /** Read the discover MV target tables. Throws CH error code 60 if absent. */
  private async readDiscoverMVs(ctx: ClickHouseRequestContext): Promise<{
    nameRows: z.infer<typeof chDiscoverNameRowSchema>[];
    attrRows: z.infer<typeof chDiscoverAttrRowSchema>[];
    chNodes: (string | undefined)[];
  }> {
    const { namesQuery, attributesQuery } = buildDiscoverMetricsFromMV();
    const [namesRs, attrsRs] = await Promise.all([
      this.clientQuery(ctx, namesQuery),
      this.clientQuery(ctx, attributesQuery),
    ]);
    const chNodes = [getChNode(namesRs), getChNode(attrsRs)];
    const [nameRows, attrRows] = await Promise.all([
      streamParse(namesRs, chDiscoverNameRowSchema),
      streamParse(attrsRs, chDiscoverAttrRowSchema),
    ]);
    return { nameRows, attrRows, chNodes };
  }

  async discoverMetrics(options?: {
    requestContext?: unknown;
  }): Promise<datasource.MetricsDiscoveryResult> {
    const ctx = options?.requestContext;
    assertClickHouseRequestContext(ctx);
    const { database, username } = ctx;
    const log = getLogger(ctx);
    const logCtx = { database, username, method: "discoverMetrics" };
    const start = performance.now();

    // Query MV tables directly — no system.tables detection needed.
    // Reader users may lack access to system.tables, causing false negatives.
    let nameRows: z.infer<typeof chDiscoverNameRowSchema>[];
    let attrRows: z.infer<typeof chDiscoverAttrRowSchema>[];
    let chNodes: (string | undefined)[] = [];
    try {
      ({ nameRows, attrRows, chNodes } = await this.readDiscoverMVs(ctx));
    } catch (err) {
      // ClickHouse error code 60 = TABLE_DOES_NOT_EXIST → the discover MVs
      // haven't been provisioned in this database yet. The OTel Collector
      // contrib exporter creates the base metric tables but not these MVs, so
      // provision them on demand (idempotently) + backfill existing rows, then
      // serve the query. Only a missing-table error triggers provisioning;
      // anything else propagates.
      if (!isChError(err, CH_ERR_TABLE_NOT_FOUND)) {
        const durationMs = Math.round(performance.now() - start);
        log.error({ ...logCtx, durationMs, chNodes, err }, "MV query failed");
        throw err;
      }
      log.info(
        { ...logCtx },
        "discover MVs absent — provisioning and backfilling"
      );
      try {
        await this.provisionDiscoverMVs(ctx);
        ({ nameRows, attrRows, chNodes } = await this.readDiscoverMVs(ctx));
      } catch (provisionErr) {
        const durationMs = Math.round(performance.now() - start);
        log.error(
          { ...logCtx, durationMs, chNodes, err: provisionErr },
          "discover MV provisioning failed"
        );
        throw provisionErr;
      }
    }
    const queryMs = Math.round(performance.now() - start);

    // Build lookup map for attributes
    const attrMap = new Map<
      string,
      {
        attributes: Record<string, string[]>;
        resourceAttributes: Record<string, string[]>;
        attrsTruncated: boolean;
        resAttrsTruncated: boolean;
      }
    >();

    for (const row of attrRows) {
      const key = `${row.MetricName}:${row.MetricType}`;
      if (!attrMap.has(key)) {
        attrMap.set(key, {
          attributes: {},
          resourceAttributes: {},
          attrsTruncated: false,
          resAttrsTruncated: false,
        });
      }
      const entry = attrMap.get(key);
      if (!entry) continue;

      const isTruncated = row.attr_values.length > MAX_ATTR_VALUES;
      const values = isTruncated
        ? row.attr_values.slice(0, MAX_ATTR_VALUES)
        : row.attr_values;

      if (row.source === "attr") {
        entry.attributes[row.attr_key] = values;
        if (isTruncated) entry.attrsTruncated = true;
      } else {
        entry.resourceAttributes[row.attr_key] = values;
        if (isTruncated) entry.resAttrsTruncated = true;
      }
    }

    // Assemble result
    const metrics: datasource.DiscoveredMetric[] = nameRows.map((row) => {
      const key = `${row.MetricName}:${row.MetricType}`;
      const attrs = attrMap.get(key);

      return {
        name: row.MetricName,
        type: row.MetricType,
        unit: row.MetricUnit || undefined,
        description: row.MetricDescription || undefined,
        attributes: {
          values: attrs?.attributes ?? {},
          ...(attrs?.attrsTruncated && { _truncated: true }),
        },
        resourceAttributes: {
          values: attrs?.resourceAttributes ?? {},
          ...(attrs?.resAttrsTruncated && { _truncated: true }),
        },
      };
    });

    const durationMs = Math.round(performance.now() - start);
    log.info(
      {
        ...logCtx,
        durationMs,
        queryMs,
        metricCount: metrics.length,
        nameRows: nameRows.length,
        attrRows: attrRows.length,
        chNodes,
      },
      "query complete"
    );
    return { metrics };
  }
}
