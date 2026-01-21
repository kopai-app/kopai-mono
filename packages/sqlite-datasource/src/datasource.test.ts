/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteTelemetryDatasource } from "./datasource.js";
import { otlp, type datasource } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";

describe("NodeSqliteTelemetryDatasource", () => {
  describe("writeMetrics", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.WriteTelemetryDatasource;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = new NodeSqliteTelemetryDatasource(testConnection);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("stores gauge metrics", async () => {
      // Resource
      const testServiceName = "test-service";
      const testHostName = "test-host";
      const testResourceSchemaUrl = "https://example.com/resource/v1";

      // Scope
      const testScopeName = "test-scope";
      const testScopeVersion = "1.0.0";
      const testScopeAttrKey = "scope.attr";
      const testScopeAttrVal = "val";
      const testScopeDroppedAttrCount = 2;
      const testScopeSchemaUrl = "https://example.com/scope/v1";

      // Metric
      const testMetricName = "cpu.usage";
      const testMetricDescription = "CPU usage percentage";
      const testMetricUnit = "%";

      // DataPoint
      const testDpAttrKey = "cpu";
      const testDpAttrVal = "cpu0";
      const testStartTimeUnixNano = "1000000000";
      const testTimeUnixNano = "2000000000";
      const testValue = 75.5;
      const testFlags = 1;

      // Exemplar
      const testExFilteredAttrKey = "ex.attr";
      const testExFilteredAttrVal = "ex";
      const testExTimeUnixNano = "1500000000";
      const testExValue = 74.0;
      const testExSpanId = "abcd1234";
      const testExTraceId = new Uint8Array([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        0x0d, 0x0e, 0x0f, 0x10,
      ]);

      const metricsData: datasource.MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: testServiceName },
                },
                { key: "host.name", value: { stringValue: testHostName } },
              ],
            },
            schemaUrl: testResourceSchemaUrl,
            scopeMetrics: [
              {
                scope: {
                  name: testScopeName,
                  version: testScopeVersion,
                  attributes: [
                    {
                      key: testScopeAttrKey,
                      value: { stringValue: testScopeAttrVal },
                    },
                  ],
                  droppedAttributesCount: testScopeDroppedAttrCount,
                },
                schemaUrl: testScopeSchemaUrl,
                metrics: [
                  {
                    name: testMetricName,
                    description: testMetricDescription,
                    unit: testMetricUnit,
                    gauge: {
                      dataPoints: [
                        {
                          attributes: [
                            {
                              key: testDpAttrKey,
                              value: { stringValue: testDpAttrVal },
                            },
                          ],
                          startTimeUnixNano: testStartTimeUnixNano,
                          timeUnixNano: testTimeUnixNano,
                          asDouble: testValue,
                          flags: testFlags,
                          exemplars: [
                            {
                              filteredAttributes: [
                                {
                                  key: testExFilteredAttrKey,
                                  value: { stringValue: testExFilteredAttrVal },
                                },
                              ],
                              timeUnixNano: testExTimeUnixNano,
                              asDouble: testExValue,
                              spanId: testExSpanId,
                              traceId: testExTraceId,
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await ds.writeMetrics(metricsData);

      expect(result).toEqual({
        rejectedDataPoints: "",
      });

      const rows = testConnection
        .prepare("SELECT * FROM otel_metrics_gauge")
        .all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ResourceAttributes: `{"service.name":"${testServiceName}","host.name":"${testHostName}"}`,
        ResourceSchemaUrl: testResourceSchemaUrl,
        ServiceName: testServiceName,
        ScopeName: testScopeName,
        ScopeVersion: testScopeVersion,
        ScopeAttributes: `{"${testScopeAttrKey}":"${testScopeAttrVal}"}`,
        ScopeDroppedAttrCount: testScopeDroppedAttrCount,
        ScopeSchemaUrl: testScopeSchemaUrl,
        MetricName: testMetricName,
        MetricDescription: testMetricDescription,
        MetricUnit: testMetricUnit,
        Attributes: `{"${testDpAttrKey}":"${testDpAttrVal}"}`,
        StartTimeUnix: Number(BigInt(testStartTimeUnixNano) / 1_000_000n),
        TimeUnix: Number(BigInt(testTimeUnixNano) / 1_000_000n),
        Value: testValue,
        Flags: testFlags,
        "Exemplars.FilteredAttributes": `[{"${testExFilteredAttrKey}":"${testExFilteredAttrVal}"}]`,
        "Exemplars.TimeUnix": `[${Number(BigInt(testExTimeUnixNano) / 1_000_000n)}]`,
        "Exemplars.Value": `[${testExValue}]`,
        "Exemplars.SpanId": `["${testExSpanId}"]`,
        "Exemplars.TraceId": `["${Array.from(testExTraceId)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")}"]`,
      });
    });

    it("stores sum metrics", async () => {
      const metricsData: datasource.MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "sum-service" } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "sum-scope" },
                metrics: [
                  {
                    name: "http.requests",
                    description: "Total HTTP requests",
                    unit: "1",
                    sum: {
                      dataPoints: [
                        {
                          attributes: [
                            { key: "method", value: { stringValue: "GET" } },
                          ],
                          startTimeUnixNano: "1000000000",
                          timeUnixNano: "2000000000",
                          asInt: "100",
                          flags: 0,
                          exemplars: [],
                        },
                      ],
                      aggregationTemporality:
                        otlp.AggregationTemporality
                          .AGGREGATION_TEMPORALITY_CUMULATIVE,
                      isMonotonic: true,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      await ds.writeMetrics(metricsData);

      const rows = testConnection
        .prepare("SELECT * FROM otel_metrics_sum")
        .all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ServiceName: "sum-service",
        MetricName: "http.requests",
        Value: 100,
        AggTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
        IsMonotonic: 1,
      });
    });

    it("stores histogram metrics", async () => {
      const metricsData: datasource.MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "histogram-service" },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "histogram-scope" },
                metrics: [
                  {
                    name: "http.latency",
                    description: "HTTP latency",
                    unit: "ms",
                    histogram: {
                      dataPoints: [
                        {
                          attributes: [
                            { key: "path", value: { stringValue: "/api" } },
                          ],
                          startTimeUnixNano: "1000000000",
                          timeUnixNano: "2000000000",
                          count: "10",
                          sum: 500.5,
                          bucketCounts: [1, 2, 3, 4],
                          explicitBounds: [10, 50, 100],
                          min: 5.0,
                          max: 200.0,
                          exemplars: [],
                        },
                      ],
                      aggregationTemporality:
                        otlp.AggregationTemporality
                          .AGGREGATION_TEMPORALITY_DELTA,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      await ds.writeMetrics(metricsData);

      const rows = testConnection
        .prepare("SELECT * FROM otel_metrics_histogram")
        .all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ServiceName: "histogram-service",
        MetricName: "http.latency",
        Count: 10,
        Sum: 500.5,
        BucketCounts: "[1,2,3,4]",
        ExplicitBounds: "[10,50,100]",
        Min: 5.0,
        Max: 200.0,
        AggTemporality: "AGGREGATION_TEMPORALITY_DELTA",
      });
    });

    it("stores exponential histogram metrics", async () => {
      const metricsData: datasource.MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "exphist-service" },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "exphist-scope" },
                metrics: [
                  {
                    name: "http.duration",
                    description: "HTTP duration",
                    unit: "ms",
                    exponentialHistogram: {
                      dataPoints: [
                        {
                          attributes: [],
                          startTimeUnixNano: "1000000000",
                          timeUnixNano: "2000000000",
                          count: "20",
                          sum: 1000.0,
                          scale: 3,
                          zeroCount: 2,
                          positive: {
                            offset: 1,
                            bucketCounts: ["5", "10", "3"],
                          },
                          negative: { offset: -1, bucketCounts: ["1", "1"] },
                          min: 0.1,
                          max: 100.0,
                          zeroThreshold: 0.001,
                          exemplars: [],
                        },
                      ],
                      aggregationTemporality:
                        otlp.AggregationTemporality
                          .AGGREGATION_TEMPORALITY_CUMULATIVE,
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      await ds.writeMetrics(metricsData);

      const rows = testConnection
        .prepare("SELECT * FROM otel_metrics_exponential_histogram")
        .all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ServiceName: "exphist-service",
        MetricName: "http.duration",
        Count: 20,
        Sum: 1000.0,
        Scale: 3,
        ZeroCount: 2,
        PositiveOffset: 1,
        PositiveBucketCounts: '["5","10","3"]',
        NegativeOffset: -1,
        NegativeBucketCounts: '["1","1"]',
        Min: 0.1,
        Max: 100.0,
        ZeroThreshold: 0.001,
        AggTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      });
    });

    it("stores summary metrics", async () => {
      const metricsData: datasource.MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "summary-service" },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "summary-scope" },
                metrics: [
                  {
                    name: "http.response_time",
                    description: "Response time summary",
                    unit: "ms",
                    summary: {
                      dataPoints: [
                        {
                          attributes: [],
                          startTimeUnixNano: "1000000000",
                          timeUnixNano: "2000000000",
                          count: "100",
                          sum: 5000.0,
                          quantileValues: [
                            { quantile: 0.5, value: 45.0 },
                            { quantile: 0.9, value: 90.0 },
                            { quantile: 0.99, value: 120.0 },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      await ds.writeMetrics(metricsData);

      const rows = testConnection
        .prepare("SELECT * FROM otel_metrics_summary")
        .all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ServiceName: "summary-service",
        MetricName: "http.response_time",
        Count: 100,
        Sum: 5000.0,
        "ValueAtQuantiles.Quantile": "[0.5,0.9,0.99]",
        "ValueAtQuantiles.Value": "[45,90,120]",
      });
    });
  });

  describe("writeTraces", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.WriteTelemetryDatasource;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = new NodeSqliteTelemetryDatasource(testConnection);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("stores spans with all fields", async () => {
      const testTraceId = "0102030405060708090a0b0c0d0e0f10";
      const testSpanId = "1112131415161718";
      const testParentSpanId = "2122232425262728";
      const testTraceState = "vendor=value";
      const testSpanName = "GET /api/users";
      const testServiceName = "test-service";
      const testScopeName = "test-scope";
      const testScopeVersion = "1.0.0";
      const testStartTimeUnixNano = "1704067200000000000"; // 2024-01-01 00:00:00
      const testEndTimeUnixNano = "1704067260000000000"; // 60 seconds later
      const testStatusMessage = "success";

      const tracesData: datasource.TracesData = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: testServiceName },
                },
                { key: "host.name", value: { stringValue: "test-host" } },
              ],
            },
            scopeSpans: [
              {
                scope: {
                  name: testScopeName,
                  version: testScopeVersion,
                },
                spans: [
                  {
                    traceId: testTraceId,
                    spanId: testSpanId,
                    parentSpanId: testParentSpanId,
                    traceState: testTraceState,
                    name: testSpanName,
                    kind: otlp.SpanKind.SPAN_KIND_SERVER,
                    startTimeUnixNano: testStartTimeUnixNano,
                    endTimeUnixNano: testEndTimeUnixNano,
                    status: {
                      code: otlp.StatusCode.STATUS_CODE_OK,
                      message: testStatusMessage,
                    },
                    attributes: [
                      { key: "http.method", value: { stringValue: "GET" } },
                      { key: "http.status_code", value: { intValue: 200 } },
                    ],
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: "1704067230000000000",
                        attributes: [
                          {
                            key: "exception.message",
                            value: { stringValue: "test error" },
                          },
                        ],
                      },
                    ],
                    links: [
                      {
                        traceId: "linked0102030405060708",
                        spanId: "linked11121314",
                        traceState: "linked=state",
                        attributes: [
                          { key: "link.attr", value: { stringValue: "val" } },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await ds.writeTraces(tracesData);

      expect(result).toEqual({ rejectedSpans: "" });

      const rows = testConnection.prepare("SELECT * FROM otel_traces").all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        TraceId: testTraceId,
        SpanId: testSpanId,
        ParentSpanId: testParentSpanId,
        TraceState: testTraceState,
        SpanName: testSpanName,
        SpanKind: "SPAN_KIND_SERVER",
        ServiceName: testServiceName,
        ResourceAttributes: `{"service.name":"${testServiceName}","host.name":"test-host"}`,
        ScopeName: testScopeName,
        ScopeVersion: testScopeVersion,
        SpanAttributes: '{"http.method":"GET","http.status_code":200}',
        Timestamp: Number(BigInt(testStartTimeUnixNano) / 1_000_000n),
        Duration: 60000, // 60 seconds in ms
        StatusCode: "STATUS_CODE_OK",
        StatusMessage: testStatusMessage,
        "Events.Timestamp": `[${Number(BigInt("1704067230000000000") / 1_000_000n)}]`,
        "Events.Name": '["exception"]',
        "Events.Attributes": '[{"exception.message":"test error"}]',
        "Links.TraceId": '["linked0102030405060708"]',
        "Links.SpanId": '["linked11121314"]',
        "Links.TraceState": '["linked=state"]',
        "Links.Attributes": '[{"link.attr":"val"}]',
      });
    });

    it("updates trace_id_ts lookup table", async () => {
      const testTraceId = "trace123";

      const tracesData: datasource.TracesData = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "test-service" } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-scope" },
                spans: [
                  {
                    traceId: testTraceId,
                    spanId: "span1",
                    name: "first-span",
                    startTimeUnixNano: "1000000000", // 1000ms in nanos
                    endTimeUnixNano: "2000000000",
                  },
                  {
                    traceId: testTraceId,
                    spanId: "span2",
                    name: "second-span",
                    startTimeUnixNano: "3000000000", // 3000ms in nanos
                    endTimeUnixNano: "4000000000",
                  },
                ],
              },
            ],
          },
        ],
      };

      await ds.writeTraces(tracesData);

      const lookupRows = testConnection
        .prepare("SELECT * FROM otel_traces_trace_id_ts")
        .all();
      expect(lookupRows).toHaveLength(1);

      const lookupRow = lookupRows[0] as Record<string, unknown>;
      expect(lookupRow).toMatchObject({
        TraceId: testTraceId,
        Start: 1000, // min timestamp in ms
        End: 3000, // max timestamp in ms
      });
    });

    it("merges trace_id_ts on subsequent writes", async () => {
      const testTraceId = "trace456";

      // First write
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                scope: { name: "scope" },
                spans: [
                  {
                    traceId: testTraceId,
                    spanId: "span1",
                    name: "span",
                    startTimeUnixNano: "2000000000", // 2000ms in nanos
                    endTimeUnixNano: "3000000000",
                  },
                ],
              },
            ],
          },
        ],
      });

      // Second write with earlier and later timestamps
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                scope: { name: "scope" },
                spans: [
                  {
                    traceId: testTraceId,
                    spanId: "span2",
                    name: "earlier-span",
                    startTimeUnixNano: "1000000000", // 1000ms in nanos (earlier)
                    endTimeUnixNano: "1500000000",
                  },
                  {
                    traceId: testTraceId,
                    spanId: "span3",
                    name: "later-span",
                    startTimeUnixNano: "5000000000", // 5000ms in nanos (later)
                    endTimeUnixNano: "6000000000",
                  },
                ],
              },
            ],
          },
        ],
      });

      const lookupRows = testConnection
        .prepare("SELECT * FROM otel_traces_trace_id_ts")
        .all();
      expect(lookupRows).toHaveLength(1);

      const lookupRow = lookupRows[0] as Record<string, unknown>;
      expect(lookupRow).toMatchObject({
        TraceId: testTraceId,
        Start: 1000, // min across all writes
        End: 5000, // max across all writes
      });
    });
  });

  describe("writeLogs", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.WriteTelemetryDatasource;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = new NodeSqliteTelemetryDatasource(testConnection);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("stores log records with all fields", async () => {
      const testTraceId = "0102030405060708090a0b0c0d0e0f10";
      const testSpanId = "1112131415161718";
      const testTimeUnixNano = "1704067200000000000";
      const testSeverityNumber = 9; // INFO
      const testSeverityText = "INFO";
      const testBodyString = "Test log message";
      const testServiceName = "test-service";
      const testScopeName = "test-scope";
      const testScopeVersion = "1.0.0";
      const testResourceSchemaUrl = "https://example.com/resource/v1";
      const testScopeSchemaUrl = "https://example.com/scope/v1";
      const testFlags = 1;

      const logsData: datasource.LogsData = {
        resourceLogs: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: testServiceName },
                },
                { key: "host.name", value: { stringValue: "test-host" } },
              ],
            },
            schemaUrl: testResourceSchemaUrl,
            scopeLogs: [
              {
                scope: {
                  name: testScopeName,
                  version: testScopeVersion,
                  attributes: [
                    { key: "scope.attr", value: { stringValue: "scope-val" } },
                  ],
                },
                schemaUrl: testScopeSchemaUrl,
                logRecords: [
                  {
                    timeUnixNano: testTimeUnixNano,
                    severityNumber: testSeverityNumber,
                    severityText: testSeverityText,
                    body: { stringValue: testBodyString },
                    attributes: [
                      { key: "log.attr", value: { stringValue: "attr-val" } },
                    ],
                    traceId: testTraceId,
                    spanId: testSpanId,
                    flags: testFlags,
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await ds.writeLogs(logsData);

      expect(result).toEqual({ rejectedLogRecords: "" });

      const rows = testConnection.prepare("SELECT * FROM otel_logs").all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        Timestamp: Number(BigInt(testTimeUnixNano) / 1_000_000n),
        TraceId: testTraceId,
        SpanId: testSpanId,
        TraceFlags: testFlags,
        SeverityText: testSeverityText,
        SeverityNumber: testSeverityNumber,
        Body: `"${testBodyString}"`,
        LogAttributes: '{"log.attr":"attr-val"}',
        ResourceAttributes: `{"service.name":"${testServiceName}","host.name":"test-host"}`,
        ResourceSchemaUrl: testResourceSchemaUrl,
        ServiceName: testServiceName,
        ScopeName: testScopeName,
        ScopeVersion: testScopeVersion,
        ScopeAttributes: '{"scope.attr":"scope-val"}',
        ScopeSchemaUrl: testScopeSchemaUrl,
      });
    });

    it("handles logs without optional fields", async () => {
      const logsData: datasource.LogsData = {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                scope: { name: "minimal-scope" },
                logRecords: [
                  {
                    timeUnixNano: "1000000000",
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = await ds.writeLogs(logsData);

      expect(result).toEqual({ rejectedLogRecords: "" });

      const rows = testConnection.prepare("SELECT * FROM otel_logs").all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        Timestamp: 1000,
        TraceId: "",
        SpanId: "",
        TraceFlags: 0,
        SeverityText: "",
        SeverityNumber: 0,
        Body: "null",
        LogAttributes: "{}",
        ResourceAttributes: "{}",
        ResourceSchemaUrl: "",
        ServiceName: "",
        ScopeName: "minimal-scope",
        ScopeVersion: "",
        ScopeAttributes: "{}",
        ScopeSchemaUrl: "",
      });
    });
  });

  describe("getTraces", () => {
    let testConnection: DatabaseSync;
    let ds: NodeSqliteTelemetryDatasource;

    function assertDefined<T>(
      value: T | undefined | null,
      msg = "Expected defined"
    ): asserts value is T {
      if (value === undefined || value === null) throw new Error(msg);
    }

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = new NodeSqliteTelemetryDatasource(testConnection);
    });

    afterEach(() => {
      testConnection.close();
    });

    // Helper to insert test spans
    async function insertSpan(opts: {
      traceId: string;
      spanId: string;
      serviceName?: string;
      spanName?: string;
      spanKind?: otlp.SpanKind;
      statusCode?: otlp.StatusCode;
      scopeName?: string;
      startTimeNanos: string;
      endTimeNanos: string;
      spanAttributes?: Record<string, string>;
      resourceAttributes?: Record<string, string>;
    }) {
      const resourceAttrs = [
        ...(opts.serviceName
          ? [
              {
                key: "service.name",
                value: { stringValue: opts.serviceName },
              },
            ]
          : []),
        ...Object.entries(opts.resourceAttributes ?? {}).map(
          ([key, value]) => ({
            key,
            value: { stringValue: value },
          })
        ),
      ];

      const spanAttrs = Object.entries(opts.spanAttributes ?? {}).map(
        ([key, value]) => ({
          key,
          value: { stringValue: value },
        })
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
    }

    it("returns all spans with no filters, default limit 100, DESC order", async () => {
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

      const result = await ds.getTraces({});

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // newest first
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1");
      expect(result.nextCursor).toBeNull();
    });

    it("filters by traceId", async () => {
      await insertSpan({
        traceId: "target-trace",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "other-trace",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await ds.getTraces({ traceId: "target-trace" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("target-trace");
    });

    it("filters by serviceName", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        serviceName: "target-service",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        serviceName: "other-service",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await ds.getTraces({ serviceName: "target-service" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("target-service");
    });

    it("filters by spanName, spanKind, statusCode, scopeName", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        spanName: "GET /api",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        statusCode: otlp.StatusCode.STATUS_CODE_OK,
        scopeName: "http-scope",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        spanName: "POST /api",
        spanKind: otlp.SpanKind.SPAN_KIND_CLIENT,
        statusCode: otlp.StatusCode.STATUS_CODE_ERROR,
        scopeName: "grpc-scope",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const resultBySpanName = await ds.getTraces({ spanName: "GET /api" });
      expect(resultBySpanName.data).toHaveLength(1);
      const spanNameRow = resultBySpanName.data[0];
      assertDefined(spanNameRow);
      expect(spanNameRow.SpanName).toBe("GET /api");

      const resultBySpanKind = await ds.getTraces({
        spanKind: "SPAN_KIND_SERVER",
      });
      expect(resultBySpanKind.data).toHaveLength(1);
      const spanKindRow = resultBySpanKind.data[0];
      assertDefined(spanKindRow);
      expect(spanKindRow.SpanKind).toBe("SPAN_KIND_SERVER");

      const resultByStatusCode = await ds.getTraces({
        statusCode: "STATUS_CODE_OK",
      });
      expect(resultByStatusCode.data).toHaveLength(1);
      const statusCodeRow = resultByStatusCode.data[0];
      assertDefined(statusCodeRow);
      expect(statusCodeRow.StatusCode).toBe("STATUS_CODE_OK");

      const resultByScopeName = await ds.getTraces({ scopeName: "http-scope" });
      expect(resultByScopeName.data).toHaveLength(1);
      const scopeNameRow = resultByScopeName.data[0];
      assertDefined(scopeNameRow);
      expect(scopeNameRow.ScopeName).toBe("http-scope");
    });

    it("filters by timestampMin/Max (nanos to ms conversion)", async () => {
      // Span at 1000ms (1_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      // Span at 2000ms (2_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      // Span at 3000ms (3_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      // Filter: >= 1500ms and <= 2500ms
      const result = await ds.getTraces({
        timestampMin: 1500000000000000, // 1500ms in nanos
        timestampMax: 2500000000000000, // 2500ms in nanos
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span2");
    });

    it("filters by durationMin/Max (nanos to ms conversion)", async () => {
      // Span with duration 100ms = 100_000_000 nanos
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1000000100000000", // +100ms in nanos
      });
      // Span with duration 500ms = 500_000_000 nanos
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2000000500000000", // +500ms in nanos
      });
      // Span with duration 1000ms = 1_000_000_000 nanos
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3000001000000000", // +1000ms in nanos
      });

      // Filter: >= 200ms and <= 600ms (in nanos)
      const result = await ds.getTraces({
        durationMin: 200_000_000, // 200ms in nanos
        durationMax: 600_000_000, // 600ms in nanos
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span2");
    });

    it("filters by spanAttributes using JSON extract", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { "http.method": "GET", "http.path": "/api" },
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        spanAttributes: { "http.method": "POST", "http.path": "/api" },
      });

      const result = await ds.getTraces({
        spanAttributes: { "http.method": "GET" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("filters by resourceAttributes using JSON extract", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        resourceAttributes: { env: "prod", region: "us-east" },
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        resourceAttributes: { env: "dev", region: "us-west" },
      });

      const result = await ds.getTraces({
        resourceAttributes: { env: "prod" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `trace${i}`,
          spanId: `span${i}`,
          startTimeNanos: `${1000000000000000 + i * 1000000000000}`,
          endTimeNanos: `${1001000000000000 + i * 1000000000000}`,
        });
      }

      const result = await ds.getTraces({ limit: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it("sorts ASC - oldest first", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });

      const result = await ds.getTraces({ sortOrder: "ASC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // older
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1"); // newer
    });

    it("sorts DESC - newest first (default)", async () => {
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

      const result = await ds.getTraces({ sortOrder: "DESC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // newer
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1"); // older
    });

    it("pagination with cursor continues from timestamp", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `trace${i}`,
          spanId: `span${i}`,
          startTimeNanos: `${(i + 1) * 1000000000000000}`,
          endTimeNanos: `${(i + 1) * 1000000000000000 + 1000000000000}`,
        });
      }

      // First page (DESC order)
      const page1 = await ds.getTraces({ limit: 2, sortOrder: "DESC" });
      expect(page1.data).toHaveLength(2);
      const p1r0 = page1.data[0];
      assertDefined(p1r0);
      expect(p1r0.SpanId).toBe("span4"); // newest
      const p1r1 = page1.data[1];
      assertDefined(p1r1);
      expect(p1r1.SpanId).toBe("span3");
      expect(page1.nextCursor).not.toBeNull();

      // Second page
      assertDefined(page1.nextCursor);
      const page2 = await ds.getTraces({
        limit: 2,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      const p2r0 = page2.data[0];
      assertDefined(p2r0);
      expect(p2r0.SpanId).toBe("span2");
      const p2r1 = page2.data[1];
      assertDefined(p2r1);
      expect(p2r1.SpanId).toBe("span1");
    });

    it("combines multiple filters with AND", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        serviceName: "target-service",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        serviceName: "target-service",
        spanKind: otlp.SpanKind.SPAN_KIND_CLIENT,
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        serviceName: "other-service",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const result = await ds.getTraces({
        serviceName: "target-service",
        spanKind: "SPAN_KIND_SERVER",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("returns empty result with null cursor when no matches", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });

      const result = await ds.getTraces({ traceId: "nonexistent" });

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("parses JSON fields in returned rows", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { key1: "value1" },
        resourceAttributes: { env: "prod" },
      });

      const result = await ds.getTraces({});

      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanAttributes).toEqual({ key1: "value1" });
      expect(row.ResourceAttributes).toEqual({
        env: "prod",
        "service.name": undefined,
      });
    });

    it("parses Events and Links fields as arrays", async () => {
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "test-service" } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-scope" },
                spans: [
                  {
                    traceId: "trace-with-events-links",
                    spanId: "span1",
                    name: "test-span",
                    startTimeUnixNano: "1000000000000000",
                    endTimeUnixNano: "1001000000000000",
                    events: [
                      {
                        name: "processing.start",
                        timeUnixNano: "1000000000000000",
                      },
                      {
                        name: "processing.checkpoint",
                        timeUnixNano: "1000500000000000",
                      },
                    ],
                    links: [
                      {
                        traceId: "linked-trace-id",
                        spanId: "linked-span-id",
                        traceState: "linked=state",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await ds.getTraces({ traceId: "trace-with-events-links" });

      const row = result.data[0];
      assertDefined(row);

      // Events fields should be arrays, not JSON strings
      expect(row["Events.Name"]).toEqual([
        "processing.start",
        "processing.checkpoint",
      ]);
      expect(row["Events.Timestamp"]).toEqual([1000000000, 1000500000]);

      // Links fields should be arrays, not JSON strings
      expect(row["Links.TraceId"]).toEqual(["linked-trace-id"]);
      expect(row["Links.SpanId"]).toEqual(["linked-span-id"]);
      expect(row["Links.TraceState"]).toEqual(["linked=state"]);
    });

    it("throws SqliteDatasourceQueryError on DB error", async () => {
      // Create a separate connection to close for this test
      const badConnection = initializeDatabase(":memory:");
      const badDs = new NodeSqliteTelemetryDatasource(badConnection);
      badConnection.close();

      await expect(badDs.getTraces({})).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });
});
