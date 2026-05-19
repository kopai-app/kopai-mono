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

// ---------------------------------------------------------------------------
// Testcontainers + schema setup is duplicated (subset) from datasource.test.ts
// so this file can run independently. Tests focus on the new `query()` API.
// ---------------------------------------------------------------------------

const CLICKHOUSE_HTTP_PORT = 8123;
const TEST_DATABASE = "test_q_db";
const CONTAINER_STARTUP_TIMEOUT = 60_000;

let container: StartedTestContainer;
let adminClient: ClickHouseClient;
let ds: ClickHouseReadDatasource;
let baseUrl: string;

const dirname = path.dirname(fileURLToPath(import.meta.url));

function requestContext() {
  return {
    database: TEST_DATABASE,
    username: "default",
    password: "",
  };
}

function relativeWindow(_lookback = "1w") {
  // Test data is seeded with 2024-01-01 timestamps; a relative window from
  // "now" won't cover it on most days. Use an absolute window that brackets
  // 2024 broadly.
  return {
    type: "absolute" as const,
    startTime: "2020-01-01T00:00:00.000Z",
    endTime: "2030-01-01T00:00:00.000Z",
  };
}

function makeSpan(
  overrides: Partial<Record<string, unknown>> & {
    Timestamp: string;
    TraceId: string;
    SpanId: string;
    SpanName: string;
    ServiceName: string;
  }
) {
  return {
    ParentSpanId: "",
    TraceState: "",
    SpanKind: "SERVER",
    ResourceAttributes: {},
    ScopeName: "",
    ScopeVersion: "",
    SpanAttributes: {},
    Duration: 1000000,
    StatusCode: "OK",
    StatusMessage: "",
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.TraceState": [],
    "Links.Attributes": [],
    ...overrides,
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
  await seedTraces(dbClient);
  await seedLogs(dbClient);
  await seedMetrics(dbClient);
  await dbClient.close();

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

async function seedTraces(client: ClickHouseClient) {
  await client.insert({
    table: "otel_traces",
    values: [
      makeSpan({
        Timestamp: "2024-01-01 00:00:01.000000000",
        TraceId: "trace-001",
        SpanId: "span-001",
        SpanName: "GET /api/users",
        ServiceName: "user-service",
        ResourceAttributes: { "service.version": "1.0" },
        SpanAttributes: { "http.method": "GET", "http.status_code": "200" },
        Duration: 5000000,
      }),
      makeSpan({
        Timestamp: "2024-01-01 00:00:02.000000000",
        TraceId: "trace-001",
        SpanId: "span-002",
        ParentSpanId: "span-001",
        SpanName: "DB query",
        SpanKind: "CLIENT",
        ServiceName: "user-service",
        ResourceAttributes: { "service.version": "1.0" },
        SpanAttributes: { "db.system": "postgresql" },
        Duration: 2000000,
      }),
      makeSpan({
        Timestamp: "2024-01-01 00:00:03.000000000",
        TraceId: "trace-002",
        SpanId: "span-003",
        SpanName: "POST /api/orders",
        ServiceName: "order-service",
        ResourceAttributes: { "service.version": "2.0" },
        SpanAttributes: { "http.method": "POST", "http.status_code": "500" },
        Duration: 15000000,
        StatusCode: "STATUS_CODE_ERROR",
        StatusMessage: "Internal server error",
      }),
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
        EventName: "db.connection.error",
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

async function seedMetrics(client: ClickHouseClient) {
  await client.insert({
    table: "otel_metrics_gauge",
    values: [
      gaugeRow("system.cpu.utilization", { cpu: "0" }, 0.75, "00:00:01"),
      gaugeRow("system.cpu.utilization", { cpu: "1" }, 0.82, "00:00:02"),
      gaugeRow("system.cpu.utilization", { cpu: "2" }, 0.6, "00:00:03"),
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

function gaugeRow(
  metricName: string,
  attrs: Record<string, string>,
  value: number,
  hms: string
) {
  return {
    ResourceAttributes: { "service.version": "1.0" },
    ResourceSchemaUrl: "",
    ScopeName: "otel-sdk",
    ScopeVersion: "1.0.0",
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: "",
    ServiceName: "user-service",
    MetricName: metricName,
    MetricDescription: "",
    MetricUnit: "1",
    Attributes: attrs,
    StartTimeUnix: "2024-01-01 00:00:00.000000000",
    TimeUnix: `2024-01-01 ${hms}.000000000`,
    Value: value,
    Flags: 0,
    "Exemplars.FilteredAttributes": [],
    "Exemplars.TimeUnix": [],
    "Exemplars.Value": [],
    "Exemplars.SpanId": [],
    "Exemplars.TraceId": [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClickHouseReadDatasource.query — traces raw", () => {
  it("returns all spans with no extra filters", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by traceId", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        { kind: "string", column: "TraceId", op: "eq", value: "trace-001" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(2);
    expect(result.data.every((r) => r.TraceId === "trace-001")).toBe(true);
  });

  it("filters by serviceName via service.name semconv", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        {
          kind: "string",
          column: "service.name",
          op: "eq",
          value: "order-service",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.ServiceName).toBe("order-service");
  });

  it("filters by SpanName", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      filters: [
        { kind: "string", column: "SpanName", op: "eq", value: "DB query" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.SpanId).toBe("span-002");
  });

  it("filters by span attribute via container", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      filters: [
        {
          kind: "string",
          column: { container: "SpanAttributes", key: "http.method" },
          op: "eq",
          value: "POST",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.SpanName).toBe("POST /api/orders");
  });

  it("returns timestamps as nanosecond strings", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        { kind: "string", column: "SpanId", op: "eq", value: "span-001" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.Timestamp).toBe("1704067201000000000");
  });

  it("supports cursor pagination", async () => {
    const page1 = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        { kind: "string", column: "TraceId", op: "eq", value: "trace-001" },
      ],
      timeDimension: relativeWindow(),
      limit: 1,
      requestContext: requestContext(),
    });
    expect(page1.data.length).toBe(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        { kind: "string", column: "TraceId", op: "eq", value: "trace-001" },
      ],
      timeDimension: relativeWindow(),
      limit: 1,
      cursor: page1.nextCursor!,
      requestContext: requestContext(),
    });
    expect(page2.data.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    expect(page1.data[0]!.SpanId).not.toBe(page2.data[0]!.SpanId);
  });

  it("returns empty result for no matches", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId"],
      filters: [
        { kind: "string", column: "TraceId", op: "eq", value: "nonexistent" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("throws without requestContext", async () => {
    await expect(
      ds.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId"],
        timeDimension: relativeWindow(),
      })
    ).rejects.toThrow("requestContext must provide");
  });
});

describe("ClickHouseReadDatasource.query — logs raw", () => {
  it("returns all logs with no extra filters", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "service.name"],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
  });

  it("filters by service.name", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "service.name"],
      filters: [
        {
          kind: "string",
          column: "service.name",
          op: "eq",
          value: "order-service",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.Body).toBe("Slow query detected");
  });

  it("filters by Body contains (ILIKE)", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      filters: [
        { kind: "string", column: "Body", op: "contains", value: "database" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.Body).toBe("Database connection failed");
  });

  it("filters by SeverityNumber >= 13", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "SeverityNumber"],
      filters: [
        { kind: "number", column: "SeverityNumber", op: "gte", value: 13 },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(2);
    expect(result.data.every((r) => (r.SeverityNumber ?? 0) >= 13)).toBe(true);
  });

  it("filters by log.level (severity) semconv", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "EventName"],
      filters: [
        {
          kind: "string",
          column: "EventName",
          op: "eq",
          value: "db.connection.error",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.Body).toBe("Database connection failed");
  });
});

