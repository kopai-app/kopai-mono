/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { expectTypeOf } from "vitest";
import {
  OptimizedDatasource,
  createOptimizedDatasource,
} from "./optimized-datasource.js";
import {
  otlp,
  type datasource,
  type denormalizedSignals,
  type kopaiQuery as kopaiQueryNs,
} from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";

function assertDefined<T>(
  value: T | undefined | null,
  msg = "Expected defined"
): asserts value is T {
  if (value === undefined || value === null) throw new Error(msg);
}

const WIDE_WINDOW = {
  type: "absolute" as const,
  startTime: "1970-01-01T00:00:00.000Z",
  endTime: "2200-01-01T00:00:00.000Z",
};

// ============================================================
// queryTracesRaw
// ============================================================
describe("OptimizedDatasource.queryTracesRaw", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertSpan: ReturnType<typeof createInsertSpan>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertSpan = createInsertSpan(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("returns all spans with default DESC order", async () => {
    await insertSpan({
      traceId: "trace1",
      spanId: "span1",
      startTimeNanos: "1000000000000000",
      endTimeNanos: "1001000000000000",
    });
    await insertSpan({
      traceId: "trace2",
      spanId: "span2",
      startTimeNanos: "2000000000000000",
      endTimeNanos: "2001000000000000",
    });

    const result = await readDs.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      timeDimension: WIDE_WINDOW,
    });

    expect(result.data).toHaveLength(2);
    const row0 = result.data[0];
    assertDefined(row0);
    expect(row0.SpanId).toBe("span2");
    expect(result.nextCursor).toBeNull();
  });

  it("filters by TraceId and returns nextCursor when paginating", async () => {
    for (let i = 0; i < 3; i++) {
      await insertSpan({
        traceId: "target",
        spanId: `span${String(i)}`,
        startTimeNanos: `${String((i + 1) * 1_000_000_000_000_000)}`,
        endTimeNanos: `${String((i + 1) * 1_000_000_000_000_000 + 1_000_000_000)}`,
      });
    }

    const result = await readDs.queryTracesRaw({
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      filters: [{ column: "TraceId", op: "eq", value: "target" }],
      timeDimension: WIDE_WINDOW,
      limit: 2,
    });

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("return type is { data: OtelTracesRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryTracesRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelTracesRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a LogRawQuery at compile time", () => {
    if (false as boolean) {
      const logQ: kopaiQueryNs.LogRawQuery = {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: WIDE_WINDOW,
      };
      // @ts-expect-error LogRawQuery is not assignable to TraceRawQuery
      void readDs.queryTracesRaw(logQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// queryTracesAggregate
// ============================================================
describe("OptimizedDatasource.queryTracesAggregate", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertSpan: ReturnType<typeof createInsertSpan>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertSpan = createInsertSpan(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("computes COUNT and ERROR_RATE per trace", async () => {
    await insertSpan({
      traceId: "trace1",
      spanId: "s1",
      startTimeNanos: "1000000000000000",
      endTimeNanos: "1000000500000000",
    });
    await insertSpan({
      traceId: "trace1",
      spanId: "s2",
      statusCode: otlp.StatusCode.STATUS_CODE_ERROR,
      startTimeNanos: "1000000100000000",
      endTimeNanos: "1000000400000000",
    });

    const result = await readDs.queryTracesAggregate({
      signal: "traces",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "cnt" },
        { op: "ERROR_RATE", as: "err_rate" },
      ],
      dimensions: ["TraceId"],
      timeDimension: WIDE_WINDOW,
      output: { type: "summary" },
    });

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.TraceId).toBe("trace1");
    expect(row.cnt).toBe(2);
    expect(row.err_rate).toBeCloseTo(0.5);
  });

  it("supports timeSeries output", async () => {
    const startNs = BigInt(Date.parse("2024-01-01T00:00:00.000Z")) * 1_000_000n;
    await insertSpan({
      traceId: "t1",
      spanId: "s1",
      startTimeNanos: (startNs + 60_000_000_000n).toString(),
      endTimeNanos: (startNs + 61_000_000_000n).toString(),
    });

    const result = await readDs.queryTracesAggregate({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "cnt" }],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T01:00:00.000Z",
      },
      output: { type: "timeSeries", granularity: "1h" },
    });

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    assertDefined(row);
    expect(typeof row.bucket_start).toBe("string");
    expect(row.cnt).toBe(1);
  });

  it("return type is { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryTracesAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a TraceRawQuery at compile time", () => {
    if (false as boolean) {
      const rawQ: kopaiQueryNs.TraceRawQuery = {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: WIDE_WINDOW,
      };
      // @ts-expect-error TraceRawQuery is not assignable to TraceAggregateQuery
      void readDs.queryTracesAggregate(rawQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// queryLogsRaw
// ============================================================
describe("OptimizedDatasource.queryLogsRaw", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertLog: ReturnType<typeof createInsertLog>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertLog = createInsertLog(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("returns logs DESC by default", async () => {
    await insertLog({ timeNanos: "1000000000000000" });
    await insertLog({ timeNanos: "2000000000000000" });

    const result = await readDs.queryLogsRaw({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp"],
      timeDimension: WIDE_WINDOW,
    });

    expect(result.data).toHaveLength(2);
    const row0 = result.data[0];
    assertDefined(row0);
    expect(row0.Timestamp).toBe("2000000000000000");
    expect(result.nextCursor).toBeNull();
  });

  it("filters by SeverityText", async () => {
    await insertLog({ timeNanos: "1000000000000000", severityText: "INFO" });
    await insertLog({ timeNanos: "2000000000000000", severityText: "ERROR" });

    const result = await readDs.queryLogsRaw({
      signal: "logs",
      mode: "raw",
      dimensions: ["Timestamp", "SeverityText"],
      filters: [{ column: "SeverityText", op: "eq", value: "ERROR" }],
      timeDimension: WIDE_WINDOW,
    });

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SeverityText).toBe("ERROR");
  });

  it("return type is { data: OtelLogsRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryLogsRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelLogsRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a TraceRawQuery at compile time", () => {
    if (false as boolean) {
      const traceQ: kopaiQueryNs.TraceRawQuery = {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: WIDE_WINDOW,
      };
      // @ts-expect-error TraceRawQuery is not assignable to LogRawQuery
      void readDs.queryLogsRaw(traceQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// queryLogsAggregate
// ============================================================
describe("OptimizedDatasource.queryLogsAggregate", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertLog: ReturnType<typeof createInsertLog>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertLog = createInsertLog(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("counts logs grouped by SeverityText", async () => {
    await insertLog({ timeNanos: "1000000000000000", severityText: "ERROR" });
    await insertLog({ timeNanos: "2000000000000000", severityText: "ERROR" });
    await insertLog({ timeNanos: "3000000000000000", severityText: "INFO" });

    const result = await readDs.queryLogsAggregate({
      signal: "logs",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "cnt" }],
      dimensions: ["SeverityText"],
      timeDimension: WIDE_WINDOW,
      output: { type: "summary" },
      orderBy: [{ type: "measure", alias: "cnt", direction: "desc" }],
    });

    expect(result.data).toHaveLength(2);
    const row0 = result.data[0];
    assertDefined(row0);
    expect(row0.SeverityText).toBe("ERROR");
    expect(row0.cnt).toBe(2);
  });

  it("supports COUNT_DISTINCT on attribute", async () => {
    await insertLog({
      timeNanos: "1000000000000000",
      logAttributes: { "request.id": "a" },
    });
    await insertLog({
      timeNanos: "2000000000000000",
      logAttributes: { "request.id": "b" },
    });
    await insertLog({
      timeNanos: "3000000000000000",
      logAttributes: { "request.id": "a" },
    });

    const result = await readDs.queryLogsAggregate({
      signal: "logs",
      mode: "aggregate",
      measures: [
        {
          op: "COUNT_DISTINCT",
          column: { container: "LogAttributes", key: "request.id" },
          as: "distinct_reqs",
        },
      ],
      timeDimension: WIDE_WINDOW,
      output: { type: "summary" },
    });

    const row = result.data[0];
    assertDefined(row);
    expect(row.distinct_reqs).toBe(2);
  });

  it("return type is { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryLogsAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a MetricAggregateQuery at compile time", () => {
    if (false as boolean) {
      const metricQ: kopaiQueryNs.MetricAggregateQuery = {
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      };
      // @ts-expect-error MetricAggregateQuery is not assignable to LogAggregateQuery
      void readDs.queryLogsAggregate(metricQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// queryMetricsRaw
// ============================================================
describe("OptimizedDatasource.queryMetricsRaw", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertGauge: ReturnType<typeof createInsertGauge>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertGauge = createInsertGauge(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("returns Gauge rows with MetricType filter", async () => {
    await insertGauge({
      metricName: "cpu.usage",
      timeUnixNano: "1000000000000000",
      value: 0.75,
    });

    const result = await readDs.queryMetricsRaw({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName", "MetricType", "Value"],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: WIDE_WINDOW,
    });

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.MetricType).toBe("Gauge");
    expect(row.MetricName).toBe("cpu.usage");
  });

  it("rejects metric query without MetricType filter", async () => {
    await expect(
      readDs.queryMetricsRaw({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName"],
        timeDimension: WIDE_WINDOW,
      })
    ).rejects.toThrow();
  });

  it("return type is { data: OtelMetricsRow[]; nextCursor: string | null }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryMetricsRaw>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: denormalizedSignals.OtelMetricsRow[];
      nextCursor: string | null;
    }>();
  });

  it("rejects a LogRawQuery at compile time", () => {
    if (false as boolean) {
      const logQ: kopaiQueryNs.LogRawQuery = {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: WIDE_WINDOW,
      };
      // @ts-expect-error LogRawQuery is not assignable to MetricRawQuery
      void readDs.queryMetricsRaw(logQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// queryMetricsAggregate
// ============================================================
describe("OptimizedDatasource.queryMetricsAggregate", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertGauge: ReturnType<typeof createInsertGauge>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertGauge = createInsertGauge(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("aggregates AVG/MIN/MAX/COUNT over Gauges", async () => {
    await insertGauge({
      metricName: "cpu.usage",
      timeUnixNano: "1000000000000000",
      value: 0.1,
    });
    await insertGauge({
      metricName: "cpu.usage",
      timeUnixNano: "2000000000000000",
      value: 0.5,
    });
    await insertGauge({
      metricName: "cpu.usage",
      timeUnixNano: "3000000000000000",
      value: 0.9,
    });

    const result = await readDs.queryMetricsAggregate({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        { op: "AVG", column: "Value", as: "avg_v" },
        { op: "MIN", column: "Value", as: "min_v" },
        { op: "MAX", column: "Value", as: "max_v" },
        { op: "COUNT", as: "cnt" },
      ],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: WIDE_WINDOW,
      output: { type: "summary" },
    });

    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.avg_v).toBeCloseTo(0.5);
    expect(row.min_v).toBe(0.1);
    expect(row.max_v).toBe(0.9);
    expect(row.cnt).toBe(3);
  });

  it("rejects metric query without MetricType filter", async () => {
    await expect(
      readDs.queryMetricsAggregate({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "cnt" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      })
    ).rejects.toThrow(/MetricType/);
  });

  it("return type is { data: KopaiAggregateRow[] }", () => {
    type R = Awaited<ReturnType<typeof readDs.queryMetricsAggregate>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: kopaiQueryNs.KopaiAggregateRow[];
    }>();
  });

  it("rejects a LogAggregateQuery at compile time", () => {
    if (false as boolean) {
      const logQ: kopaiQueryNs.LogAggregateQuery = {
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      };
      // @ts-expect-error LogAggregateQuery is not assignable to MetricAggregateQuery
      void readDs.queryMetricsAggregate(logQ);
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Cross-checks: existing `query()` still works and delegates correctly.
// ============================================================
describe("query() still dispatches correctly post-rewire", () => {
  let testConnection: DatabaseSync;
  let ds: OptimizedDatasource;
  let readDs: datasource.ReadTelemetryDatasource;
  let insertSpan: ReturnType<typeof createInsertSpan>;
  let insertGauge: ReturnType<typeof createInsertGauge>;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = createOptimizedDatasource(testConnection);
    readDs = ds;
    insertSpan = createInsertSpan(ds);
    insertGauge = createInsertGauge(ds);
  });

  afterEach(() => {
    testConnection.close();
  });

  it("traces raw via query() matches queryTracesRaw()", async () => {
    await insertSpan({
      traceId: "t1",
      spanId: "s1",
      startTimeNanos: "1000000000000000",
      endTimeNanos: "1001000000000000",
    });

    const q: kopaiQueryNs.TraceRawQuery = {
      signal: "traces",
      mode: "raw",
      dimensions: ["TraceId", "SpanId"],
      timeDimension: WIDE_WINDOW,
    };
    const viaQuery = await readDs.query(q);
    const viaNarrow = await readDs.queryTracesRaw(q);
    expect(viaQuery.data.length).toBe(viaNarrow.data.length);
    expect(viaQuery.nextCursor).toBe(viaNarrow.nextCursor);
  });

  it("metrics aggregate via query() matches queryMetricsAggregate()", async () => {
    await insertGauge({
      metricName: "cpu.usage",
      timeUnixNano: "1000000000000000",
      value: 0.5,
    });

    // Narrow `output` to the literal summary shape so the conditional
    // `KopaiQueryResult<Q>` selects the summary branch (it requires a
    // single-literal extends-check; MetricAggregateQuery alone keeps the
    // output union open).
    const q = {
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "AVG", column: "Value", as: "avg_v" }],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: WIDE_WINDOW,
      output: { type: "summary" },
    } as const satisfies kopaiQueryNs.MetricAggregateQuery;
    const viaQuery = await readDs.query(q);
    const viaNarrow = await readDs.queryMetricsAggregate(q);
    expect(viaQuery.data).toEqual(viaNarrow.data);
  });
});

// ============================================================
// Fixtures — copied from datasource-query.test.ts
// ============================================================

function createInsertSpan(
  ds: Pick<datasource.WriteTracesDatasource, "writeTraces">
) {
  return async (opts: {
    traceId: string;
    spanId: string;
    serviceName?: string;
    spanName?: string;
    spanKind?: otlp.SpanKind;
    statusCode?: otlp.StatusCode;
    scopeName?: string;
    startTimeNanos: string;
    endTimeNanos: string;
    parentSpanId?: string;
    spanAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const spanAttrs = Object.entries(opts.spanAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeTraces({
      resourceSpans: [
        {
          resource: { attributes: resourceAttrs },
          scopeSpans: [
            {
              scope: { name: opts.scopeName ?? "test-scope" },
              spans: [
                {
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  parentSpanId: opts.parentSpanId,
                  name: opts.spanName ?? "test-span",
                  kind: opts.spanKind,
                  startTimeUnixNano: opts.startTimeNanos,
                  endTimeUnixNano: opts.endTimeNanos,
                  status: opts.statusCode
                    ? { code: opts.statusCode }
                    : undefined,
                  attributes: spanAttrs,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertLog(
  ds: Pick<datasource.WriteLogsDatasource, "writeLogs">
) {
  return async (opts: {
    timeNanos: string;
    traceId?: string;
    spanId?: string;
    serviceName?: string;
    scopeName?: string;
    severityText?: string;
    severityNumber?: number;
    body?: string;
    logAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const logAttrs = Object.entries(opts.logAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeLogs({
      resourceLogs: [
        {
          resource: { attributes: resourceAttrs },
          scopeLogs: [
            {
              scope: { name: opts.scopeName ?? "test-scope" },
              logRecords: [
                {
                  timeUnixNano: opts.timeNanos,
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  severityText: opts.severityText,
                  severityNumber: opts.severityNumber,
                  body: opts.body ? { stringValue: opts.body } : undefined,
                  attributes: logAttrs,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertGauge(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    value: number;
    serviceName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];
    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}
