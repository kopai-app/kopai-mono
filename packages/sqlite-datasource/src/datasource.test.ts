/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteTelemetryDatasource } from "./datasource.js";
import { otlp, type datasource } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";

describe("NodeSqliteTelemetryDatasource", () => {
  describe("writeMetrics", () => {
    let testConnection: DatabaseSync;
    let ds: datasource.TelemetryDatasource;

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
});