describe("ClickHouseReadDatasource.query — metrics raw", () => {
  it("queries Gauge metrics", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    expect(result.data[0]!.MetricType).toBe("Gauge");
  });

  it("queries Sum metrics", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Sum" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const m = result.data[0]!;
    expect(m.MetricType).toBe("Sum");
    if (m.MetricType === "Sum") {
      expect(m.Value).toBe(42);
      expect(m.IsMonotonic).toBe(1);
    }
  });

  it("queries Histogram metrics", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Count"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Histogram" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const m = result.data[0]!;
    expect(m.MetricType).toBe("Histogram");
    if (m.MetricType === "Histogram") {
      expect(m.Count).toBe(10);
      expect(m.BucketCounts).toEqual([1, 3, 5, 1]);
    }
  });

  it("queries ExponentialHistogram", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName"],
      filters: [
        {
          kind: "string",
          column: "MetricType",
          op: "eq",
          value: "ExponentialHistogram",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.MetricType).toBe("ExponentialHistogram");
  });

  it("queries Summary metrics", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Count"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Summary" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const m = result.data[0]!;
    expect(m.MetricType).toBe("Summary");
    if (m.MetricType === "Summary") {
      expect(m.Count).toBe(100);
    }
  });

  it("throws when MetricType filter missing", async () => {
    await expect(
      ds.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName"],
        timeDimension: relativeWindow(),
        requestContext: requestContext(),
      })
    ).rejects.toThrow(/MetricType/);
  });
});

