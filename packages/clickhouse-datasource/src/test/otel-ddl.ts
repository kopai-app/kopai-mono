import type { ClickHouseClient } from "@clickhouse/client";

// Single source of truth for the OTEL ClickHouse table schema used by the
// testcontainer-based suites in this package. The production schema is owned
// externally (the OpenTelemetry ClickHouse exporter / k8s migrations), so this
// is a faithful copy maintained for tests only — keep it out of src/index.ts so
// it never leaks into the published package.
export async function createOtelTables(
  client: ClickHouseClient
): Promise<void> {
  const metricsCommonCols = `
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    MetricName String CODEC(ZSTD(1)),
    MetricDescription String CODEC(ZSTD(1)),
    MetricUnit String CODEC(ZSTD(1)),
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1))
  `;

  const exemplarCols = `
    \`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    \`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
    \`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
    \`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
    \`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1))
  `;

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_traces (
      Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
      TraceId String CODEC(ZSTD(1)),
      SpanId String CODEC(ZSTD(1)),
      ParentSpanId String CODEC(ZSTD(1)),
      TraceState String CODEC(ZSTD(1)),
      SpanName LowCardinality(String) CODEC(ZSTD(1)),
      SpanKind LowCardinality(String) CODEC(ZSTD(1)),
      ServiceName LowCardinality(String) CODEC(ZSTD(1)),
      ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      ScopeName String CODEC(ZSTD(1)),
      ScopeVersion String CODEC(ZSTD(1)),
      SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      Duration UInt64 CODEC(ZSTD(1)),
      StatusCode LowCardinality(String) CODEC(ZSTD(1)),
      StatusMessage String CODEC(ZSTD(1)),
      \`Events.Timestamp\` Array(DateTime64(9)) CODEC(ZSTD(1)),
      \`Events.Name\` Array(LowCardinality(String)) CODEC(ZSTD(1)),
      \`Events.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
      \`Links.TraceId\` Array(String) CODEC(ZSTD(1)),
      \`Links.SpanId\` Array(String) CODEC(ZSTD(1)),
      \`Links.TraceState\` Array(String) CODEC(ZSTD(1)),
      \`Links.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1))
    ) ENGINE = MergeTree()
    ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_logs (
      Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
      TimestampTime DateTime DEFAULT toDateTime(Timestamp),
      TraceId String CODEC(ZSTD(1)),
      SpanId String CODEC(ZSTD(1)),
      TraceFlags UInt8,
      SeverityText LowCardinality(String) CODEC(ZSTD(1)),
      SeverityNumber UInt8,
      ServiceName LowCardinality(String) CODEC(ZSTD(1)),
      Body String CODEC(ZSTD(1)),
      ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
      ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
      ScopeName String CODEC(ZSTD(1)),
      ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
      ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
      EventName String CODEC(ZSTD(1))
    ) ENGINE = MergeTree()
    ORDER BY (ServiceName, TimestampTime, Timestamp)`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_metrics_gauge (
      ${metricsCommonCols},
      Value Float64 CODEC(ZSTD(1)),
      Flags UInt32 CODEC(ZSTD(1)),
      ${exemplarCols}
    ) ENGINE = MergeTree() ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_metrics_sum (
      ${metricsCommonCols},
      Value Float64 CODEC(ZSTD(1)),
      Flags UInt32 CODEC(ZSTD(1)),
      ${exemplarCols},
      AggregationTemporality Int32 CODEC(ZSTD(1)),
      IsMonotonic Bool CODEC(ZSTD(1))
    ) ENGINE = MergeTree() ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_metrics_histogram (
      ${metricsCommonCols},
      Count UInt64 CODEC(ZSTD(1)),
      Sum Float64 CODEC(ZSTD(1)),
      BucketCounts Array(UInt64) CODEC(ZSTD(1)),
      ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
      ${exemplarCols},
      Min Float64 CODEC(ZSTD(1)),
      Max Float64 CODEC(ZSTD(1)),
      AggregationTemporality Int32 CODEC(ZSTD(1))
    ) ENGINE = MergeTree() ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_metrics_exponential_histogram (
      ${metricsCommonCols},
      Count UInt64 CODEC(ZSTD(1)),
      Sum Float64 CODEC(ZSTD(1)),
      Scale Int32 CODEC(ZSTD(1)),
      ZeroCount UInt64 CODEC(ZSTD(1)),
      PositiveOffset Int32 CODEC(ZSTD(1)),
      PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
      NegativeOffset Int32 CODEC(ZSTD(1)),
      NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1)),
      ${exemplarCols},
      Min Float64 CODEC(ZSTD(1)),
      Max Float64 CODEC(ZSTD(1)),
      AggregationTemporality Int32 CODEC(ZSTD(1))
    ) ENGINE = MergeTree() ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
  });

  await client.command({
    query: `CREATE TABLE IF NOT EXISTS otel_metrics_summary (
      ${metricsCommonCols},
      Count UInt64 CODEC(ZSTD(1)),
      Sum Float64 CODEC(ZSTD(1)),
      \`ValueAtQuantiles.Quantile\` Array(Float64) CODEC(ZSTD(1)),
      \`ValueAtQuantiles.Value\` Array(Float64) CODEC(ZSTD(1))
    ) ENGINE = MergeTree() ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))`,
  });
}
