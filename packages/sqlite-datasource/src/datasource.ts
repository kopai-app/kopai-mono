import { DatabaseSync } from "node:sqlite";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  sql as kyselySql,
  type Insertable,
} from "kysely";

import {
  otlp,
  type datasource,
  type otlpMetrics,
  type dataFilterSchemas,
  type denormalizedSignals,
} from "@kopai/core";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";

import type {
  DB,
  OtelMetricsGauge,
  OtelMetricsSum,
  OtelMetricsHistogram,
  OtelMetricsExponentialHistogram,
  OtelMetricsSummary,
  OtelTraces,
  OtelLogs,
} from "./db-types.js";

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

export class NodeSqliteTelemetryDatasource
  implements datasource.TelemetryDatasource
{
  constructor(private sqliteConnection: DatabaseSync) {}

  async writeMetrics(
    metricsData: datasource.MetricsData
  ): Promise<datasource.MetricsPartialSuccess> {
    const gaugeRows: Insertable<OtelMetricsGauge>[] = [];
    const sumRows: Insertable<OtelMetricsSum>[] = [];
    const histogramRows: Insertable<OtelMetricsHistogram>[] = [];
    const expHistogramRows: Insertable<OtelMetricsExponentialHistogram>[] = [];
    const summaryRows: Insertable<OtelMetricsSummary>[] = [];

    for (const resourceMetric of metricsData.resourceMetrics ?? []) {
      const { resource, schemaUrl: resourceSchemaUrl } = resourceMetric;

      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        const { scope, schemaUrl: scopeSchemaUrl } = scopeMetric;

        for (const metric of scopeMetric.metrics ?? []) {
          if (metric.gauge) {
            for (const dataPoint of metric.gauge.dataPoints ?? []) {
              gaugeRows.push(
                toGaugeRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint
                )
              );
            }
          }
          if (metric.sum) {
            for (const dataPoint of metric.sum.dataPoints ?? []) {
              sumRows.push(
                toSumRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.sum.aggregationTemporality,
                  metric.sum.isMonotonic
                )
              );
            }
          }
          if (metric.histogram) {
            for (const dataPoint of metric.histogram.dataPoints ?? []) {
              histogramRows.push(
                toHistogramRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.histogram.aggregationTemporality
                )
              );
            }
          }
          if (metric.exponentialHistogram) {
            for (const dataPoint of metric.exponentialHistogram.dataPoints ??
              []) {
              expHistogramRows.push(
                toExpHistogramRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.exponentialHistogram.aggregationTemporality
                )
              );
            }
          }
          if (metric.summary) {
            for (const dataPoint of metric.summary.dataPoints ?? []) {
              summaryRows.push(
                toSummaryRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint
                )
              );
            }
          }
        }
      }

      for (const { table, rows } of [
        { table: "otel_metrics_gauge", rows: gaugeRows },
        { table: "otel_metrics_sum", rows: sumRows },
        { table: "otel_metrics_histogram", rows: histogramRows },
        { table: "otel_metrics_exponential_histogram", rows: expHistogramRows },
        { table: "otel_metrics_summary", rows: summaryRows },
      ] as const) {
        for (const row of rows) {
          const { sql, parameters } = queryBuilder
            .insertInto(table)
            .values(row)
            .compile();
          this.sqliteConnection
            .prepare(sql)
            .run(...(parameters as (string | number | bigint | null)[]));
        }
      }
    }

    return { rejectedDataPoints: "" };
  }

  async writeTraces(
    tracesData: datasource.TracesData
  ): Promise<datasource.TracesPartialSuccess> {
    const spanRows: Insertable<OtelTraces>[] = [];
    const traceTimestamps = new Map<string, { min: bigint; max: bigint }>();

    for (const resourceSpan of tracesData.resourceSpans ?? []) {
      const { resource } = resourceSpan;

      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        const { scope } = scopeSpan;

        for (const span of scopeSpan.spans ?? []) {
          const row = toSpanRow(resource, scope, span);
          spanRows.push(row);

          // Track min/max timestamps per traceId
          const traceId = span.traceId ?? "";
          if (traceId) {
            const timestamp = row.Timestamp;
            const existing = traceTimestamps.get(traceId);
            if (existing) {
              existing.min =
                timestamp < existing.min ? timestamp : existing.min;
              existing.max =
                timestamp > existing.max ? timestamp : existing.max;
            } else {
              traceTimestamps.set(traceId, { min: timestamp, max: timestamp });
            }
          }
        }
      }
    }

    // Insert span rows
    for (const row of spanRows) {
      const { sql, parameters } = queryBuilder
        .insertInto("otel_traces")
        .values(row)
        .compile();
      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | bigint | null)[]));
    }

    // Upsert trace_id_ts lookup table
    for (const [traceId, { min, max }] of traceTimestamps) {
      const { sql, parameters } = queryBuilder
        .insertInto("otel_traces_trace_id_ts")
        .values({ TraceId: traceId, Start: min, End: max })
        .onConflict((oc) =>
          oc.column("TraceId").doUpdateSet({
            Start: (eb) =>
              eb.fn("min", [
                eb.ref("otel_traces_trace_id_ts.Start"),
                eb.val(min),
              ]),
            End: (eb) =>
              eb.fn("max", [
                eb.ref("otel_traces_trace_id_ts.End"),
                eb.val(max),
              ]),
          })
        )
        .compile();
      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | bigint | null)[]));
    }

    return { rejectedSpans: "" };
  }

  async writeLogs(
    logsData: datasource.LogsData
  ): Promise<datasource.LogsPartialSuccess> {
    const logRows: Insertable<OtelLogs>[] = [];

    for (const resourceLog of logsData.resourceLogs ?? []) {
      const { resource, schemaUrl: resourceSchemaUrl } = resourceLog;

      for (const scopeLog of resourceLog.scopeLogs ?? []) {
        const { scope, schemaUrl: scopeSchemaUrl } = scopeLog;

        for (const logRecord of scopeLog.logRecords ?? []) {
          logRows.push(
            toLogRow(
              resource,
              resourceSchemaUrl,
              scope,
              scopeSchemaUrl,
              logRecord
            )
          );
        }
      }
    }

    for (const row of logRows) {
      const { sql, parameters } = queryBuilder
        .insertInto("otel_logs")
        .values(row)
        .compile();
      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | bigint | null)[]));
    }

    return { rejectedLogRecords: "" };
  }

  async getTraces(filter: dataFilterSchemas.TracesDataFilter): Promise<{
    data: denormalizedSignals.OtelTracesRow[];
    nextCursor: string | null;
  }> {
    try {
      const limit = filter.limit ?? 100;
      const sortOrder = filter.sortOrder ?? "DESC";

      let query = queryBuilder.selectFrom("otel_traces").selectAll();

      // Exact match filters
      if (filter.traceId) query = query.where("TraceId", "=", filter.traceId);
      if (filter.spanId) query = query.where("SpanId", "=", filter.spanId);
      if (filter.parentSpanId)
        query = query.where("ParentSpanId", "=", filter.parentSpanId);
      if (filter.serviceName)
        query = query.where("ServiceName", "=", filter.serviceName);
      if (filter.spanName)
        query = query.where("SpanName", "=", filter.spanName);
      if (filter.spanKind)
        query = query.where("SpanKind", "=", filter.spanKind);
      if (filter.statusCode)
        query = query.where("StatusCode", "=", filter.statusCode);
      if (filter.scopeName)
        query = query.where("ScopeName", "=", filter.scopeName);

      // Time range (nanos)
      if (filter.timestampMin != null)
        query = query.where("Timestamp", ">=", BigInt(filter.timestampMin));
      if (filter.timestampMax != null)
        query = query.where("Timestamp", "<=", BigInt(filter.timestampMax));

      // Duration range (nanos)
      if (filter.durationMin != null)
        query = query.where("Duration", ">=", BigInt(filter.durationMin));
      if (filter.durationMax != null)
        query = query.where("Duration", "<=", BigInt(filter.durationMax));

      // Cursor pagination with SpanId tiebreaker
      if (filter.cursor) {
        const colonIdx = filter.cursor.indexOf(":");
        const cursorTs = BigInt(filter.cursor.slice(0, colonIdx));
        const cursorSpanId = filter.cursor.slice(colonIdx + 1);

        if (sortOrder === "DESC") {
          query = query.where((eb) =>
            eb.or([
              eb("Timestamp", "<", cursorTs),
              eb.and([
                eb("Timestamp", "=", cursorTs),
                eb("SpanId", "<", cursorSpanId),
              ]),
            ])
          );
        } else {
          query = query.where((eb) =>
            eb.or([
              eb("Timestamp", ">", cursorTs),
              eb.and([
                eb("Timestamp", "=", cursorTs),
                eb("SpanId", ">", cursorSpanId),
              ]),
            ])
          );
        }
      }

      // Attribute filters (JSON extract - path must be literal, not parameter)
      if (filter.spanAttributes) {
        for (const [key, value] of Object.entries(filter.spanAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(SpanAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }
      if (filter.resourceAttributes) {
        for (const [key, value] of Object.entries(filter.resourceAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(ResourceAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }

      // Sort and limit (+1 for next cursor detection)
      query = query
        .orderBy("Timestamp", sortOrder === "ASC" ? "asc" : "desc")
        .orderBy("SpanId", sortOrder === "ASC" ? "asc" : "desc")
        .limit(limit + 1);

      // Execute
      const { sql, parameters } = query.compile();
      const stmt = this.sqliteConnection.prepare(sql);
      stmt.setReadBigInts(true);
      const rows = stmt.all(
        ...(parameters as (string | number | bigint | null)[])
      ) as Record<string, unknown>[];

      // Determine nextCursor
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = data[data.length - 1];
      const nextCursor =
        hasMore && lastRow ? `${lastRow.Timestamp}:${lastRow.SpanId}` : null;

      // Map rows to OtelTracesRow (parse JSON fields)
      return { data: data.map(mapRowToOtelTraces), nextCursor };
    } catch (error) {
      throw new SqliteDatasourceQueryError("Failed to query traces", {
        cause: error,
      });
    }
  }

  async getMetrics(filter: dataFilterSchemas.MetricsDataFilter): Promise<{
    data: denormalizedSignals.OtelMetricsRow[];
    nextCursor: string | null;
  }> {
    try {
      const limit = filter.limit ?? 100;
      const sortOrder = filter.sortOrder ?? "DESC";
      const metricType = filter.metricType;

      const tableMap = {
        Gauge: "otel_metrics_gauge",
        Sum: "otel_metrics_sum",
        Histogram: "otel_metrics_histogram",
        ExponentialHistogram: "otel_metrics_exponential_histogram",
        Summary: "otel_metrics_summary",
      } as const;

      const table = tableMap[metricType];

      let query = queryBuilder
        .selectFrom(table)
        .select([
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
          kyselySql<number>`rowid`.as("_rowid"),
        ]);

      // Exemplars columns exist on all metric tables except Summary
      if (metricType !== "Summary") {
        query = query.select([
          kyselySql<string>`"Exemplars.FilteredAttributes"`.as(
            "Exemplars.FilteredAttributes"
          ),
          kyselySql<string>`"Exemplars.SpanId"`.as("Exemplars.SpanId"),
          kyselySql<string>`"Exemplars.TimeUnix"`.as("Exemplars.TimeUnix"),
          kyselySql<string>`"Exemplars.TraceId"`.as("Exemplars.TraceId"),
          kyselySql<string>`"Exemplars.Value"`.as("Exemplars.Value"),
        ]);
      }

      // Add type-specific fields
      if (metricType === "Gauge") {
        query = query.select(["Value", "Flags"]);
      } else if (metricType === "Sum") {
        query = query.select([
          "Value",
          "Flags",
          "AggTemporality",
          "IsMonotonic",
        ]);
      } else if (metricType === "Histogram") {
        query = query.select([
          "Count",
          "Sum",
          "BucketCounts",
          "ExplicitBounds",
          "Min",
          "Max",
          "AggTemporality",
        ]);
      } else if (metricType === "ExponentialHistogram") {
        query = query.select([
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
          "AggTemporality",
        ]);
      } else if (metricType === "Summary") {
        query = query.select(["Count", "Sum"]);
        query = query.select([
          kyselySql<string>`"ValueAtQuantiles.Quantile"`.as(
            "ValueAtQuantiles.Quantile"
          ),
          kyselySql<string>`"ValueAtQuantiles.Value"`.as(
            "ValueAtQuantiles.Value"
          ),
        ]);
      }

      // Exact match filters
      if (filter.metricName)
        query = query.where("MetricName", "=", filter.metricName);
      if (filter.serviceName)
        query = query.where("ServiceName", "=", filter.serviceName);
      if (filter.scopeName)
        query = query.where("ScopeName", "=", filter.scopeName);

      // Time range (nanos)
      if (filter.timeUnixMin != null)
        query = query.where("TimeUnix", ">=", BigInt(filter.timeUnixMin));
      if (filter.timeUnixMax != null)
        query = query.where("TimeUnix", "<=", BigInt(filter.timeUnixMax));

      // Cursor pagination with rowid tiebreaker
      if (filter.cursor) {
        const colonIdx = filter.cursor.indexOf(":");
        const cursorTs = BigInt(filter.cursor.slice(0, colonIdx));
        const cursorRowid = parseInt(filter.cursor.slice(colonIdx + 1), 10);

        if (sortOrder === "DESC") {
          query = query.where((eb) =>
            eb.or([
              eb("TimeUnix", "<", cursorTs),
              eb.and([
                eb("TimeUnix", "=", cursorTs),
                eb(kyselySql`rowid`, "<", cursorRowid),
              ]),
            ])
          );
        } else {
          query = query.where((eb) =>
            eb.or([
              eb("TimeUnix", ">", cursorTs),
              eb.and([
                eb("TimeUnix", "=", cursorTs),
                eb(kyselySql`rowid`, ">", cursorRowid),
              ]),
            ])
          );
        }
      }

      // Attribute filters (JSON extract)
      if (filter.attributes) {
        for (const [key, value] of Object.entries(filter.attributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(Attributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }
      if (filter.resourceAttributes) {
        for (const [key, value] of Object.entries(filter.resourceAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(ResourceAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }
      if (filter.scopeAttributes) {
        for (const [key, value] of Object.entries(filter.scopeAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(ScopeAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }

      // Sort and limit (+1 for next cursor detection)
      query = query
        .orderBy("TimeUnix", sortOrder === "ASC" ? "asc" : "desc")
        .orderBy(kyselySql`rowid`, sortOrder === "ASC" ? "asc" : "desc")
        .limit(limit + 1);

      // Execute
      const { sql, parameters } = query.compile();
      const stmt = this.sqliteConnection.prepare(sql);
      stmt.setReadBigInts(true);
      const rows = stmt.all(
        ...(parameters as (string | number | bigint | null)[])
      ) as Record<string, unknown>[];

      // Determine nextCursor
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = data[data.length - 1];
      const nextCursor =
        hasMore && lastRow ? `${lastRow.TimeUnix}:${lastRow._rowid}` : null;

      // Map rows to OtelMetricsRow (parse JSON fields)
      return {
        data: data.map((row) => mapRowToOtelMetrics(row, metricType)),
        nextCursor,
      };
    } catch (error) {
      if (error instanceof SqliteDatasourceQueryError) throw error;
      throw new SqliteDatasourceQueryError("Failed to query metrics", {
        cause: error,
      });
    }
  }

  async getLogs(filter: dataFilterSchemas.LogsDataFilter): Promise<{
    data: denormalizedSignals.OtelLogsRow[];
    nextCursor: string | null;
  }> {
    try {
      const limit = filter.limit ?? 100;
      const sortOrder = filter.sortOrder ?? "DESC";

      let query = queryBuilder
        .selectFrom("otel_logs")
        .select([
          "Timestamp",
          "TraceId",
          "SpanId",
          "TraceFlags",
          "SeverityText",
          "SeverityNumber",
          "Body",
          "LogAttributes",
          "ResourceAttributes",
          "ResourceSchemaUrl",
          "ServiceName",
          "ScopeName",
          "ScopeVersion",
          "ScopeAttributes",
          "ScopeSchemaUrl",
          kyselySql<number>`rowid`.as("_rowid"),
        ]);

      // Exact match filters
      if (filter.traceId) query = query.where("TraceId", "=", filter.traceId);
      if (filter.spanId) query = query.where("SpanId", "=", filter.spanId);
      if (filter.serviceName)
        query = query.where("ServiceName", "=", filter.serviceName);
      if (filter.scopeName)
        query = query.where("ScopeName", "=", filter.scopeName);
      if (filter.severityText)
        query = query.where("SeverityText", "=", filter.severityText);

      // Severity number range
      if (filter.severityNumberMin != null)
        query = query.where("SeverityNumber", ">=", filter.severityNumberMin);
      if (filter.severityNumberMax != null)
        query = query.where("SeverityNumber", "<=", filter.severityNumberMax);

      // Time range (nanos)
      if (filter.timestampMin != null)
        query = query.where("Timestamp", ">=", BigInt(filter.timestampMin));
      if (filter.timestampMax != null)
        query = query.where("Timestamp", "<=", BigInt(filter.timestampMax));

      // Body contains (substring search using INSTR)
      if (filter.bodyContains) {
        query = query.where(
          kyselySql`INSTR(Body, ${filter.bodyContains})`,
          ">",
          0
        );
      }

      // Cursor pagination with rowid tiebreaker
      if (filter.cursor) {
        const colonIdx = filter.cursor.indexOf(":");
        const cursorTs = BigInt(filter.cursor.slice(0, colonIdx));
        const cursorRowid = parseInt(filter.cursor.slice(colonIdx + 1), 10);

        if (sortOrder === "DESC") {
          query = query.where((eb) =>
            eb.or([
              eb("Timestamp", "<", cursorTs),
              eb.and([
                eb("Timestamp", "=", cursorTs),
                eb(kyselySql`rowid`, "<", cursorRowid),
              ]),
            ])
          );
        } else {
          query = query.where((eb) =>
            eb.or([
              eb("Timestamp", ">", cursorTs),
              eb.and([
                eb("Timestamp", "=", cursorTs),
                eb(kyselySql`rowid`, ">", cursorRowid),
              ]),
            ])
          );
        }
      }

      // Attribute filters (JSON extract)
      if (filter.logAttributes) {
        for (const [key, value] of Object.entries(filter.logAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(LogAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }
      if (filter.resourceAttributes) {
        for (const [key, value] of Object.entries(filter.resourceAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(ResourceAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }
      if (filter.scopeAttributes) {
        for (const [key, value] of Object.entries(filter.scopeAttributes)) {
          const jsonPath = `$."${key.replace(/"/g, '""')}"`;
          query = query.where(
            kyselySql`json_extract(ScopeAttributes, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }

      // Sort and limit (+1 for next cursor detection)
      query = query
        .orderBy("Timestamp", sortOrder === "ASC" ? "asc" : "desc")
        .orderBy(kyselySql`rowid`, sortOrder === "ASC" ? "asc" : "desc")
        .limit(limit + 1);

      // Execute
      const { sql, parameters } = query.compile();
      const stmt = this.sqliteConnection.prepare(sql);
      stmt.setReadBigInts(true);
      const rows = stmt.all(
        ...(parameters as (string | number | bigint | null)[])
      ) as Record<string, unknown>[];

      // Determine nextCursor
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = data[data.length - 1];
      const nextCursor =
        hasMore && lastRow ? `${lastRow.Timestamp}:${lastRow._rowid}` : null;

      // Map rows to OtelLogsRow (parse JSON fields)
      return { data: data.map(mapRowToOtelLogs), nextCursor };
    } catch (error) {
      throw new SqliteDatasourceQueryError("Failed to query logs", {
        cause: error,
      });
    }
  }

  async discoverMetrics(): Promise<datasource.MetricsDiscoveryResult> {
    try {
      // Step 1: Get distinct metrics across all tables using UNION
      const distinctMetricsSql = METRIC_TABLES.map(
        ({ table, type }) =>
          `SELECT DISTINCT MetricName, MetricUnit, MetricDescription, '${type}' as MetricType FROM ${table}`
      ).join(" UNION ");

      const distinctMetrics = this.sqliteConnection
        .prepare(distinctMetricsSql)
        .all() as {
        MetricName: string;
        MetricUnit: string | null;
        MetricDescription: string | null;
        MetricType: datasource.MetricType;
      }[];

      const metrics: datasource.DiscoveredMetric[] = [];

      for (const metric of distinctMetrics) {
        const table = METRIC_TABLES.find(
          (t) => t.type === metric.MetricType
        )!.table;

        // Step 2: Get distinct attribute keys for this metric
        const attrKeysSql = `
          SELECT DISTINCT json_each.key as key
          FROM ${table}, json_each(Attributes)
          WHERE MetricName = ?
        `;
        const attrKeys = this.sqliteConnection
          .prepare(attrKeysSql)
          .all(metric.MetricName) as { key: string }[];

        // Step 3: Get distinct values for each attribute key (limit 101 to detect truncation)
        let attrsTruncated = false;
        const attributes: Record<string, string[]> = {};

        for (const { key } of attrKeys) {
          const valuesSql = `
            SELECT DISTINCT json_each.value as value
            FROM ${table}, json_each(Attributes)
            WHERE MetricName = ? AND json_each.key = ?
            LIMIT ${MAX_ATTR_VALUES + 1}
          `;
          const values = this.sqliteConnection
            .prepare(valuesSql)
            .all(metric.MetricName, key) as { value: string }[];

          if (values.length > MAX_ATTR_VALUES) {
            attrsTruncated = true;
            attributes[key] = values
              .slice(0, MAX_ATTR_VALUES)
              .map((v) => String(v.value));
          } else {
            attributes[key] = values.map((v) => String(v.value));
          }
        }

        // Step 4: Get distinct resource attribute keys for this metric
        const resAttrKeysSql = `
          SELECT DISTINCT json_each.key as key
          FROM ${table}, json_each(ResourceAttributes)
          WHERE MetricName = ?
        `;
        const resAttrKeys = this.sqliteConnection
          .prepare(resAttrKeysSql)
          .all(metric.MetricName) as { key: string }[];

        // Step 5: Get distinct values for each resource attribute key
        let resAttrsTruncated = false;
        const resourceAttributes: Record<string, string[]> = {};

        for (const { key } of resAttrKeys) {
          const valuesSql = `
            SELECT DISTINCT json_each.value as value
            FROM ${table}, json_each(ResourceAttributes)
            WHERE MetricName = ? AND json_each.key = ?
            LIMIT ${MAX_ATTR_VALUES + 1}
          `;
          const values = this.sqliteConnection
            .prepare(valuesSql)
            .all(metric.MetricName, key) as { value: string }[];

          if (values.length > MAX_ATTR_VALUES) {
            resAttrsTruncated = true;
            resourceAttributes[key] = values
              .slice(0, MAX_ATTR_VALUES)
              .map((v) => String(v.value));
          } else {
            resourceAttributes[key] = values.map((v) => String(v.value));
          }
        }

        metrics.push({
          name: metric.MetricName,
          type: metric.MetricType,
          unit: metric.MetricUnit || undefined,
          description: metric.MetricDescription || undefined,
          attributes: {
            values: attributes,
            ...(attrsTruncated && { _truncated: true }),
          },
          resourceAttributes: {
            values: resourceAttributes,
            ...(resAttrsTruncated && { _truncated: true }),
          },
        });
      }

      return { metrics };
    } catch (error) {
      if (error instanceof SqliteDatasourceQueryError) throw error;
      throw new SqliteDatasourceQueryError("Failed to discover metrics", {
        cause: error,
      });
    }
  }
}

function toSpanRow(
  resource: otlp.Resource | undefined,
  scope: otlp.InstrumentationScope | undefined,
  span: otlp.Span
): Insertable<OtelTraces> {
  const events = span.events ?? [];
  const links = span.links ?? [];
  const startNanos = nanosToSqlite(span.startTimeUnixNano);
  const endNanos = nanosToSqlite(span.endTimeUnixNano);
  const durationNanos = endNanos - startNanos;

  return {
    TraceId: span.traceId ?? "",
    SpanId: span.spanId ?? "",
    ParentSpanId: span.parentSpanId ?? "",
    TraceState: span.traceState ?? "",
    SpanName: span.name ?? "",
    SpanKind: spanKindToString(span.kind),
    ServiceName: extractServiceName(resource),
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    SpanAttributes: keyValueArrayToJson(span.attributes),
    Timestamp: startNanos,
    Duration: durationNanos,
    StatusCode: statusCodeToString(span.status?.code),
    StatusMessage: span.status?.message ?? "",
    "Events.Timestamp": JSON.stringify(
      events.map((e) => String(nanosToSqlite(e.timeUnixNano)))
    ),
    "Events.Name": JSON.stringify(events.map((e) => e.name ?? "")),
    "Events.Attributes": JSON.stringify(
      events.map((e) => keyValueArrayToObject(e.attributes))
    ),
    "Links.TraceId": JSON.stringify(links.map((l) => l.traceId ?? "")),
    "Links.SpanId": JSON.stringify(links.map((l) => l.spanId ?? "")),
    "Links.TraceState": JSON.stringify(links.map((l) => l.traceState ?? "")),
    "Links.Attributes": JSON.stringify(
      links.map((l) => keyValueArrayToObject(l.attributes))
    ),
  };
}

function toLogRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  logRecord: otlp.LogRecord
): Insertable<OtelLogs> {
  return {
    Timestamp: nanosToSqlite(logRecord.timeUnixNano),
    TraceId: logRecord.traceId ?? "",
    SpanId: logRecord.spanId ?? "",
    TraceFlags: logRecord.flags ?? 0,
    SeverityText: logRecord.severityText ?? "",
    SeverityNumber: logRecord.severityNumber ?? 0,
    Body: anyValueToBodyString(logRecord.body),
    LogAttributes: keyValueArrayToJson(logRecord.attributes),
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
  };
}

function spanKindToString(kind: otlp.SpanKind | undefined): string {
  if (kind === undefined) return "";
  return otlp.SpanKind[kind] ?? "";
}

function statusCodeToString(code: otlp.StatusCode | undefined): string {
  if (code === undefined) return "";
  return otlp.StatusCode[code] ?? "";
}

function toGaugeRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.NumberDataPoint
): Insertable<OtelMetricsGauge> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToSqlite(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToSqlite(dataPoint.timeUnixNano),
    Value: dataPoint.asDouble ?? Number(dataPoint.asInt ?? 0),
    Flags: dataPoint.flags ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      String(nanosToSqlite(e.timeUnixNano))
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
  };
}

function toSumRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.NumberDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined,
  isMonotonic: boolean | undefined
): Insertable<OtelMetricsSum> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToSqlite(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToSqlite(dataPoint.timeUnixNano),
    Value: dataPoint.asDouble ?? Number(dataPoint.asInt ?? 0),
    Flags: dataPoint.flags ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      String(nanosToSqlite(e.timeUnixNano))
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
    IsMonotonic: isMonotonic ? 1 : 0,
  };
}

function toHistogramRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.HistogramDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined
): Insertable<OtelMetricsHistogram> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToSqlite(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToSqlite(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    BucketCounts: JSON.stringify(dataPoint.bucketCounts ?? []),
    ExplicitBounds: JSON.stringify(dataPoint.explicitBounds ?? []),
    Min: dataPoint.min ?? null,
    Max: dataPoint.max ?? null,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      String(nanosToSqlite(e.timeUnixNano))
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
  };
}

function toExpHistogramRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.ExponentialHistogramDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined
): Insertable<OtelMetricsExponentialHistogram> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToSqlite(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToSqlite(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    Scale: dataPoint.scale ?? 0,
    ZeroCount: Number(dataPoint.zeroCount ?? 0),
    PositiveOffset: dataPoint.positive?.offset ?? 0,
    PositiveBucketCounts: JSON.stringify(
      dataPoint.positive?.bucketCounts ?? []
    ),
    NegativeOffset: dataPoint.negative?.offset ?? 0,
    NegativeBucketCounts: JSON.stringify(
      dataPoint.negative?.bucketCounts ?? []
    ),
    Min: dataPoint.min ?? null,
    Max: dataPoint.max ?? null,
    ZeroThreshold: dataPoint.zeroThreshold ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      String(nanosToSqlite(e.timeUnixNano))
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
  };
}

function toSummaryRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.SummaryDataPoint
): Insertable<OtelMetricsSummary> {
  const quantileValues = dataPoint.quantileValues ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToSqlite(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToSqlite(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    "ValueAtQuantiles.Quantile": JSON.stringify(
      quantileValues.map(
        (q: otlpMetrics.SummaryDataPoint_ValueAtQuantile) => q.quantile ?? 0
      )
    ),
    "ValueAtQuantiles.Value": JSON.stringify(
      quantileValues.map(
        (q: otlpMetrics.SummaryDataPoint_ValueAtQuantile) => q.value ?? 0
      )
    ),
  };
}

function aggTemporalityToString(
  agg: otlp.AggregationTemporality | undefined
): string {
  if (agg === undefined) return "";
  return otlp.AggregationTemporality[agg] ?? "";
}

function anyValueToSimple(value: otlp.AnyValue | undefined): unknown {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue !== undefined) {
    return value.arrayValue.values?.map((v) => anyValueToSimple(v)) ?? [];
  }
  if (value.kvlistValue !== undefined) {
    const obj: Record<string, unknown> = {};
    for (const kv of value.kvlistValue.values ?? []) {
      if (kv.key) obj[kv.key] = anyValueToSimple(kv.value);
    }
    return obj;
  }
  return null;
}

function anyValueToBodyString(value: otlp.AnyValue | undefined): string {
  const simple = anyValueToSimple(value);
  if (typeof simple === "string") return simple;
  return JSON.stringify(simple);
}

function keyValueArrayToObject(
  attrs: otlp.KeyValue[] | undefined
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (!attrs) return obj;
  for (const kv of attrs) {
    if (kv.key) obj[kv.key] = anyValueToSimple(kv.value);
  }
  return obj;
}

function keyValueArrayToJson(attrs: otlp.KeyValue[] | undefined): string {
  if (!attrs || attrs.length === 0) return "{}";
  return JSON.stringify(keyValueArrayToObject(attrs));
}

function extractServiceName(resource: otlp.Resource | undefined): string {
  if (!resource?.attributes) return "";
  for (const kv of resource.attributes) {
    if (kv.key === "service.name" && kv.value?.stringValue) {
      return kv.value.stringValue;
    }
  }
  return "";
}

function nanosToSqlite(nanos: string | undefined): bigint {
  return BigInt(nanos ?? "0");
}

function exemplarsArrayToJson<T>(
  exemplars: otlpMetrics.Exemplar[],
  extractor: (e: otlpMetrics.Exemplar) => T
): string {
  if (exemplars.length === 0) return "[]";
  return JSON.stringify(exemplars.map(extractor));
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mapRowToOtelTraces(
  row: Record<string, unknown> // TODO: can we use kysely-generated type for this?
): denormalizedSignals.OtelTracesRow {
  return {
    TraceId: row.TraceId as string,
    SpanId: row.SpanId as string,
    Timestamp: String(row.Timestamp),
    ParentSpanId: row.ParentSpanId as string | undefined,
    TraceState: row.TraceState as string | undefined,
    SpanName: row.SpanName as string | undefined,
    SpanKind: row.SpanKind as string | undefined,
    ServiceName: row.ServiceName as string | undefined,
    ResourceAttributes: parseJsonField(row.ResourceAttributes),
    ScopeName: row.ScopeName as string | undefined,
    ScopeVersion: row.ScopeVersion as string | undefined,
    SpanAttributes: parseJsonField(row.SpanAttributes),
    Duration: row.Duration != null ? String(row.Duration) : undefined,
    StatusCode: row.StatusCode as string | undefined,
    StatusMessage: row.StatusMessage as string | undefined,
    "Events.Timestamp": parseStringArrayField(row["Events.Timestamp"]),
    "Events.Name": parseStringArrayField(row["Events.Name"]),
    "Events.Attributes": parseJsonArrayField(row["Events.Attributes"]),
    "Links.TraceId": parseStringArrayField(row["Links.TraceId"]),
    "Links.SpanId": parseStringArrayField(row["Links.SpanId"]),
    "Links.TraceState": parseStringArrayField(row["Links.TraceState"]),
    "Links.Attributes": parseJsonArrayField(row["Links.Attributes"]),
  };
}

type AttributeValue = string | number | boolean;

function parseJsonField(
  value: unknown
): Record<string, AttributeValue> | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonArrayField(
  value: unknown
): Record<string, AttributeValue>[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStringArrayField(value: unknown): string[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseNumberArrayField(value: unknown): number[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// Convert BigInt to Number for non-timestamp integer fields
function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return undefined;
}

function mapRowToOtelLogs(
  row: Record<string, unknown> // TODO: can we use kysely-generated type for this?
): denormalizedSignals.OtelLogsRow {
  return {
    Timestamp: String(row.Timestamp),
    TraceId: row.TraceId as string | undefined,
    SpanId: row.SpanId as string | undefined,
    TraceFlags: toNumber(row.TraceFlags),
    SeverityText: row.SeverityText as string | undefined,
    SeverityNumber: toNumber(row.SeverityNumber),
    Body: row.Body as string | undefined,
    LogAttributes: parseJsonField(row.LogAttributes),
    ResourceAttributes: parseJsonField(row.ResourceAttributes),
    ResourceSchemaUrl: row.ResourceSchemaUrl as string | undefined,
    ServiceName: row.ServiceName as string | undefined,
    ScopeName: row.ScopeName as string | undefined,
    ScopeVersion: row.ScopeVersion as string | undefined,
    ScopeAttributes: parseJsonField(row.ScopeAttributes),
    ScopeSchemaUrl: row.ScopeSchemaUrl as string | undefined,
  };
}

const METRIC_TABLES = [
  { table: "otel_metrics_gauge", type: "Gauge" },
  { table: "otel_metrics_sum", type: "Sum" },
  { table: "otel_metrics_histogram", type: "Histogram" },
  { table: "otel_metrics_exponential_histogram", type: "ExponentialHistogram" },
  { table: "otel_metrics_summary", type: "Summary" },
] as const;

const MAX_ATTR_VALUES = 100;

function mapRowToOtelMetrics(
  row: Record<string, unknown>, // TODO: can we use kysely-generated type for this?
  metricType: "Gauge" | "Sum" | "Histogram" | "ExponentialHistogram" | "Summary"
): denormalizedSignals.OtelMetricsRow {
  const base = {
    TimeUnix: String(row.TimeUnix),
    StartTimeUnix: String(row.StartTimeUnix),
    Attributes: parseJsonField(row.Attributes),
    MetricName: row.MetricName as string | undefined,
    MetricDescription: row.MetricDescription as string | undefined,
    MetricUnit: row.MetricUnit as string | undefined,
    ResourceAttributes: parseJsonField(row.ResourceAttributes),
    ResourceSchemaUrl: row.ResourceSchemaUrl as string | undefined,
    ScopeAttributes: parseJsonField(row.ScopeAttributes),
    ScopeDroppedAttrCount: toNumber(row.ScopeDroppedAttrCount),
    ScopeName: row.ScopeName as string | undefined,
    ScopeSchemaUrl: row.ScopeSchemaUrl as string | undefined,
    ScopeVersion: row.ScopeVersion as string | undefined,
    ServiceName: row.ServiceName as string | undefined,
    "Exemplars.FilteredAttributes": parseJsonArrayField(
      row["Exemplars.FilteredAttributes"]
    ),
    "Exemplars.SpanId": parseStringArrayField(row["Exemplars.SpanId"]),
    "Exemplars.TimeUnix": parseStringArrayField(row["Exemplars.TimeUnix"]),
    "Exemplars.TraceId": parseStringArrayField(row["Exemplars.TraceId"]),
    "Exemplars.Value": parseNumberArrayField(row["Exemplars.Value"]),
  };

  if (metricType === "Gauge") {
    return {
      ...base,
      MetricType: "Gauge" as const,
      Value: row.Value as number,
      Flags: toNumber(row.Flags),
    };
  }

  if (metricType === "Sum") {
    return {
      ...base,
      MetricType: "Sum" as const,
      Value: row.Value as number,
      Flags: toNumber(row.Flags),
      AggTemporality: row.AggTemporality as string | undefined,
      IsMonotonic: toNumber(row.IsMonotonic),
    };
  }

  if (metricType === "Histogram") {
    return {
      ...base,
      MetricType: "Histogram" as const,
      Count: toNumber(row.Count),
      Sum: row.Sum as number | undefined,
      Min: row.Min as number | null | undefined,
      Max: row.Max as number | null | undefined,
      BucketCounts: parseNumberArrayField(row.BucketCounts),
      ExplicitBounds: parseNumberArrayField(row.ExplicitBounds),
      AggTemporality: row.AggTemporality as string | undefined,
    };
  }

  if (metricType === "ExponentialHistogram") {
    return {
      ...base,
      MetricType: "ExponentialHistogram" as const,
      Count: toNumber(row.Count),
      Sum: row.Sum as number | undefined,
      Min: row.Min as number | null | undefined,
      Max: row.Max as number | null | undefined,
      Scale: toNumber(row.Scale),
      ZeroCount: toNumber(row.ZeroCount),
      PositiveOffset: toNumber(row.PositiveOffset),
      PositiveBucketCounts: parseNumberArrayField(row.PositiveBucketCounts),
      NegativeOffset: toNumber(row.NegativeOffset),
      NegativeBucketCounts: parseNumberArrayField(row.NegativeBucketCounts),
      AggTemporality: row.AggTemporality as string | undefined,
    };
  }

  // Summary
  return {
    ...base,
    MetricType: "Summary" as const,
    Count: toNumber(row.Count),
    Sum: row.Sum as number | undefined,
    "ValueAtQuantiles.Quantile": parseNumberArrayField(
      row["ValueAtQuantiles.Quantile"]
    ),
    "ValueAtQuantiles.Value": parseNumberArrayField(
      row["ValueAtQuantiles.Value"]
    ),
  };
}