describe("ClickHouseReadDatasource.query — traces aggregate", () => {
  it("counts spans per service", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "COUNT", as: "span_count" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const map = new Map(
      result.data.map((r) => [String(r["service.name"]), Number(r.span_count)])
    );
    expect(map.get("user-service")).toBe(2);
    expect(map.get("order-service")).toBe(1);
  });

  it("computes ERROR_RATE per service", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "ERROR_RATE", as: "err_rate" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const map = new Map(
      result.data.map((r) => [String(r["service.name"]), Number(r.err_rate)])
    );
    expect(map.get("user-service")).toBe(0);
    expect(map.get("order-service")).toBe(1);
  });

  it("ERROR_RATE > 0 when spans with STATUS_CODE_ERROR exist (literal regression)", async () => {
    // Regression guard: the SQL literal must match the writer's stored
    // StatusCode value ('STATUS_CODE_ERROR'). The seed inserts one span
    // with that status — the rate over the matched span set must be
    // strictly positive. Previous bug used 'ERROR' and produced 0.
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "ERROR_RATE", as: "rate" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(Number(result.data[0]!.rate)).toBeGreaterThan(0);
  });

  it("computes AVG/MAX/MIN duration", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [
        { op: "AVG", column: "Duration", as: "avg_d" },
        { op: "MAX", column: "Duration", as: "max_d" },
        { op: "MIN", column: "Duration", as: "min_d" },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const user = result.data.find((r) => r["service.name"] === "user-service")!;
    expect(Number(user.max_d)).toBe(5000000);
    expect(Number(user.min_d)).toBe(2000000);
    expect(Number(user.avg_d)).toBe(3500000);
  });

  it("filters with stringIn", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "COUNT", as: "n" }],
      filters: [
        {
          kind: "stringIn",
          column: "service.name",
          op: "in",
          values: ["order-service"],
        },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!["service.name"]).toBe("order-service");
    expect(Number(result.data[0]!.n)).toBe(1);
  });
});

describe("ClickHouseReadDatasource.query — logs aggregate", () => {
  it("counts log rows per service", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const map = new Map(
      result.data.map((r) => [String(r["service.name"]), Number(r.n)])
    );
    expect(map.get("user-service")).toBe(2);
    expect(map.get("order-service")).toBe(1);
  });

  it("avg SeverityNumber per service", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "AVG", column: "SeverityNumber", as: "avg_sev" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const user = result.data.find((r) => r["service.name"] === "user-service")!;
    expect(Number(user.avg_sev)).toBe(13); // avg of 9 and 17
  });
});

