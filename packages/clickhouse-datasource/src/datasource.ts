import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ResultSet } from "@clickhouse/client";
import type {
  dataFilterSchemas,
  denormalizedSignals,
  datasource,
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

  async getTraces(
    filter: dataFilterSchemas.TracesDataFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: denormalizedSignals.OtelTracesRow[];
    nextCursor: string | null;
  }> {
    assertClickHouseRequestContext(filter.requestContext);
    const { database, username, password } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let rows;
    let chNode: string | undefined;
    try {
      const { query, params } = buildTracesQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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
    const { database, username, password } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let rows: { parsed: z.output<typeof chLogsRowSchema>; _rowHash: string }[];
    let chNode: string | undefined;
    try {
      const { query, params } = buildLogsQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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
    const { database, username, password } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    const metricType = filter.metricType;
    const schema = metricSchemaMap[metricType];

    let rows: { parsed: z.output<typeof schema>; _rowHash: string }[];
    let chNode: string | undefined;
    try {
      const { query, params } = buildMetricsQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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

  async getServices(opts?: {
    requestContext?: unknown;
  }): Promise<{ services: string[] }> {
    assertClickHouseRequestContext(opts?.requestContext);
    const { database, username, password } = opts!.requestContext;
    const log = getLogger(opts.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildServicesQuery();

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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
    const { database, username, password } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildOperationsQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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
    const { database, username, password } = filter.requestContext;
    const log = getLogger(filter.requestContext);
    const start = performance.now();

    let chNode: string | undefined;
    try {
      const { query, params } = buildTraceSummariesQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });
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
          const existing = serviceMap.get(svcName);
          if (existing) {
            existing.count++;
            if (statusCode === "ERROR") existing.hasError = true;
          } else {
            serviceMap.set(svcName, {
              count: 1,
              hasError: statusCode === "ERROR",
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

  async discoverMetrics(options?: {
    requestContext?: unknown;
  }): Promise<datasource.MetricsDiscoveryResult> {
    const ctx = options?.requestContext;
    assertClickHouseRequestContext(ctx);
    const { database, username, password } = ctx;
    const log = getLogger(ctx);
    const logCtx = { database, username, method: "discoverMetrics" };
    const start = performance.now();

    const auth = { username, password };
    const http_headers = { "X-ClickHouse-Database": database };

    // Query MV tables directly — no system.tables detection needed.
    // Reader users may lack access to system.tables, causing false negatives.
    let nameRows: z.infer<typeof chDiscoverNameRowSchema>[];
    let attrRows: z.infer<typeof chDiscoverAttrRowSchema>[];
    let chNodes: (string | undefined)[] = [];
    try {
      const { namesQuery, attributesQuery } = buildDiscoverMetricsFromMV();
      const [namesRs, attrsRs] = await Promise.all([
        this.client.query({
          query: namesQuery,
          format: "JSONEachRow",
          auth,
          http_headers,
        }),
        this.client.query({
          query: attributesQuery,
          format: "JSONEachRow",
          auth,
          http_headers,
        }),
      ]);
      chNodes = [getChNode(namesRs), getChNode(attrsRs)];
      [nameRows, attrRows] = await Promise.all([
        streamParse(namesRs, chDiscoverNameRowSchema),
        streamParse(attrsRs, chDiscoverAttrRowSchema),
      ]);
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      // ClickHouse error code 60 = TABLE_DOES_NOT_EXIST → MV tables not provisioned
      if (isChError(err, CH_ERR_TABLE_NOT_FOUND)) {
        log.warn({ ...logCtx, durationMs, chNodes }, "MV tables not found");
        throw new Error(`MV tables not found in ${database}`, { cause: err });
      }
      log.error({ ...logCtx, durationMs, chNodes, err }, "MV query failed");
      throw err;
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
