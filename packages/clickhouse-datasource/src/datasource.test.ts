import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { ClickHouseReadDatasource } from "./datasource.js";
import { getDiscoverMVSchema } from "./discover-mv-schema.js";

/** Returns the first element of an array, failing the test if the array is empty. */
function firstRow<T>(data: T[]): T {
  expect(data.length).toBeGreaterThan(0);
  return data[0] as T;
}

/** Asserts a value is not null/undefined and returns the narrowed type. */
function defined<T>(value: T | null | undefined, label = "value"): T {
  expect(value, `expected ${label} to be defined`).toBeDefined();
  expect(value, `expected ${label} to not be null`).not.toBeNull();
  return value as T;
}

/** Asserts that BigInt values extracted from rows are in ascending order. */
function expectAscending(values: bigint[]): void {
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] as bigint;
    const curr = values[i] as bigint;
    expect(curr >= prev).toBe(true);
  }
}

const CLICKHOUSE_HTTP_PORT = 8123;
const TEST_DATABASE = "test_db";
const TENANT_B_DATABASE = "tenant_b_db";
const CONTAINER_STARTUP_TIMEOUT = 60_000;

let container: StartedTestContainer;
let adminClient: ClickHouseClient;
let baseUrl: string;
let ds: ClickHouseReadDatasource;

const dirname = path.dirname(fileURLToPath(import.meta.url));

function requestContext() {
  return {
    database: TEST_DATABASE,
    username: "default",
    password: "",
  };
}

function tenantBRequestContext() {
  return {
    database: TENANT_B_DATABASE,
    username: "default",
    password: "",
  };
}

beforeAll(async () => {
  container = await new GenericContainer(
    "clickhouse/clickhouse-server:25.6-alpine"
  )
    .withExposedPorts(CLICKHOUSE_HTTP_PORT)
    .withBindMounts([
      {
        source: path.join(dirname, "test-users.xml"),
        target: "/etc/clickhouse-server/users.d/test-users.xml",
      },
    ])
    .withWaitStrategy(
      Wait.forHttp("/", CLICKHOUSE_HTTP_PORT).forResponsePredicate(
        (response) => response === "Ok.\n"
      )
    )
    .start();

  baseUrl = `http://${container.getHost()}:${String(container.getMappedPort(CLICKHOUSE_HTTP_PORT))}`;

  adminClient = createClient({
    url: baseUrl,
    username: "default",
    password: "",
  });

  // Create test database and tables
  await adminClient.command({
    query: `CREATE DATABASE IF NOT EXISTS ${TEST_DATABASE}`,
  });

  const dbClient = createClient({
    url: baseUrl,
    database: TEST_DATABASE,
    username: "default",
    password: "",
  });

  await createOtelTables(dbClient);

  // Seed test data
  await seedTraces(dbClient);
  await seedLogs(dbClient);
  await seedDuplicateTimestampLogs(dbClient);
  await seedMetrics(dbClient);
  await seedDuplicateTimestampMetrics(dbClient);
  await seedTruncationMetric(dbClient);
  await seedMultiAttrMetric(dbClient);

  await dbClient.close();

  // Create tenant_b database with distinct data for isolation tests
  await adminClient.command({
    query: `CREATE DATABASE IF NOT EXISTS ${TENANT_B_DATABASE}`,
  });

  const tenantBClient = createClient({
    url: baseUrl,
    database: TENANT_B_DATABASE,
    username: "default",
    password: "",
  });

  await createOtelTables(tenantBClient);
  await seedTenantBData(tenantBClient);
  await tenantBClient.close();

  ds = new ClickHouseReadDatasource(baseUrl);
}, CONTAINER_STARTUP_TIMEOUT);

afterAll(async () => {
  await ds?.close();
  await adminClient?.close();
  await container?.stop();
});

