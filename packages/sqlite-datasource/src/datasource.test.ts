/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteTelemetryDatasource } from "./datasource.js";
import type { TelemetryDatasource, MetricsData } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";

describe("NodeSqliteTelemetryDatasource", () => {
  describe("writeMetrics", () => {
    let testConnection: DatabaseSync;
    let datasource: TelemetryDatasource;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      datasource = new NodeSqliteTelemetryDatasource(testConnection);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("should store MetricsData to sqlite", async () => {
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

      const metricsData: MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: testServiceName } },
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
                    { key: testScopeAttrKey, value: { stringValue: testScopeAttrVal } },
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
                            { key: testDpAttrKey, value: { stringValue: testDpAttrVal } },
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

      await datasource.writeMetrics(metricsData);

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
        "Exemplars.TraceId": `["${Array.from(testExTraceId).map((b) => b.toString(16).padStart(2, "0")).join("")}"]`,
      });
    });
  });
});
