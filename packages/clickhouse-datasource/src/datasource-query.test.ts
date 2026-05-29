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
import { createOtelTables } from "./test/otel-ddl.js";

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

function assertDefined<T>(
  value: T | undefined | null,
  msg = "Expected defined"
): asserts value is T {
  if (value === undefined || value === null) throw new Error(msg);
}

function firstRow<T>(arr: T[], msg = "Expected at least one row"): T {
  const first = arr[0];
  assertDefined(first, msg);
  return first;
}

function findRow<T>(
  arr: T[],
  pred: (row: T) => boolean,
  msg = "No matching row"
): T {
  const found = arr.find(pred);
  assertDefined(found, msg);
  return found;
}

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
        // Non-empty ScopeName so the ScopeName-filter parity test (old
        // searchLogs.scopeName) has a unique value to match.
        ScopeName: "auth-scope",
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
    expect(firstRow(result.data).ServiceName).toBe("order-service");
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
    expect(firstRow(result.data).SpanId).toBe("span-002");
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
    expect(firstRow(result.data).SpanName).toBe("POST /api/orders");
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
    expect(firstRow(result.data).Timestamp).toBe("1704067201000000000");
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
    assertDefined(page1.nextCursor);

    const page2 = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        { kind: "string", column: "TraceId", op: "eq", value: "trace-001" },
      ],
      timeDimension: relativeWindow(),
      limit: 1,
      cursor: page1.nextCursor,
      requestContext: requestContext(),
    });
    expect(page2.data.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    expect(firstRow(page1.data).SpanId).not.toBe(firstRow(page2.data).SpanId);
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

  // Parity with old `searchTraces` filters: ParentSpanId, StatusCode,
  // SpanKind, Duration range. None of these were exercised before.

  it("filters by ParentSpanId (old searchTraces.parentSpanId parity)", async () => {
    // Seed has span-002 with ParentSpanId="span-001". Match only it.
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId", "ParentSpanId"],
      filters: [
        {
          kind: "string",
          column: "ParentSpanId",
          op: "eq",
          value: "span-001",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanId).toBe("span-002");
  });

  it("filters by StatusCode (old searchTraces.statusCode parity)", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId", "StatusCode"],
      filters: [
        {
          kind: "string",
          column: "StatusCode",
          op: "eq",
          value: "STATUS_CODE_ERROR",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanId).toBe("span-003");
  });

  it("filters by SpanKind (old searchTraces.spanKind parity)", async () => {
    // span-002 ('DB query') is CLIENT in the seed; the other two default
    // to SERVER. Filter must discriminate.
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId", "SpanKind"],
      filters: [
        { kind: "string", column: "SpanKind", op: "eq", value: "CLIENT" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanId).toBe("span-002");
  });

  it("filters by Duration range (old searchTraces.durationMin/Max parity)", async () => {
    // Seed durations: span-001=5e6, span-002=2e6, span-003=15e6 ns.
    // Match only spans in [3e6, 10e6] → span-001.
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId", "Duration"],
      filters: [
        { kind: "number", column: "Duration", op: "gte", value: 3000000 },
        { kind: "number", column: "Duration", op: "lte", value: 10000000 },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanId).toBe("span-001");
  });

  it("filters by ResourceAttributes container (old searchTraces.resourceAttributes parity)", async () => {
    // user-service spans have service.version=1.0; order-service is 2.0.
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [
        {
          kind: "string",
          column: { container: "ResourceAttributes", key: "service.version" },
          op: "eq",
          value: "2.0",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanId).toBe("span-003");
  });

  it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
    const result = await ds.query({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId", "Timestamp"],
      timeDimension: relativeWindow(),
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    expect(result.data.map((r) => r.SpanId)).toEqual([
      "span-001",
      "span-002",
      "span-003",
    ]);
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
    expect(firstRow(result.data).Body).toBe("Slow query detected");
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
    expect(firstRow(result.data).Body).toBe("Database connection failed");
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
    expect(firstRow(result.data).Body).toBe("Database connection failed");
  });

  // Parity with old `searchLogs` capabilities that lacked tests:
  // pagination, ASC sortOrder, SeverityText, ResourceAttributes,
  // ScopeName, and an explicit case-insensitive Body.contains.

  it("respects limit + returns next cursor for pagination (old searchLogsPage parity)", async () => {
    const page1 = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      timeDimension: relativeWindow(),
      limit: 2,
      requestContext: requestContext(),
    });
    expect(page1.data.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    assertDefined(page1.nextCursor);

    const page2 = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      timeDimension: relativeWindow(),
      limit: 2,
      cursor: page1.nextCursor,
      requestContext: requestContext(),
    });
    expect(page2.data.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    // Pages must not overlap AND must together cover all 3 seeded logs.
    // Asserting only no-overlap would miss a "cursor skips a row" bug.
    const page2Row = page2.data[0];
    assertDefined(page2Row);
    const union = new Set([...page1.data.map((r) => r.Body), page2Row.Body]);
    expect(union.size).toBe(3);
  });

  it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "SeverityText"],
      timeDimension: relativeWindow(),
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    expect(result.data.map((r) => r.SeverityText)).toEqual([
      "INFO",
      "ERROR",
      "WARN",
    ]);
  });

  it("filters by SeverityText exact match (old searchLogs.severityText parity)", async () => {
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "SeverityText"],
      filters: [
        { kind: "string", column: "SeverityText", op: "eq", value: "ERROR" },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SeverityText).toBe("ERROR");
    expect(row.Body).toBe("Database connection failed");
  });

  it("filters by ResourceAttributes container (old searchLogs.resourceAttributes parity)", async () => {
    // Seed: 2 logs have service.version=1.0 (the user-service ones), 1
    // log has no resource attrs. Filter must match exactly those 2.
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      filters: [
        {
          kind: "string",
          column: { container: "ResourceAttributes", key: "service.version" },
          op: "eq",
          value: "1.0",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(2);
  });

  it("filters by ScopeName structural column (old searchLogs.scopeName parity)", async () => {
    // Log #1 in the seed has ScopeName="auth-scope"; the others empty.
    const result = await ds.query({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "ScopeName"],
      filters: [
        {
          kind: "string",
          column: "ScopeName",
          op: "eq",
          value: "auth-scope",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.ScopeName).toBe("auth-scope");
  });

  it("body contains is case-insensitive (explicit parity with old SDK bodyContains ILIKE)", async () => {
    // Old SDK `searchLogs.bodyContains` compiled to ILIKE. The new
    // `contains` op compiles to ILIKE here. Lowercase needle against
    // capitalized body must still match — the prior test exercised this
    // implicitly; this assertion makes the guarantee explicit.
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
    const row = result.data[0];
    assertDefined(row);
    expect(row.Body).toBe("Database connection failed");
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
    expect(firstRow(result.data).MetricType).toBe("Gauge");
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
    const m = firstRow(result.data);
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
    const m = firstRow(result.data);
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
    expect(firstRow(result.data).MetricType).toBe("ExponentialHistogram");
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
    const m = firstRow(result.data);
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

  // Parity with old `searchMetrics` filters that lacked tests:
  // pagination, ASC sortOrder, MetricName discrimination, Attributes /
  // service.name / ResourceAttributes filters in raw mode.

  it("respects limit + returns next cursor for pagination (old searchMetricsPage parity)", async () => {
    // Gauge seed has 3 cpu rows.
    const page1 = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      timeDimension: relativeWindow(),
      limit: 2,
      requestContext: requestContext(),
    });
    expect(page1.data.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    assertDefined(page1.nextCursor);

    const page2 = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      timeDimension: relativeWindow(),
      limit: 2,
      cursor: page1.nextCursor,
      requestContext: requestContext(),
    });
    expect(page2.data.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    // Pages must cover all 3 gauge rows (seed: cpu 0/1/2). Discriminator
    // is Value since each row has a unique gauge reading (0.75/0.82/0.6).
    const page2Row = page2.data[0];
    assertDefined(page2Row);
    const union = new Set<number>();
    for (const r of page1.data) {
      if (r.MetricType === "Gauge") union.add(r.Value);
    }
    if (page2Row.MetricType === "Gauge") union.add(page2Row.Value);
    expect(union.size).toBe(3);
  });

  it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "TimeUnix", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      timeDimension: relativeWindow(),
      orderBy: [{ type: "dimension", column: "TimeUnix", direction: "asc" }],
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    // Gauge seed: cpu 0 @00:00:01 → 0.75, cpu 1 @00:00:02 → 0.82, cpu 2 @00:00:03 → 0.6
    const values = result.data.map((r) => {
      if (r.MetricType !== "Gauge") throw new Error("expected Gauge");
      return r.Value;
    });
    expect(values).toEqual([0.75, 0.82, 0.6]);
  });

  it("filters by MetricName discriminates non-matching rows (old searchMetrics.metricName parity)", async () => {
    // Stronger than the existing test: assert the filter EXCLUDES rows
    // whose MetricName doesn't match.
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
          value: "nonexistent.metric",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(0);
  });

  it("filters by Attributes container (old searchMetrics.attributes parity)", async () => {
    // Gauge seed has 3 cpu rows with Attributes {cpu: "0"|"1"|"2"}.
    const result = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: { container: "Attributes", key: "cpu" },
          op: "eq",
          value: "1",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const m = result.data[0];
    assertDefined(m);
    if (m.MetricType !== "Gauge") throw new Error("expected Gauge");
    expect(m.Value).toBeCloseTo(0.82, 5);
  });

  it("filters by service.name (old searchMetrics.serviceName parity)", async () => {
    // All metrics in the seed are user-service. Match must return >0 for
    // the existing service and 0 for a different one.
    const matching = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: "service.name",
          op: "eq",
          value: "user-service",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(matching.data.length).toBe(3);

    const nonMatching = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
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
    expect(nonMatching.data.length).toBe(0);
  });

  it("filters by ResourceAttributes container (old searchMetrics.resourceAttributes parity)", async () => {
    // Gauges have service.version=1.0 in their resource attributes.
    const matching = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: { container: "ResourceAttributes", key: "service.version" },
          op: "eq",
          value: "1.0",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(matching.data.length).toBe(3);

    const nonMatching = await ds.query({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
        {
          kind: "string",
          column: { container: "ResourceAttributes", key: "service.version" },
          op: "eq",
          value: "9.9",
        },
      ],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(nonMatching.data.length).toBe(0);
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
    expect(Number(firstRow(result.data).rate)).toBeGreaterThan(0);
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
    const user = findRow(
      result.data,
      (r) => r["service.name"] === "user-service"
    );
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
    expect(firstRow(result.data)["service.name"]).toBe("order-service");
    expect(Number(firstRow(result.data).n)).toBe(1);
  });

  it("lists distinct ServiceName values — equivalent to old SDK getServices()", async () => {
    // Old SDK `getServices()` → { services: string[] } is reproducible
    // as a KopaiQuery aggregate over traces grouping by service.name.
    // Demonstrates that getServices is fully replaceable.
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });

    const services = result.data
      .map((r) => r["service.name"])
      .filter((v): v is string => typeof v === "string")
      .sort();
    expect(services).toEqual(["order-service", "user-service"]);
  });

  it("lists distinct SpanName values for a service — equivalent to old SDK getOperations(serviceName)", async () => {
    // Old SDK `getOperations(serviceName)` → { operations: string[] }
    // is reproducible as a KopaiQuery aggregate grouping by SpanName
    // with a service.name filter. Demonstrates that getOperations is
    // fully replaceable.
    const result = await ds.query({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["SpanName"],
      filters: [
        {
          kind: "string",
          column: "service.name",
          op: "eq",
          value: "user-service",
        },
      ],
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });

    const operations = result.data
      .map((r) => r.SpanName)
      .filter((v): v is string => typeof v === "string")
      .sort();
    expect(operations).toEqual(["DB query", "GET /api/users"]);
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
    const user = findRow(
      result.data,
      (r) => r["service.name"] === "user-service"
    );
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
    expect(firstRow(result.data)["Attributes.http.method"]).toBe("GET");
    expect(Number(firstRow(result.data).total)).toBe(42);
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
    expect(Number(firstRow(result.data).max_v)).toBeCloseTo(0.82, 5);
    expect(Number(firstRow(result.data).min_v)).toBeCloseTo(0.6, 5);
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
    expect(Number(firstRow(result.data).n)).toBe(3);
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
    expect(firstRow(result.data).MetricName).toBe("system.cpu.utilization");
    expect(Number(firstRow(result.data).cnt)).toBe(3);
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
    expect(Number(firstRow(result.data).n_cpus)).toBe(3);
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
    const row = firstRow(result.data);
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
    const row = firstRow(result.data);
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
    // bucket_start must be canonical ISO-8601 UTC (matching the SQLite
    // backend exactly), not ClickHouse's space-separated DateTime64 form.
    expect(result.data.length).toBe(3);
    const buckets = result.data.map((r) => r.bucket_start).sort();
    expect(buckets).toEqual([
      "2024-01-01T00:00:01.000Z",
      "2024-01-01T00:00:02.000Z",
      "2024-01-01T00:00:03.000Z",
    ]);
    for (const r of result.data) {
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
    expect(Number(firstRow(result.data).tps)).toBeCloseTo(0.3, 3);
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
            or: [
              { column: "MetricType", op: "eq", value: "Gauge" },
              { column: "MetricType", op: "eq", value: "Sum" },
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
    const t1 = findRow(result.data, (r) => r.TraceId === "trace-001");
    expect(Number(t1.spanCount)).toBe(2);
    expect(Number(t1.maxDuration)).toBe(5000000);

    const t2 = findRow(result.data, (r) => r.TraceId === "trace-002");
    expect(Number(t2.spanCount)).toBe(1);
  });
});
