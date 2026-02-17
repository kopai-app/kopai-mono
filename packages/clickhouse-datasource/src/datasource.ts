import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type {
  dataFilterSchemas,
  denormalizedSignals,
  datasource,
} from "@kopai/core";
import { assertClickHouseRequestContext } from "./types.js";
import { buildTracesQuery } from "./query-traces.js";
import { buildLogsQuery } from "./query-logs.js";
import {
  buildMetricsQuery,
  buildDiscoverMetricsQueries,
} from "./query-metrics.js";
import { mapTracesRow, mapLogsRow, mapMetricsRow } from "./row-mappers.js";
import { dateTime64ToNanos } from "./timestamp.js";

const MAX_ATTR_VALUES = 100;

/** Cursor row shape for traces: Timestamp + SpanId. */
interface TracesCursorRow {
  Timestamp: string;
  SpanId: string;
}

/** Cursor row shape for logs: Timestamp only. */
interface LogsCursorRow {
  Timestamp: string;
}

/** Cursor row shape for metrics: TimeUnix only. */
interface MetricsCursorRow {
  TimeUnix: string;
}

/** ClickHouse row from the metric names discovery query. */
interface DiscoverNameRow {
  MetricName: string;
  MetricType: datasource.MetricType;
  MetricDescription: string;
  MetricUnit: string;
}

/** ClickHouse row from the metric attributes discovery query. */
interface DiscoverAttrRow {
  MetricName: string;
  MetricType: string;
  source: string;
  attr_key: string;
  attr_values: string[];
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

    const { query, params } = buildTracesQuery(filter);
    const limit = filter.limit ?? 100;

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      auth: { username, password },
      http_headers: { "X-ClickHouse-Database": database },
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const mappedData = data.map(mapTracesRow);

    const lastRow = data[data.length - 1] as TracesCursorRow | undefined;
    const nextCursor =
      hasMore && lastRow
        ? `${dateTime64ToNanos(lastRow.Timestamp)}:${lastRow.SpanId}`
        : null;

    return { data: mappedData, nextCursor };
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

    const { query, params } = buildLogsQuery(filter);
    const limit = filter.limit ?? 100;

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      auth: { username, password },
      http_headers: { "X-ClickHouse-Database": database },
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const mappedData = data.map(mapLogsRow);

    const lastRow = data[data.length - 1] as LogsCursorRow | undefined;
    const nextCursor =
      hasMore && lastRow ? `${dateTime64ToNanos(lastRow.Timestamp)}:0` : null;

    return { data: mappedData, nextCursor };
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

    const { query, params } = buildMetricsQuery(filter);
    const limit = filter.limit ?? 100;
    const metricType = filter.metricType;

    const resultSet = await this.client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
      auth: { username, password },
      http_headers: { "X-ClickHouse-Database": database },
    });
    const rows = await resultSet.json<Record<string, unknown>>();

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const mappedData = data.map((row) => mapMetricsRow(row, metricType));

    const lastRow = data[data.length - 1] as MetricsCursorRow | undefined;
    const nextCursor =
      hasMore && lastRow ? `${dateTime64ToNanos(lastRow.TimeUnix)}:0` : null;

    return { data: mappedData, nextCursor };
  }

  async discoverMetrics(options?: {
    requestContext?: unknown;
  }): Promise<datasource.MetricsDiscoveryResult> {
    const ctx = options?.requestContext;
    assertClickHouseRequestContext(ctx);
    const { database, username, password } = ctx;

    const { namesQuery, attributesQuery } = buildDiscoverMetricsQueries();
    const auth = { username, password };
    const http_headers = { "X-ClickHouse-Database": database };

    const [nameRows, attrRows] = await Promise.all([
      this.client
        .query({ query: namesQuery, format: "JSONEachRow", auth, http_headers })
        .then((r) => r.json<DiscoverNameRow>()),
      this.client
        .query({
          query: attributesQuery,
          format: "JSONEachRow",
          auth,
          http_headers,
        })
        .then((r) => r.json<DiscoverAttrRow>()),
    ]);

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
      // Safe: we just ensured the key exists above
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

    return { metrics };
  }
}
