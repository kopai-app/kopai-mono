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
import { buildTracesQuery } from "./query-traces.js";
import { buildLogsQuery } from "./query-logs.js";
import {
  buildMetricsQuery,
  buildDiscoverMetricsFromMV,
  buildDetectDiscoverMVQuery,
  DISCOVER_NAMES_TABLE,
  DISCOVER_ATTRS_TABLE,
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
    try {
      const { query, params } = buildTracesQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });

      rows = await streamParse(resultSet, chTracesRowSchema);
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        { database, username, method: "getTraces", durationMs, err },
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
    try {
      const { query, params } = buildLogsQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });

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
        { database, username, method: "getLogs", durationMs, err },
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
    try {
      const { query, params } = buildMetricsQuery(filter);

      const resultSet = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
        auth: { username, password },
        http_headers: { "X-ClickHouse-Database": database },
      });

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
        { database, username, method: "getMetrics", durationMs, err },
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
      },
      "query complete"
    );
    return { data, nextCursor };
  }

  /**
   * Detect whether both MV target tables exist in the given database.
   * Returns true only if both names and attrs tables are present.
   */
  private async hasDiscoverMVs(auth: {
    username: string;
    password: string;
    database: string;
  }): Promise<boolean> {
    const rs = await this.client.query({
      query: buildDetectDiscoverMVQuery(),
      format: "JSONEachRow",
      auth: { username: auth.username, password: auth.password },
      http_headers: { "X-ClickHouse-Database": auth.database },
    });
    const found = new Set<string>();
    for await (const batch of rs.stream()) {
      for (const row of batch) {
        const json = row.json() as { name: string };
        found.add(json.name);
      }
    }
    return found.has(DISCOVER_NAMES_TABLE) && found.has(DISCOVER_ATTRS_TABLE);
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

    let hasMVs: boolean;
    try {
      hasMVs = await this.hasDiscoverMVs({ username, password, database });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error({ ...logCtx, durationMs, err }, "MV detection failed");
      throw err;
    }
    const detectionMs = Math.round(performance.now() - start);

    if (!hasMVs) {
      log.warn({ ...logCtx, detectionMs }, "MV tables not found");
      throw new Error(`MV tables not found in ${database}`);
    }

    const queryStart = performance.now();
    let nameRows: z.infer<typeof chDiscoverNameRowSchema>[];
    let attrRows: z.infer<typeof chDiscoverAttrRowSchema>[];
    try {
      const { namesQuery, attributesQuery } = buildDiscoverMetricsFromMV();
      [nameRows, attrRows] = await Promise.all([
        this.client
          .query({
            query: namesQuery,
            format: "JSONEachRow",
            auth,
            http_headers,
          })
          .then((rs) => streamParse(rs, chDiscoverNameRowSchema)),
        this.client
          .query({
            query: attributesQuery,
            format: "JSONEachRow",
            auth,
            http_headers,
          })
          .then((rs) => streamParse(rs, chDiscoverAttrRowSchema)),
      ]);
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const queryMs = Math.round(performance.now() - queryStart);
      log.error(
        { ...logCtx, durationMs, detectionMs, queryMs, err },
        "MV query failed"
      );
      throw err;
    }
    const queryMs = Math.round(performance.now() - queryStart);

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
        detectionMs,
        queryMs,
        metricCount: metrics.length,
        nameRows: nameRows.length,
        attrRows: attrRows.length,
      },
      "query complete"
    );
    return { metrics };
  }
}
