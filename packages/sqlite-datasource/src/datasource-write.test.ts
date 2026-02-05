/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { createOptimizedDatasource } from "./optimized-datasource.js";
import { otlp, type datasource } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";

describe("OptimizedDatasource", () => {
  describe("writeMetrics", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.WriteTelemetryDatasource;

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
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
      const testExTraceId = "0102030405060708090a0b0c0d0e0f10";

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

      const stmt = testConnection.prepare("SELECT * FROM otel_metrics_gauge");
      stmt.setReadBigInts(true);
      const rows = stmt.all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        ResourceAttributes: `{"service.name":"${testServiceName}","host.name":"${testHostName}"}`,
        ResourceSchemaUrl: testResourceSchemaUrl,
        ServiceName: testServiceName,
        ScopeName: testScopeName,
        ScopeVersion: testScopeVersion,
        ScopeAttributes: `{"${testScopeAttrKey}":"${testScopeAttrVal}"}`,
        ScopeDroppedAttrCount: BigInt(testScopeDroppedAttrCount),
        ScopeSchemaUrl: testScopeSchemaUrl,
        MetricName: testMetricName,
        MetricDescription: testMetricDescription,
        MetricUnit: testMetricUnit,
        Attributes: `{"${testDpAttrKey}":"${testDpAttrVal}"}`,
        StartTimeUnix: BigInt(testStartTimeUnixNano),
        TimeUnix: BigInt(testTimeUnixNano),
        Value: testValue,
        Flags: BigInt(testFlags),
        "Exemplars.FilteredAttributes": `[{"${testExFilteredAttrKey}":"${testExFilteredAttrVal}"}]`,
        "Exemplars.TimeUnix": `["${testExTimeUnixNano}"]`,
        "Exemplars.Value": `[${testExValue}]`,
        "Exemplars.SpanId": `["${testExSpanId}"]`,
        "Exemplars.TraceId": `["${testExTraceId}"]`,
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

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
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

      const tracesStmt = testConnection.prepare("SELECT * FROM otel_traces");
      tracesStmt.setReadBigInts(true);
      const rows = tracesStmt.all();
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
        Timestamp: BigInt(testStartTimeUnixNano),
        Duration: BigInt(testEndTimeUnixNano) - BigInt(testStartTimeUnixNano), // 60 seconds in nanos
        StatusCode: "STATUS_CODE_OK",
        StatusMessage: testStatusMessage,
        "Events.Timestamp": `["1704067230000000000"]`,
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

      const lookupStmt = testConnection.prepare(
        "SELECT * FROM otel_traces_trace_id_ts"
      );
      lookupStmt.setReadBigInts(true);
      const lookupRows = lookupStmt.all();
      expect(lookupRows).toHaveLength(1);

      const lookupRow = lookupRows[0] as Record<string, unknown>;
      expect(lookupRow).toMatchObject({
        TraceId: testTraceId,
        Start: 1000000000n, // min timestamp in nanos
        End: 3000000000n, // max timestamp in nanos
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

      const lookupStmt = testConnection.prepare(
        "SELECT * FROM otel_traces_trace_id_ts"
      );
      lookupStmt.setReadBigInts(true);
      const lookupRows = lookupStmt.all();
      expect(lookupRows).toHaveLength(1);

      const lookupRow = lookupRows[0] as Record<string, unknown>;
      expect(lookupRow).toMatchObject({
        TraceId: testTraceId,
        Start: 1000000000n, // min across all writes (nanos)
        End: 5000000000n, // max across all writes (nanos)
      });
    });
  });

  describe("writeLogs", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.WriteTelemetryDatasource;

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
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

      const logsStmt = testConnection.prepare("SELECT * FROM otel_logs");
      logsStmt.setReadBigInts(true);
      const rows = logsStmt.all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        Timestamp: BigInt(testTimeUnixNano),
        TraceId: testTraceId,
        SpanId: testSpanId,
        TraceFlags: BigInt(testFlags),
        SeverityText: testSeverityText,
        SeverityNumber: BigInt(testSeverityNumber),
        Body: testBodyString,
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

      const logsStmt = testConnection.prepare("SELECT * FROM otel_logs");
      logsStmt.setReadBigInts(true);
      const rows = logsStmt.all();
      expect(rows).toHaveLength(1);

      const row = rows[0] as Record<string, unknown>;
      expect(row).toMatchObject({
        Timestamp: 1000000000n,
        TraceId: "",
        SpanId: "",
        TraceFlags: 0n,
        SeverityText: "",
        SeverityNumber: 0n,
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
});
