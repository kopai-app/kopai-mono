import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  expectTypeOf,
} from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { ClickHouseReadDatasource } from "./datasource.js";
import { createOtelTables } from "./test/otel-ddl.js";
import type {
  denormalizedSignals,
  kopaiQuery as kopaiQueryNs,
} from "@kopai/core";

// ---------------------------------------------------------------------------
// Six-narrow-method test file. Mirrors datasource-query.test.ts but exercises
// the per-(signal,mode) entry points and runs inline type tests. Uses its
// own database name so it can run independently alongside the other file.
// ---------------------------------------------------------------------------

const CLICKHOUSE_HTTP_PORT = 8123;
const TEST_DATABASE = "test_q6_db";
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

// Always false at runtime, typed as boolean so the type-only branch
// remains type-checked without being flagged as unreachable code.
const NEVER_TRUE: boolean = false;

function requestContext() {
  return {
    database: TEST_DATABASE,
    username: "default",
    password: "",
  };
}

function relativeWindow() {
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
        SpanAttributes: { "http.method": "GET" },
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
        SpanAttributes: { "http.method": "POST" },
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
        Body: "Request received",
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
  const baseGauge = {
    ResourceAttributes: { "service.version": "1.0" },
    ResourceSchemaUrl: "",
    ScopeName: "otel-sdk",
    ScopeVersion: "1.0.0",
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: "",
    ServiceName: "user-service",
    MetricName: "system.cpu.utilization",
    MetricDescription: "",
    MetricUnit: "1",
    StartTimeUnix: "2024-01-01 00:00:00.000000000",
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
      {
        ...baseGauge,
        Attributes: { cpu: "0" },
        TimeUnix: "2024-01-01 00:00:01.000000000",
        Value: 0.75,
      },
      {
        ...baseGauge,
        Attributes: { cpu: "1" },
        TimeUnix: "2024-01-01 00:00:02.000000000",
        Value: 0.82,
      },
      {
        ...baseGauge,
        Attributes: { cpu: "2" },
        TimeUnix: "2024-01-01 00:00:03.000000000",
        Value: 0.6,
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
}

// ---------------------------------------------------------------------------
// queryTracesRaw
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryTracesRaw", () => {
  it("returns all spans (no filter)", async () => {
    const result = await ds.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by TraceId", async () => {
    const result = await ds.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [{ column: "TraceId", op: "eq", value: "trace-001" }],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(2);
    expect(result.data.every((r) => r.TraceId === "trace-001")).toBe(true);
  });

  it("paginates with cursor", async () => {
    const page1 = await ds.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [{ column: "TraceId", op: "eq", value: "trace-001" }],
      timeDimension: relativeWindow(),
      limit: 1,
      requestContext: requestContext(),
    });
    expect(page1.data.length).toBe(1);
    expect(page1.nextCursor).not.toBeNull();
    assertDefined(page1.nextCursor);

    const page2 = await ds.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [{ column: "TraceId", op: "eq", value: "trace-001" }],
      timeDimension: relativeWindow(),
      limit: 1,
      cursor: page1.nextCursor,
      requestContext: requestContext(),
    });
    expect(page2.data.length).toBe(1);
    expect(page2.nextCursor).toBeNull();
    const r1 = page1.data[0];
    const r2 = page2.data[0];
    assertDefined(r1);
    assertDefined(r2);
    expect(r1.SpanId).not.toBe(r2.SpanId);
  });

  it("throws without requestContext", async () => {
    await expect(
      ds.queryTracesRaw({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId"],
        timeDimension: relativeWindow(),
      })
    ).rejects.toThrow("requestContext must provide");
  });

  it("return type narrows to { data: OtelTracesRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof ds.queryTracesRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelTracesRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a LogRawQuery at compile time", () => {
    if (NEVER_TRUE) {
      const logQ: kopaiQueryNs.LogRawQuery = {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: relativeWindow(),
      };
      // @ts-expect-error LogRawQuery is not assignable to TraceRawQuery
      void ds.queryTracesRaw({ ...logQ, requestContext: requestContext() });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queryTracesAggregate
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryTracesAggregate", () => {
  it("counts spans per service", async () => {
    const result = await ds.queryTracesAggregate({
      signal: "traces",
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

  it("computes ERROR_RATE per service", async () => {
    const result = await ds.queryTracesAggregate({
      signal: "traces",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "ERROR_RATE", as: "err" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const map = new Map(
      result.data.map((r) => [String(r["service.name"]), Number(r.err)])
    );
    expect(map.get("user-service")).toBe(0);
    expect(map.get("order-service")).toBe(1);
  });

  it("return type narrows to { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof ds.queryTracesAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a TraceRawQuery at compile time", () => {
    if (NEVER_TRUE) {
      const rawQ: kopaiQueryNs.TraceRawQuery = {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: relativeWindow(),
      };
      // @ts-expect-error TraceRawQuery is not assignable to TraceAggregateQuery
      void ds.queryTracesAggregate({
        ...rawQ,
        requestContext: requestContext(),
      });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queryLogsRaw
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryLogsRaw", () => {
  it("returns all logs", async () => {
    const result = await ds.queryLogsRaw({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
  });

  it("filters by SeverityText", async () => {
    const result = await ds.queryLogsRaw({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "SeverityText"],
      filters: [{ column: "SeverityText", op: "eq", value: "ERROR" }],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SeverityText).toBe("ERROR");
  });

  it("return type narrows to { data: OtelLogsRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof ds.queryLogsRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelLogsRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a TraceRawQuery at compile time", () => {
    if (NEVER_TRUE) {
      const traceQ: kopaiQueryNs.TraceRawQuery = {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: relativeWindow(),
      };
      // @ts-expect-error TraceRawQuery is not assignable to LogRawQuery
      void ds.queryLogsRaw({ ...traceQ, requestContext: requestContext() });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queryLogsAggregate
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryLogsAggregate", () => {
  it("counts logs per service", async () => {
    const result = await ds.queryLogsAggregate({
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
    const result = await ds.queryLogsAggregate({
      signal: "logs",
      mode: "aggregate",
      dimensions: ["service.name"],
      measures: [{ op: "AVG", column: "SeverityNumber", as: "avg_sev" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    const user = result.data.find((r) => r["service.name"] === "user-service");
    assertDefined(user);
    expect(Number(user.avg_sev)).toBe(13); // avg of 9 and 17
  });

  it("return type narrows to { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof ds.queryLogsAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a MetricAggregateQuery at compile time", () => {
    if (NEVER_TRUE) {
      const metricQ: kopaiQueryNs.MetricAggregateQuery = {
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: relativeWindow(),
        output: { type: "summary" },
      };
      // @ts-expect-error MetricAggregateQuery is not assignable to LogAggregateQuery
      void ds.queryLogsAggregate({
        ...metricQ,
        requestContext: requestContext(),
      });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queryMetricsRaw
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryMetricsRaw", () => {
  it("returns Gauge rows with MetricType filter", async () => {
    const result = await ds.queryMetricsRaw({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "Value"],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: relativeWindow(),
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(3);
    const row = result.data[0];
    assertDefined(row);
    expect(row.MetricType).toBe("Gauge");
  });

  it("rejects metric query without a MetricType filter", async () => {
    await expect(
      ds.queryMetricsRaw({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName"],
        timeDimension: relativeWindow(),
        requestContext: requestContext(),
      })
    ).rejects.toThrow(/MetricType/);
  });

  it("return type narrows to { data: OtelMetricsRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof ds.queryMetricsRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelMetricsRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a LogRawQuery at compile time", () => {
    if (NEVER_TRUE) {
      const logQ: kopaiQueryNs.LogRawQuery = {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: relativeWindow(),
      };
      // @ts-expect-error LogRawQuery is not assignable to MetricRawQuery
      void ds.queryMetricsRaw({ ...logQ, requestContext: requestContext() });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// queryMetricsAggregate
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.queryMetricsAggregate", () => {
  it("sums Sum-type Value grouped by attribute", async () => {
    const result = await ds.queryMetricsAggregate({
      signal: "metrics",
      mode: "aggregate",
      dimensions: [{ container: "Attributes", key: "http.method" }],
      measures: [{ op: "SUM", column: "Value", as: "total" }],
      filters: [{ column: "MetricType", op: "eq", value: "Sum" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
      requestContext: requestContext(),
    });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row["Attributes.http.method"]).toBe("GET");
    expect(Number(row.total)).toBe(42);
  });

  it("rejects metric query without a MetricType filter", async () => {
    await expect(
      ds.queryMetricsAggregate({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "cnt" }],
        timeDimension: relativeWindow(),
        output: { type: "summary" },
        requestContext: requestContext(),
      })
    ).rejects.toThrow(/MetricType/);
  });

  it("return type narrows to { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof ds.queryMetricsAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a LogAggregateQuery at compile time", () => {
    if (NEVER_TRUE) {
      const logQ: kopaiQueryNs.LogAggregateQuery = {
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: relativeWindow(),
        output: { type: "summary" },
      };
      // @ts-expect-error LogAggregateQuery is not assignable to MetricAggregateQuery
      void ds.queryMetricsAggregate({
        ...logQ,
        requestContext: requestContext(),
      });
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-checks: existing `query()` still works post-rewire and delegates
// to the same narrow methods.
// ---------------------------------------------------------------------------
describe("ClickHouseReadDatasource.query() dispatches to the six methods", () => {
  it("traces raw via query() matches queryTracesRaw()", async () => {
    const q = {
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      timeDimension: relativeWindow(),
    } as const satisfies kopaiQueryNs.TraceRawQuery;
    const viaQuery = await ds.query({
      ...q,
      requestContext: requestContext(),
    });
    const viaNarrow = await ds.queryTracesRaw({
      ...q,
      requestContext: requestContext(),
    });
    expect(viaQuery.data.length).toBe(viaNarrow.data.length);
    expect(viaQuery.nextCursor).toBe(viaNarrow.nextCursor);
  });

  it("metrics aggregate via query() matches queryMetricsAggregate()", async () => {
    // Narrow `output` to literal summary so the conditional
    // `KopaiQueryResult<Q>` selects the summary branch.
    const q = {
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "SUM", column: "Value", as: "total" }],
      filters: [{ column: "MetricType", op: "eq", value: "Sum" }],
      timeDimension: relativeWindow(),
      output: { type: "summary" },
    } as const satisfies kopaiQueryNs.MetricAggregateQuery;
    const viaQuery = await ds.query({
      ...q,
      requestContext: requestContext(),
    });
    const viaNarrow = await ds.queryMetricsAggregate({
      ...q,
      requestContext: requestContext(),
    });
    expect(viaQuery.data).toEqual(viaNarrow.data);
  });

  it("logs raw via query() matches queryLogsRaw()", async () => {
    const q = {
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "Body"],
      timeDimension: relativeWindow(),
    } as const satisfies kopaiQueryNs.LogRawQuery;
    const viaQuery = await ds.query({
      ...q,
      requestContext: requestContext(),
    });
    const viaNarrow = await ds.queryLogsRaw({
      ...q,
      requestContext: requestContext(),
    });
    expect(viaQuery.data.length).toBe(viaNarrow.data.length);
    expect(viaQuery.nextCursor).toBe(viaNarrow.nextCursor);
  });
});