async function createOtelTables(client: ClickHouseClient) {
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
    query: `
      CREATE TABLE IF NOT EXISTS otel_traces (
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
      ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
    `,
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS otel_logs (
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
        LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1))
      ) ENGINE = MergeTree()
      ORDER BY (ServiceName, TimestampTime, Timestamp)
    `,
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

async function seedTenantBData(client: ClickHouseClient) {
  await client.insert({
    table: "otel_traces",
    values: [
      {
        Timestamp: "2024-06-01 00:00:01.000000000",
        TraceId: "trace-b-001",
        SpanId: "span-b-001",
        ParentSpanId: "",
        TraceState: "",
        SpanName: "GET /api/tenant-b",
        SpanKind: "SERVER",
        ServiceName: "tenant-b-service",
        ResourceAttributes: { "tenant.id": "b" },
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        SpanAttributes: { "http.method": "GET" },
        Duration: 3000000,
        StatusCode: "OK",
        StatusMessage: "",
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.TraceState": [],
        "Links.Attributes": [],
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_logs",
    values: [
      {
        Timestamp: "2024-06-01 00:00:01.000000000",
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "INFO",
        SeverityNumber: 9,
        ServiceName: "tenant-b-service",
        Body: "Tenant B log message",
        ResourceSchemaUrl: "",
        ResourceAttributes: { "tenant.id": "b" },
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: {},
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_metrics_gauge",
    values: [
      {
        ResourceAttributes: { "tenant.id": "b" },
        ResourceSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "tenant-b-service",
        MetricName: "tenant.b.gauge",
        MetricDescription: "Tenant B gauge",
        MetricUnit: "1",
        Attributes: { region: "eu-west" },
        StartTimeUnix: "2024-06-01 00:00:00.000000000",
        TimeUnix: "2024-06-01 00:00:01.000000000",
        Value: 99,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
      },
    ],
    format: "JSONEachRow",
  });
}

async function seedTraces(client: ClickHouseClient) {
  await client.insert({
    table: "otel_traces",
    values: [
      {
        Timestamp: "2024-01-01 00:00:01.000000000",
        TraceId: "trace-001",
        SpanId: "span-001",
        ParentSpanId: "",
        TraceState: "",
        SpanName: "GET /api/users",
        SpanKind: "SERVER",
        ServiceName: "user-service",
        ResourceAttributes: { "service.version": "1.0" },
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        SpanAttributes: { "http.method": "GET", "http.status_code": "200" },
        Duration: 5000000,
        StatusCode: "OK",
        StatusMessage: "",
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.TraceState": [],
        "Links.Attributes": [],
      },
      {
        Timestamp: "2024-01-01 00:00:02.000000000",
        TraceId: "trace-001",
        SpanId: "span-002",
        ParentSpanId: "span-001",
        TraceState: "",
        SpanName: "DB query",
        SpanKind: "CLIENT",
        ServiceName: "user-service",
        ResourceAttributes: { "service.version": "1.0" },
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        SpanAttributes: { "db.system": "postgresql" },
        Duration: 2000000,
        StatusCode: "OK",
        StatusMessage: "",
        "Events.Timestamp": ["2024-01-01 00:00:02.100000000"],
        "Events.Name": ["query_start"],
        "Events.Attributes": [{ "db.statement": "SELECT * FROM users" }],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.TraceState": [],
        "Links.Attributes": [],
      },
      {
        Timestamp: "2024-01-01 00:00:03.000000000",
        TraceId: "trace-002",
        SpanId: "span-003",
        ParentSpanId: "",
        TraceState: "",
        SpanName: "POST /api/orders",
        SpanKind: "SERVER",
        ServiceName: "order-service",
        ResourceAttributes: { "service.version": "2.0" },
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        SpanAttributes: { "http.method": "POST", "http.status_code": "500" },
        Duration: 15000000,
        StatusCode: "ERROR",
        StatusMessage: "Internal server error",
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": ["trace-001"],
        "Links.SpanId": ["span-001"],
        "Links.TraceState": [""],
        "Links.Attributes": [{ "link.type": "follows_from" }],
      },
    ],
    format: "JSONEachRow",
  });
}

async function seedLogs(client: ClickHouseClient) {
  await client.insert({
    table: "otel_logs",
    values: [
      {
        Timestamp: "2024-01-01 00:00:01.000000000",
        TraceId: "trace-001",
        SpanId: "span-001",
        TraceFlags: 0,
        SeverityText: "INFO",
        SeverityNumber: 9,
        ServiceName: "user-service",
        Body: "Request received for /api/users",
        ResourceSchemaUrl: "",
        ResourceAttributes: { "service.version": "1.0" },
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: { "request.id": "req-001" },
      },
      {
        Timestamp: "2024-01-01 00:00:02.000000000",
        TraceId: "trace-001",
        SpanId: "span-002",
        TraceFlags: 0,
        SeverityText: "ERROR",
        SeverityNumber: 17,
        ServiceName: "user-service",
        Body: "Database connection failed",
        ResourceSchemaUrl: "",
        ResourceAttributes: { "service.version": "1.0" },
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: { "error.type": "ConnectionError" },
      },
      {
        Timestamp: "2024-01-01 00:00:03.000000000",
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "WARN",
        SeverityNumber: 13,
        ServiceName: "order-service",
        Body: "Slow query detected",
        ResourceSchemaUrl: "",
        ResourceAttributes: {},
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: {},
      },
    ],
    format: "JSONEachRow",
  });
}

async function seedDuplicateTimestampLogs(client: ClickHouseClient) {
  await client.insert({
    table: "otel_logs",
    values: [
      {
        Timestamp: "2024-01-01 00:00:05.000000000",
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "INFO",
        SeverityNumber: 9,
        ServiceName: "dup-service",
        Body: "same-ts-log-A",
        ResourceSchemaUrl: "",
        ResourceAttributes: {},
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: {},
      },
      {
        Timestamp: "2024-01-01 00:00:05.000000000",
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "INFO",
        SeverityNumber: 9,
        ServiceName: "dup-service",
        Body: "same-ts-log-B",
        ResourceSchemaUrl: "",
        ResourceAttributes: {},
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: {},
      },
      {
        Timestamp: "2024-01-01 00:00:05.000000000",
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "INFO",
        SeverityNumber: 9,
        ServiceName: "dup-service",
        Body: "same-ts-log-C",
        ResourceSchemaUrl: "",
        ResourceAttributes: {},
        ScopeSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        LogAttributes: {},
      },
    ],
    format: "JSONEachRow",
  });
}

async function seedMetrics(client: ClickHouseClient) {
  await client.insert({
    table: "otel_metrics_gauge",
    values: [
      {
        ResourceAttributes: { "service.version": "1.0" },
        ResourceSchemaUrl: "",
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "system.cpu.utilization",
        MetricDescription: "CPU utilization",
        MetricUnit: "1",
        Attributes: { cpu: "0" },
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Value: 0.75,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
      },
      {
        ResourceAttributes: { "service.version": "1.0" },
        ResourceSchemaUrl: "",
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "system.cpu.utilization",
        MetricDescription: "CPU utilization",
        MetricUnit: "1",
        Attributes: { cpu: "1" },
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:02.000000000",
        Value: 0.82,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
      },
      {
        ResourceAttributes: { "service.version": "1.0" },
        ResourceSchemaUrl: "",
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "system.cpu.utilization",
        MetricDescription: "CPU utilization",
        MetricUnit: "1",
        Attributes: { cpu: "2" },
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:03.000000000",
        Value: 0.6,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_metrics_sum",
    values: [
      {
        ResourceAttributes: { "service.version": "1.0" },
        ResourceSchemaUrl: "",
        ScopeName: "otel-sdk",
        ScopeVersion: "1.0.0",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "http.server.request.count",
        MetricDescription: "Total HTTP requests",
        MetricUnit: "{requests}",
        Attributes: { "http.method": "GET" },
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Value: 42,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
        AggregationTemporality: 2,
        IsMonotonic: true,
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_metrics_histogram",
    values: [
      {
        ResourceAttributes: {},
        ResourceSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "http.server.request.duration",
        MetricDescription: "Request duration",
        MetricUnit: "ms",
        Attributes: {},
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Count: 10,
        Sum: 150.5,
        BucketCounts: [1, 3, 5, 1],
        ExplicitBounds: [10, 50, 100],
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
        Min: 5.0,
        Max: 95.0,
        AggregationTemporality: 2,
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_metrics_exponential_histogram",
    values: [
      {
        ResourceAttributes: {},
        ResourceSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "http.server.request.duration.exp",
        MetricDescription: "Request duration (exp histogram)",
        MetricUnit: "ms",
        Attributes: {},
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Count: 10,
        Sum: 150.5,
        Scale: 3,
        ZeroCount: 0,
        PositiveOffset: 1,
        PositiveBucketCounts: [2, 3, 5],
        NegativeOffset: 0,
        NegativeBucketCounts: [],
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
        Min: 5.0,
        Max: 95.0,
        AggregationTemporality: 2,
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "otel_metrics_summary",
    values: [
      {
        ResourceAttributes: {},
        ResourceSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "user-service",
        MetricName: "rpc.server.duration.summary",
        MetricDescription: "RPC duration summary",
        MetricUnit: "ms",
        Attributes: {},
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Count: 100,
        Sum: 5000.0,
        "ValueAtQuantiles.Quantile": [0.5, 0.9, 0.99],
        "ValueAtQuantiles.Value": [25.0, 80.0, 150.0],
      },
    ],
    format: "JSONEachRow",
  });
}

const TRUNCATION_METRIC_ROW_COUNT = 102;

async function seedTruncationMetric(client: ClickHouseClient) {
  const values = Array.from(
    { length: TRUNCATION_METRIC_ROW_COUNT },
    (_, i) => ({
      ResourceAttributes: {},
      ResourceSchemaUrl: "",
      ScopeName: "",
      ScopeVersion: "",
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeSchemaUrl: "",
      ServiceName: "user-service",
      MetricName: "test.truncation.metric",
      MetricDescription: "Metric for truncation test",
      MetricUnit: "1",
      Attributes: { idx: String(i) },
      StartTimeUnix: "2024-01-01 00:00:00.000000000",
      TimeUnix: "2024-01-01 00:00:01.000000000",
      Value: i,
      Flags: 0,
      "Exemplars.FilteredAttributes": [],
      "Exemplars.TimeUnix": [],
      "Exemplars.Value": [],
      "Exemplars.SpanId": [],
      "Exemplars.TraceId": [],
    })
  );

  await client.insert({
    table: "otel_metrics_gauge",
    values,
    format: "JSONEachRow",
  });
}

async function seedDuplicateTimestampMetrics(client: ClickHouseClient) {
  const base = {
    ResourceAttributes: {},
    ResourceSchemaUrl: "",
    ScopeName: "",
    ScopeVersion: "",
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: "",
    ServiceName: "dup-metric-service",
    MetricName: "dup.ts.gauge",
    MetricDescription: "",
    MetricUnit: "1",
    StartTimeUnix: "2024-01-01 00:00:00.000000000",
    TimeUnix: "2024-01-01 00:00:10.000000000",
    Value: 1,
    Flags: 0,
    "Exemplars.FilteredAttributes": [],
    "Exemplars.TimeUnix": [],
    "Exemplars.Value": [],
    "Exemplars.SpanId": [],
    "Exemplars.TraceId": [],
  };
  await client.insert({
    table: "otel_metrics_gauge",
    values: [
      { ...base, Attributes: { idx: "0" } },
      { ...base, Attributes: { idx: "1" } },
      { ...base, Attributes: { idx: "2" } },
    ],
    format: "JSONEachRow",
  });
}

/**
 * Seed a gauge metric with multiple attributes on a single row.
 * This exposes the double-arrayJoin cross-product bug in discovery queries:
 * if the query calls arrayJoin(mapKeys(Attributes)) twice in the same SELECT,
 * a row with N attribute keys produces N*N rows instead of N.
 */
async function seedMultiAttrMetric(client: ClickHouseClient) {
  await client.insert({
    table: "otel_metrics_gauge",
    values: [
      {
        ResourceAttributes: { "cloud.provider": "aws" },
        ResourceSchemaUrl: "",
        ScopeName: "",
        ScopeVersion: "",
        ScopeAttributes: {},
        ScopeDroppedAttrCount: 0,
        ScopeSchemaUrl: "",
        ServiceName: "multi-attr-service",
        MetricName: "test.multi.attr",
        MetricDescription: "Metric with multiple attributes per row",
        MetricUnit: "1",
        Attributes: { region: "us-east", env: "prod", tier: "premium" },
        StartTimeUnix: "2024-01-01 00:00:00.000000000",
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Value: 1,
        Flags: 0,
        "Exemplars.FilteredAttributes": [],
        "Exemplars.TimeUnix": [],
        "Exemplars.Value": [],
        "Exemplars.SpanId": [],
        "Exemplars.TraceId": [],
      },
    ],
    format: "JSONEachRow",
  });
}

describe("ClickHouseReadDatasource", () => {
  describe("getTraces", () => {
    it("returns all traces with no filters", async () => {
      const result = await ds.getTraces({ requestContext: requestContext() });

      expect(result.data.length).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it("filters by traceId", async () => {
      const result = await ds.getTraces({
        traceId: "trace-001",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
      expect(result.data.every((row) => row.TraceId === "trace-001")).toBe(
        true
      );
    });

    it("filters by serviceName", async () => {
      const result = await ds.getTraces({
        serviceName: "order-service",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(firstRow(result.data).ServiceName).toBe("order-service");
    });

    it("returns timestamps as nanosecond strings", async () => {
      const result = await ds.getTraces({
        traceId: "trace-001",
        spanId: "span-001",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      // 2024-01-01 00:00:01 = 1704067201 seconds = 1704067201000000000 nanos
      expect(firstRow(result.data).Timestamp).toBe("1704067201000000000");
    });

    it("coerces attribute values", async () => {
      const result = await ds.getTraces({
        spanId: "span-001",
        requestContext: requestContext(),
      });

      expect(firstRow(result.data).SpanAttributes).toEqual({
        "http.method": "GET",
        "http.status_code": 200,
      });
    });

    it("filters by spanAttributes", async () => {
      const result = await ds.getTraces({
        spanAttributes: { "http.method": "POST" },
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(firstRow(result.data).SpanName).toBe("POST /api/orders");
    });

    it("returns Duration as string", async () => {
      const result = await ds.getTraces({
        spanId: "span-001",
        requestContext: requestContext(),
      });

      expect(firstRow(result.data).Duration).toBe("5000000");
    });

    it("maps Events correctly", async () => {
      const result = await ds.getTraces({
        spanId: "span-002",
        requestContext: requestContext(),
      });

      const row = firstRow(result.data);
      expect(row["Events.Name"]).toEqual(["query_start"]);
      expect(row["Events.Timestamp"]?.length).toBe(1);
    });

    it("maps Links correctly", async () => {
      const result = await ds.getTraces({
        spanId: "span-003",
        requestContext: requestContext(),
      });

      const row = firstRow(result.data);
      expect(row["Links.TraceId"]).toEqual(["trace-001"]);
      expect(row["Links.SpanId"]).toEqual(["span-001"]);
    });

    it("supports cursor pagination", async () => {
      const page1 = await ds.getTraces({
        limit: 2,
        sortOrder: "DESC",
        requestContext: requestContext(),
      });

      expect(page1.data.length).toBe(2);
      const cursor = defined(page1.nextCursor, "nextCursor");

      const page2 = await ds.getTraces({
        limit: 2,
        sortOrder: "DESC",
        cursor,
        requestContext: requestContext(),
      });

      expect(page2.data.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("supports ASC sort order", async () => {
      const result = await ds.getTraces({
        sortOrder: "ASC",
        requestContext: requestContext(),
      });

      expectAscending(result.data.map((row) => BigInt(row.Timestamp)));
    });

    it("returns empty result for no matches", async () => {
      const result = await ds.getTraces({
        traceId: "nonexistent",
        requestContext: requestContext(),
      });

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("throws without requestContext", async () => {
      await expect(ds.getTraces({})).rejects.toThrow(
        "requestContext must provide { database, username, password }"
      );
    });

    it("throws for partial requestContext (missing password)", async () => {
      await expect(
        ds.getTraces({ requestContext: { database: "db", username: "user" } })
      ).rejects.toThrow("requestContext must provide");
    });

    it("throws for non-string fields in requestContext", async () => {
      await expect(
        ds.getTraces({
          requestContext: { database: "db", username: "user", password: 123 },
        })
      ).rejects.toThrow("requestContext must provide");
    });

    it("throws for null requestContext", async () => {
      await expect(ds.getTraces({ requestContext: null })).rejects.toThrow(
        "requestContext must provide"
      );
    });

    it("throws on malformed cursor", async () => {
      await expect(
        ds.getTraces({
          cursor: "malformed-no-colon",
          requestContext: requestContext(),
        })
      ).rejects.toThrow("Invalid cursor format");
    });

    it("filters by spanAttributes AND resourceAttributes combined", async () => {
      const result = await ds.getTraces({
        spanAttributes: { "http.method": "GET" },
        resourceAttributes: { "service.version": "1.0" },
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(firstRow(result.data).SpanId).toBe("span-001");
    });

    it("accepts attribute keys with colons (valid OTel semconv)", async () => {
      await expect(
        ds.getTraces({
          spanAttributes: { "k8s.pod:name": "foo" },
          requestContext: requestContext(),
        })
      ).resolves.toEqual({ data: [], nextCursor: null });
    });
  });

  describe("getLogs", () => {
    it("returns all logs with no filters", async () => {
      const result = await ds.getLogs({ requestContext: requestContext() });

      expect(result.data.length).toBe(6);
    });

    it("filters by serviceName", async () => {
      const result = await ds.getLogs({
        serviceName: "order-service",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(firstRow(result.data).Body).toBe("Slow query detected");
    });

    it("filters by bodyContains (case-insensitive)", async () => {
      const result = await ds.getLogs({
        bodyContains: "database",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(firstRow(result.data).Body).toBe("Database connection failed");
    });

    it("filters by severity range", async () => {
      const result = await ds.getLogs({
        severityNumberMin: 13,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
      expect(result.data.every((row) => (row.SeverityNumber ?? 0) >= 13)).toBe(
        true
      );
    });

    it("coerces log attributes", async () => {
      const result = await ds.getLogs({
        serviceName: "user-service",
        severityText: "INFO",
        requestContext: requestContext(),
      });

      expect(firstRow(result.data).LogAttributes).toEqual({
        "request.id": "req-001",
      });
    });

    it("supports cursor pagination", async () => {
      const page1 = await ds.getLogs({
        serviceName: "user-service",
        limit: 1,
        sortOrder: "DESC",
        requestContext: requestContext(),
      });

      expect(page1.data.length).toBe(1);
      const cursor = defined(page1.nextCursor, "nextCursor");

      const page2 = await ds.getLogs({
        serviceName: "user-service",
        limit: 1,
        sortOrder: "DESC",
        cursor,
        requestContext: requestContext(),
      });

      expect(page2.data.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("supports ASC sort order", async () => {
      const result = await ds.getLogs({
        sortOrder: "ASC",
        requestContext: requestContext(),
      });

      expectAscending(result.data.map((row) => BigInt(row.Timestamp)));
    });

    it("cursor pagination does not skip rows with identical timestamps", async () => {
      const page1 = await ds.getLogs({
        serviceName: "dup-service",
        limit: 1,
        sortOrder: "ASC",
        requestContext: requestContext(),
      });
      expect(page1.data.length).toBe(1);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await ds.getLogs({
        serviceName: "dup-service",
        limit: 1,
        sortOrder: "ASC",
        cursor: page1.nextCursor!,
        requestContext: requestContext(),
      });
      expect(page2.data.length).toBe(1);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await ds.getLogs({
        serviceName: "dup-service",
        limit: 1,
        sortOrder: "ASC",
        cursor: page2.nextCursor!,
        requestContext: requestContext(),
      });
      expect(page3.data.length).toBe(1);
      expect(page3.nextCursor).toBeNull();

      const allBodies = [page1.data[0]!, page2.data[0]!, page3.data[0]!].map(
        (r) => r.Body
      );
      expect(new Set(allBodies).size).toBe(3);
    });

    it("escapes ILIKE special characters in bodyContains", async () => {
      // "%" should not match everything — none of our seed log bodies contain literal "%"
      const result = await ds.getLogs({
        bodyContains: "%",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(0);
    });

    it("accepts attribute keys with colons (valid OTel semconv)", async () => {
      await expect(
        ds.getLogs({
          logAttributes: { "k8s.pod:name": "foo" },
          requestContext: requestContext(),
        })
      ).resolves.toEqual({ data: [], nextCursor: null });
    });
  });

  describe("getMetrics", () => {
    it("queries Gauge metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(3);
      expect(firstRow(result.data).MetricType).toBe("Gauge");
    });

    it("queries Sum metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Sum",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const metric = firstRow(result.data);
      expect(metric.MetricType).toBe("Sum");
      if (metric.MetricType === "Sum") {
        expect(metric.Value).toBe(42);
        expect(metric.IsMonotonic).toBe(1);
      }
    });

    it("queries Histogram metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Histogram",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const metric = firstRow(result.data);
      expect(metric.MetricType).toBe("Histogram");
      if (metric.MetricType === "Histogram") {
        expect(metric.Count).toBe(10);
        expect(metric.BucketCounts).toEqual([1, 3, 5, 1]);
        expect(metric.ExplicitBounds).toEqual([10, 50, 100]);
      }
    });

    it("queries ExponentialHistogram", async () => {
      const result = await ds.getMetrics({
        metricType: "ExponentialHistogram",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const metric = firstRow(result.data);
      expect(metric.MetricType).toBe("ExponentialHistogram");
      if (metric.MetricType === "ExponentialHistogram") {
        expect(metric.ZeroThreshold).toBeUndefined();
        expect(metric.Scale).toBe(3);
        expect(metric.PositiveBucketCounts).toEqual([2, 3, 5]);
      }
    });

    it("queries Summary metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Summary",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const metric = firstRow(result.data);
      expect(metric.MetricType).toBe("Summary");
      if (metric.MetricType === "Summary") {
        expect(metric.Count).toBe(100);
        expect(metric["ValueAtQuantiles.Quantile"]).toEqual([0.5, 0.9, 0.99]);
        expect(metric["ValueAtQuantiles.Value"]).toEqual([25.0, 80.0, 150.0]);
      }
    });

    it("converts metric timestamps to nanos", async () => {
      const result = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        sortOrder: "ASC",
        requestContext: requestContext(),
      });

      // First gauge row has TimeUnix = 2024-01-01 00:00:01
      const row = firstRow(result.data);
      expect(row.TimeUnix).toBe("1704067201000000000");
      expect(row.StartTimeUnix).toBe("1704067200000000000");
    });

    it("supports cursor pagination for Gauge", async () => {
      const page1 = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        limit: 2,
        sortOrder: "DESC",
        requestContext: requestContext(),
      });

      expect(page1.data.length).toBe(2);
      const cursor = defined(page1.nextCursor, "nextCursor");

      const page2 = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        limit: 2,
        sortOrder: "DESC",
        cursor,
        requestContext: requestContext(),
      });

      expect(page2.data.length).toBe(1);
      expect(page2.nextCursor).toBeNull();
    });

    it("supports ASC sort order for Gauge", async () => {
      const result = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        sortOrder: "ASC",
        requestContext: requestContext(),
      });

      expectAscending(result.data.map((row) => BigInt(row.TimeUnix)));
    });

    it("accepts attribute keys with colons (valid OTel semconv)", async () => {
      await expect(
        ds.getMetrics({
          metricType: "Gauge",
          attributes: { "k8s.pod:name": "foo" },
          requestContext: requestContext(),
        })
      ).resolves.toEqual({ data: [], nextCursor: null });
    });

    it("cursor pagination does not skip rows with identical timestamps", async () => {
      const page1 = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "dup.ts.gauge",
        limit: 1,
        sortOrder: "ASC",
        requestContext: requestContext(),
      });
      expect(page1.data.length).toBe(1);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "dup.ts.gauge",
        limit: 1,
        sortOrder: "ASC",
        cursor: page1.nextCursor!,
        requestContext: requestContext(),
      });
      expect(page2.data.length).toBe(1);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "dup.ts.gauge",
        limit: 1,
        sortOrder: "ASC",
        cursor: page2.nextCursor!,
        requestContext: requestContext(),
      });
      expect(page3.data.length).toBe(1);
      expect(page3.nextCursor).toBeNull();

      const allAttrs = [page1.data[0]!, page2.data[0]!, page3.data[0]!].map(
        (r) => JSON.stringify(r.Attributes)
      );
      expect(new Set(allAttrs).size).toBe(3);
    });
  });

  describe("discoverMetrics", () => {
    it("discovers all metric names and types", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      // 5 original metrics + 1 dup-timestamp metric + 1 truncation test metric + 1 multi-attr metric
      expect(result.metrics.length).toBe(8);

      const names = result.metrics.map((m) => m.name).sort();
      expect(names).toEqual([
        "dup.ts.gauge",
        "http.server.request.count",
        "http.server.request.duration",
        "http.server.request.duration.exp",
        "rpc.server.duration.summary",
        "system.cpu.utilization",
        "test.multi.attr",
        "test.truncation.metric",
      ]);
    });

    it("returns metric type correctly", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.type).toBe("Gauge");
      expect(gauge?.unit).toBe("1");
      expect(gauge?.description).toBe("CPU utilization");
    });

    it("returns attribute keys and values", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.attributes.values).toHaveProperty("cpu");
      expect(gauge?.attributes.values["cpu"]).toContain("0");
    });

    it("returns resource attributes", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.resourceAttributes.values).toHaveProperty(
        "service.version"
      );
    });

    it("sets _truncated when attribute values exceed 100", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const metric = defined(
        result.metrics.find((m) => m.name === "test.truncation.metric"),
        "truncation metric"
      );
      // 102 distinct idx values → groupUniqArray(101) returns 101 → truncated
      expect(metric.attributes._truncated).toBe(true);
      const idxValues = defined(metric.attributes.values["idx"], "idx values");
      expect(idxValues.length).toBeLessThanOrEqual(100);
    });

    it("returns correct attribute keys for metrics with multiple attributes per row", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const metric = defined(
        result.metrics.find((m) => m.name === "test.multi.attr"),
        "multi-attr metric"
      );

      // The row has 3 attribute keys: region, env, tier
      // A correct query returns exactly 3 keys, each with 1 value.
      // The double-arrayJoin bug would produce 3*3=9 rows, inflating values.
      const attrKeys = Object.keys(metric.attributes.values).sort();
      expect(attrKeys).toEqual(["env", "region", "tier"]);
      expect(metric.attributes.values["region"]).toEqual(["us-east"]);
      expect(metric.attributes.values["env"]).toEqual(["prod"]);
      expect(metric.attributes.values["tier"]).toEqual(["premium"]);

      // Resource attribute should also be correct: 1 key with 1 value
      const resKeys = Object.keys(metric.resourceAttributes.values);
      expect(resKeys).toEqual(["cloud.provider"]);
      expect(metric.resourceAttributes.values["cloud.provider"]).toEqual([
        "aws",
      ]);
    });

    it("does not set _truncated when attribute values are within limit", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = defined(
        result.metrics.find((m) => m.name === "system.cpu.utilization"),
        "gauge metric"
      );
      // 3 distinct cpu values ("0", "1", "2") — well under 100
      expect(gauge.attributes._truncated).toBeUndefined();
    });
  });

  describe("discoverMetrics falls back without MVs", () => {
    it("returns results via full-scan when MV tables do not exist", async () => {
      // MVs haven't been created yet at this point in the suite
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      expect(result.metrics.length).toBeGreaterThan(0);
      const names = result.metrics.map((m) => m.name).sort();
      expect(names).toContain("system.cpu.utilization");
    });

    it("falls back when only names MV table exists", async () => {
      const namesOnly = `CREATE TABLE IF NOT EXISTS ${TEST_DATABASE}.otel_metrics_discover_names