describe("ClickHouseReadDatasource.query — metrics aggregate", () => {
  it("sums Sum-type metric Value with group by attribute", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      dimensions: [{ container: "Attributes", key: "http.method" }],
      measures: [{ op: "SUM", column: "Value", as: "total" }],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Sum" },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!["Attributes.http.method"]).toBe("GET");
    expect(Number(result.data[0]!.total)).toBe(42);
  });

  it("avg/max/min Gauge value across attribute groups", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        { op: "AVG", column: "Value", as: "avg_v" },
        { op: "MAX", column: "Value", as: "max_v" },
        { op: "MIN", column: "Value", as: "min_v" },
      ],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(Number(result.data[0]!.max_v)).toBeCloseTo(0.82, 5);
    expect(Number(result.data[0]!.min_v)).toBeCloseTo(0.6, 5);
  });

  it("counts with no group by — single-row result", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(Number(result.data[0]!.n)).toBe(3);
  });

  it("HAVING filters groups by aggregated value", async () => {
    // 3 Gauge points across 3 distinct cpu values; having cnt > 2 should
    // include the overall aggregate (no group-by gives one row with cnt=3)
    // when grouped only by MetricName (single 'system.cpu.utilization').
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "cnt" }],
      dimensions: ["MetricName"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      havings: [{ measure: "cnt", op: "gte", value: 3 }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.MetricName).toBe("system.cpu.utilization");
    expect(Number(result.data[0]!.cnt)).toBe(3);
  });

  it("orderBy by measure alias sorts rows by the aggregated value", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "AVG", column: "Value", as: "avg_v" }],
      dimensions: [{ container: "Attributes", key: "cpu" }],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      orderBy: [{ type: "measure", alias: "avg_v", direction: "desc" }],
      requestContext: requestContext(),
    });
    // cpu values: 0→0.75, 1→0.82, 2→0.6. Desc → 1, 0, 2.
    const cpus = result.data.map((r) => String(r["Attributes.cpu"]));
    expect(cpus).toEqual(["1", "0", "2"]);
  });

  it("COUNT_DISTINCT uses HLL (uniq) — returns approx-but-exact for small N", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        {
          op: "COUNT_DISTINCT",
          column: { container: "Attributes", key: "cpu" },
          as: "n_cpus",
        },
      ],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    // HLL is exact at N=3 in practice for ClickHouse `uniq`.
    expect(Number(result.data[0]!.n_cpus)).toBe(3);
  });

  it("percentile measures (P50/P95/P999) return quantile values", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        { op: "P50", column: "Value", as: "p50" },
        { op: "P95", column: "Value", as: "p95" },
        { op: "P999", column: "Value", as: "p999" },
      ],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const row = result.data[0]!;
    // Values [0.6, 0.75, 0.82]. P50 should land on 0.75, P95+ near max.
    expect(Number(row.p50)).toBeCloseTo(0.75, 1);
    expect(Number(row.p95)).toBeGreaterThanOrEqual(0.75);
    expect(Number(row.p95)).toBeLessThanOrEqual(0.82);
    expect(Number(row.p999)).toBeLessThanOrEqual(0.82);
  });

  it("RATE_AVG / RATE_SUM / RATE_MAX divide by window seconds (summary mode)", async () => {
    // Tight absolute window so the denominator is easy to compute.
    const window = {
      type: "absolute" as const,
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-01T00:00:10.000Z",
    };
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        { op: "RATE_AVG", column: "Value", as: "ravg" },
        { op: "RATE_SUM", column: "Value", as: "rsum" },
        { op: "RATE_MAX", column: "Value", as: "rmax" },
      ],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: window,
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const row = result.data[0]!;
    // Values: 0.6, 0.75, 0.82 over 10s window.
    // avg=0.7233, sum=2.17, max=0.82 → /10
    expect(Number(row.ravg)).toBeCloseTo(0.0723, 3);
    expect(Number(row.rsum)).toBeCloseTo(0.217, 3);
    expect(Number(row.rmax)).toBeCloseTo(0.082, 3);
  });

  it("timeSeries output buckets by granularity with ISO bucket_start", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "cnt" }],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "MetricName",
          op: "eq",
          value: "system.cpu.utilization",
        },
      ],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T00:00:10.000Z",
      },
      output: { type: "timeSeries", granularity: "1s" },
      requestContext: requestContext(),
    });
    // 3 gauge points at 00:00:01, 00:00:02, 00:00:03 → 3 buckets at 1s.
    expect(result.data.length).toBe(3);
    for (const r of result.data) {
      const bs = r.bucket_start;
      expect(typeof bs).toBe("string");
      expect(Number.isNaN(Date.parse(String(bs)))).toBe(false);
      expect(Number(r.cnt)).toBe(1);
    }
  });
});

describe("ClickHouseReadDatasource.query — trace THROUGHPUT", () => {
  it("THROUGHPUT divides span count by window seconds (summary mode)", async () => {
    const window = {
      type: "absolute" as const,
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-01T00:00:10.000Z",
    };
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "THROUGHPUT", as: "tps" }],
      timeDimension: window,
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    // 3 spans in 10s window → 0.3 spans/sec.
    expect(Number(result.data[0]!.tps)).toBeCloseTo(0.3, 3);
  });
});

describe("ClickHouseReadDatasource.query — validation", () => {
  it("rejects metric query without a MetricType filter", async () => {
    await expect(
      ds.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "cnt" }],
        timeDimension: relativeWindow(),
        output: { type: "summary" },
        requestContext: requestContext(),
      })
    ).rejects.toThrow(/MetricType/);
  });

  it("rejects metric query where MetricType is buried inside an OR branch", async () => {
    await expect(
      ds.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "cnt" }],
        filters: [
          {
            kind: "logical",
            op: "or",
            filters: [
              {
                kind: "string",
                column: "MetricType",
                op: "eq",
                value: "Gauge",
              },
              { kind: "string", column: "MetricType", op: "eq", value: "Sum" },
            ],
          },
        ],
        timeDimension: relativeWindow(),
        output: { type: "summary" },
        requestContext: requestContext(),
      })
    ).rejects.toThrow(/MetricType.*OR|OR.*MetricType|ambiguous/i);
  });
});

describe("ClickHouseReadDatasource.query — trace summary (aggregate scalars)", () => {
  it("computes per-trace scalars matching legacy getTraceSummaries", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["TraceId"],
      measures: [
        { op: "COUNT", as: "spanCount" },
        { op: "MAX", column: "Duration", as: "maxDuration" },
      ],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const t1 = result.data.find((r) => r.TraceId === "trace-001");
    expect(t1).toBeDefined();
    expect(Number(t1!.spanCount)).toBe(2);
    expect(Number(t1!.maxDuration)).toBe(5000000);

    const t2 = result.data.find((r) => r.TraceId === "trace-002");
    expect(t2).toBeDefined();
    expect(Number(t2!.spanCount)).toBe(1);
  });
});