(MetricName String, MetricType LowCardinality(String), MetricDescription String, MetricUnit String)
ENGINE = ReplacingMergeTree ORDER BY (MetricName, MetricType)`;
      await adminClient.command({ query: namesOnly });

      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      // Should still work via fallback
      expect(result.metrics.length).toBeGreaterThan(0);

      await adminClient.command({
        query: `DROP TABLE IF EXISTS ${TEST_DATABASE}.otel_metrics_discover_names`,
      });
    });
  });

  describe("discoverMetrics with materialized views", () => {
    beforeAll(async () => {
      const schema = getDiscoverMVSchema(TEST_DATABASE);

      // Create target tables
      for (const stmt of schema.targetTables) {
        await adminClient.command({ query: stmt });
      }

      // Create materialized views
      for (const stmt of schema.materializedViews) {
        await adminClient.command({ query: stmt });
      }

      // Backfill from existing data
      for (const stmt of schema.backfill) {
        await adminClient.command({ query: stmt });
      }
    });

    it("discovers all metric names via MV fast path", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      expect(result.metrics.length).toBe(8);

      const names = result.metrics.map((m) => m.name).sort();
      expect(names).toEqual([
        "dup.ts.gauge",
        "http.server.request.count",
        "http.server.request.duration",
        "http.server.request.duration.exp",
        "rpc.server.duration.summary",
        "system.cpu.utilization",
        "test.multi.attr",
        "test.truncation.metric",
      ]);
    });

    it("returns correct metric type via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.type).toBe("Gauge");
      expect(gauge?.unit).toBe("1");
      expect(gauge?.description).toBe("CPU utilization");
    });

    it("returns attribute keys and values via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.attributes.values).toHaveProperty("cpu");
      expect(gauge?.attributes.values["cpu"]).toContain("0");
    });

    it("returns resource attributes via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find(
        (m) => m.name === "system.cpu.utilization"
      );
      expect(gauge?.resourceAttributes.values).toHaveProperty(
        "service.version"
      );
    });

    it("sets _truncated when attribute values exceed 100 via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const metric = defined(
        result.metrics.find((m) => m.name === "test.truncation.metric"),
        "truncation metric"
      );
      expect(metric.attributes._truncated).toBe(true);
      const idxValues = defined(metric.attributes.values["idx"], "idx values");
      expect(idxValues.length).toBeLessThanOrEqual(100);
    });

    it("returns correct multi-attr keys via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const metric = defined(
        result.metrics.find((m) => m.name === "test.multi.attr"),
        "multi-attr metric"
      );

      const attrKeys = Object.keys(metric.attributes.values).sort();
      expect(attrKeys).toEqual(["env", "region", "tier"]);
      expect(metric.attributes.values["region"]).toEqual(["us-east"]);
      expect(metric.attributes.values["env"]).toEqual(["prod"]);
      expect(metric.attributes.values["tier"]).toEqual(["premium"]);

      const resKeys = Object.keys(metric.resourceAttributes.values);
      expect(resKeys).toEqual(["cloud.provider"]);
      expect(metric.resourceAttributes.values["cloud.provider"]).toEqual([
        "aws",
      ]);
    });

    it("does not set _truncated when within limit via MVs", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = defined(
        result.metrics.find((m) => m.name === "system.cpu.utilization"),
        "gauge metric"
      );
      expect(gauge.attributes._truncated).toBeUndefined();
    });
  });

  describe("getDiscoverMVSchema validation", () => {
    it("rejects database names with SQL injection", () => {
      expect(() => getDiscoverMVSchema("db; DROP TABLE x")).toThrow(
        /Invalid database name/
      );
    });

    it("rejects empty database name", () => {
      expect(() => getDiscoverMVSchema("")).toThrow(/Invalid database name/);
    });

    it("rejects database names starting with a digit", () => {
      expect(() => getDiscoverMVSchema("1bad")).toThrow(
        /Invalid database name/
      );
    });

    it("accepts valid database names", () => {
      expect(() => getDiscoverMVSchema("otel_default")).not.toThrow();
      expect(() => getDiscoverMVSchema("_private")).not.toThrow();
    });
  });

  describe("multi-tenant isolation", () => {
    it("routes traces to the correct database", async () => {
      const tenantA = await ds.getTraces({
        requestContext: requestContext(),
      });
      const tenantB = await ds.getTraces({
        requestContext: tenantBRequestContext(),
      });

      // Tenant A has 3 traces, tenant B has 1
      expect(tenantA.data.length).toBe(3);
      expect(tenantB.data.length).toBe(1);

      // No cross-contamination
      expect(tenantA.data.every((r) => r.TraceId !== "trace-b-001")).toBe(true);
      expect(firstRow(tenantB.data).TraceId).toBe("trace-b-001");
      expect(firstRow(tenantB.data).ServiceName).toBe("tenant-b-service");
    });

    it("routes logs to the correct database", async () => {
      const tenantA = await ds.getLogs({
        requestContext: requestContext(),
      });
      const tenantB = await ds.getLogs({
        requestContext: tenantBRequestContext(),
      });

      // Tenant A has 6 logs (3 original + 3 dup-timestamp), tenant B has 1
      expect(tenantA.data.length).toBe(6);
      expect(tenantB.data.length).toBe(1);

      // No cross-contamination
      expect(tenantA.data.every((r) => r.Body !== "Tenant B log message")).toBe(
        true
      );
      expect(firstRow(tenantB.data).Body).toBe("Tenant B log message");
      expect(firstRow(tenantB.data).ServiceName).toBe("tenant-b-service");
    });

    it("routes metrics to the correct database", async () => {
      const tenantA = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "system.cpu.utilization",
        requestContext: requestContext(),
      });
      const tenantB = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "tenant.b.gauge",
        requestContext: tenantBRequestContext(),
      });

      expect(tenantA.data.length).toBe(3);
      expect(tenantB.data.length).toBe(1);

      // Tenant B metric doesn't exist in tenant A
      const tenantACross = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "tenant.b.gauge",
        requestContext: requestContext(),
      });
      expect(tenantACross.data.length).toBe(0);
    });

    it("routes discoverMetrics to the correct database", async () => {
      const tenantA = await ds.discoverMetrics({
        requestContext: requestContext(),
      });
      const tenantB = await ds.discoverMetrics({
        requestContext: tenantBRequestContext(),
      });

      const tenantANames = tenantA.metrics.map((m) => m.name).sort();
      const tenantBNames = tenantB.metrics.map((m) => m.name).sort();

      // Tenant A has 8 metrics, tenant B has 1
      expect(tenantANames.length).toBe(8);
      expect(tenantBNames).toEqual(["tenant.b.gauge"]);

      // No cross-contamination
      expect(tenantANames).not.toContain("tenant.b.gauge");
      expect(tenantBNames).not.toContain("system.cpu.utilization");
    });
  });
});
