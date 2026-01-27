/// <reference types="vitest/globals" />
import fastify, { type FastifyInstance } from "fastify";
import { collectorRoutes } from "./index.js";
import {
  decodeTracesRequest,
  decodeMetricsRequest,
  decodeLogsRequest,
  encodeTracesResponse,
  encodeMetricsResponse,
  encodeLogsResponse,
  protobufPlugin,
  PROTOBUF_CONTENT_TYPE as PROTOBUF_CT,
} from "./protobuf/index.js";
import { fromBinary, toBinary, create } from "@bufbuild/protobuf";
import {
  ExportTraceServiceRequestSchema,
  ExportTraceServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import {
  ExportMetricsServiceRequestSchema,
  ExportMetricsServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import {
  ExportLogsServiceRequestSchema,
  ExportLogsServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import { Span_SpanKind } from "./gen/opentelemetry/proto/trace/v1/trace_pb.js";
import { SeverityNumber } from "./gen/opentelemetry/proto/logs/v1/logs_pb.js";
import {
  AggregationTemporality,
  type Metric,
} from "./gen/opentelemetry/proto/metrics/v1/metrics_pb.js";

const PROTOBUF_CONTENT_TYPE = "application/x-protobuf";

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

describe("collectorRoutes with protobuf", () => {
  describe("POST /v1/traces with application/x-protobuf", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("accepts protobuf and returns protobuf response", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      // Create a protobuf request
      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: {
                    value: { case: "stringValue", value: "test-service" },
                  },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-instrumentation" },
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: {
          "content-type": PROTOBUF_CONTENT_TYPE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(PROTOBUF_CONTENT_TYPE);

      // Decode the protobuf response
      const responseBody = fromBinary(
        ExportTraceServiceResponseSchema,
        new Uint8Array(response.rawPayload)
      );

      expect(responseBody.partialSuccess?.rejectedSpans).toBe(0n);

      // Verify the datasource was called with converted data
      expect(writeTracesSpy).toHaveBeenCalledTimes(1);
      const calledWith = writeTracesSpy.mock.calls[0]![0];

      // Verify traceId and spanId were converted to hex strings
      expect(
        calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.traceId
      ).toBe("0123456789abcdef0123456789abcdef");
      expect(
        calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.spanId
      ).toBe("0123456789abcdef");
    });

    it("converts span events and links correctly", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");
      const linkedTraceId = hexToBytes("fedcba9876543210fedcba9876543210");
      const linkedSpanId = hexToBytes("fedcba9876543210");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                    events: [
                      {
                        name: "exception",
                        timeUnixNano: 1704067230000000000n,
                        attributes: [
                          {
                            key: "exception.message",
                            value: {
                              value: { case: "stringValue", value: "error" },
                            },
                          },
                        ],
                      },
                    ],
                    links: [
                      {
                        traceId: linkedTraceId,
                        spanId: linkedSpanId,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: {
          "content-type": PROTOBUF_CONTENT_TYPE,
        },
      });

      expect(response.statusCode).toBe(200);

      const calledWith = writeTracesSpy.mock.calls[0]![0];
      const span = calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];

      // Verify event timestamp is converted
      expect(span.events[0].timeUnixNano).toBe("1704067230000000000");

      // Verify link traceId/spanId are converted to hex
      expect(span.links[0].traceId).toBe("fedcba9876543210fedcba9876543210");
      expect(span.links[0].spanId).toBe("fedcba9876543210");
    });
  });

  describe("POST /v1/metrics with application/x-protobuf", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("accepts protobuf and returns protobuf response", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: {
                    value: { case: "stringValue", value: "test-service" },
                  },
                },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "test-instrumentation" },
                metrics: [
                  {
                    name: "http.requests.total",
                    description: "Total HTTP requests",
                    unit: "1",
                    data: {
                      case: "sum",
                      value: {
                        dataPoints: [
                          {
                            startTimeUnixNano: 1704067200000000000n,
                            timeUnixNano: 1704067260000000000n,
                            value: { case: "asInt", value: 1500n },
                          },
                        ],
                        aggregationTemporality:
                          AggregationTemporality.CUMULATIVE,
                        isMonotonic: true,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: {
          "content-type": PROTOBUF_CONTENT_TYPE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(PROTOBUF_CONTENT_TYPE);

      // Decode the protobuf response
      const responseBody = fromBinary(
        ExportMetricsServiceResponseSchema,
        new Uint8Array(response.rawPayload)
      );

      expect(responseBody.partialSuccess?.rejectedDataPoints).toBe(0n);

      // Verify the datasource was called
      expect(writeMetricsSpy).toHaveBeenCalledTimes(1);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];

      // Verify timestamps are converted to strings
      const dataPoint =
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.sum
          ?.dataPoints?.[0];
      expect(dataPoint.startTimeUnixNano).toBe("1704067200000000000");
      expect(dataPoint.timeUnixNano).toBe("1704067260000000000");
      expect(dataPoint.asInt).toBe("1500");
    });

    it("handles gauge metrics", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "cpu.usage",
                    data: {
                      case: "gauge",
                      value: {
                        dataPoints: [
                          {
                            timeUnixNano: 1704067260000000000n,
                            value: { case: "asDouble", value: 0.75 },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];
      expect(
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.gauge
      ).toBeDefined();
    });

    it("handles histogram metrics", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "http.request.duration",
                    data: {
                      case: "histogram",
                      value: {
                        dataPoints: [
                          {
                            timeUnixNano: 1704067260000000000n,
                            count: 100n,
                            sum: 5.5,
                            bucketCounts: [10n, 20n, 30n, 40n],
                            explicitBounds: [0.1, 0.5, 1.0],
                          },
                        ],
                        aggregationTemporality:
                          AggregationTemporality.CUMULATIVE,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];
      const histogram =
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]
          ?.histogram;
      expect(histogram).toBeDefined();
      expect(histogram.dataPoints[0].count).toBe("100");
      expect(histogram.dataPoints[0].bucketCounts).toEqual([10, 20, 30, 40]);
    });

    it("handles exponentialHistogram metrics", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "http.request.duration.exp",
                    data: {
                      case: "exponentialHistogram",
                      value: {
                        dataPoints: [
                          {
                            timeUnixNano: 1704067260000000000n,
                            count: 50n,
                            sum: 2.5,
                            scale: 2,
                            zeroCount: 5n,
                            positive: {
                              offset: 1,
                              bucketCounts: [5n, 10n, 15n],
                            },
                            negative: {
                              offset: 0,
                              bucketCounts: [3n, 7n],
                            },
                          },
                        ],
                        aggregationTemporality:
                          AggregationTemporality.CUMULATIVE,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];
      const expHist =
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]
          ?.exponentialHistogram;
      expect(expHist).toBeDefined();
      expect(expHist.dataPoints[0].scale).toBe(2);
      expect(expHist.dataPoints[0].positive.bucketCounts).toEqual([5, 10, 15]);
    });

    it("handles summary metrics", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "http.request.duration.summary",
                    data: {
                      case: "summary",
                      value: {
                        dataPoints: [
                          {
                            timeUnixNano: 1704067260000000000n,
                            count: 200n,
                            sum: 10.0,
                            quantileValues: [
                              { quantile: 0.5, value: 0.05 },
                              { quantile: 0.99, value: 0.1 },
                            ],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];
      const summary =
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]
          ?.summary;
      expect(summary).toBeDefined();
      expect(summary.dataPoints[0].quantileValues).toHaveLength(2);
    });

    it("handles metric with no data (default case)", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      // Create metric with just name/description/unit, no data field
      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "empty.metric",
                    description: "A metric with no data",
                    unit: "1",
                    // data is undefined - triggers default case
                  } as Metric,
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeMetricsSpy.mock.calls[0]![0];
      const metric =
        calledWith.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0];
      expect(metric.name).toBe("empty.metric");
      // Should have no sum/gauge/histogram/etc fields
      expect(metric.sum).toBeUndefined();
      expect(metric.gauge).toBeUndefined();
    });
  });

  describe("POST /v1/logs with application/x-protobuf", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("accepts protobuf and returns protobuf response", async () => {
      const writeLogsSpy = vi.fn().mockResolvedValue({
        rejectedLogRecords: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: vi.fn(),
          writeLogs: writeLogsSpy,
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: {
                    value: { case: "stringValue", value: "test-service" },
                  },
                },
              ],
            },
            scopeLogs: [
              {
                scope: { name: "test-instrumentation" },
                logRecords: [
                  {
                    timeUnixNano: 1704067200000000000n,
                    observedTimeUnixNano: 1704067200000000000n,
                    severityNumber: SeverityNumber.INFO,
                    severityText: "INFO",
                    body: {
                      value: { case: "stringValue", value: "Test log message" },
                    },
                    traceId,
                    spanId,
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportLogsServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/logs",
        payload: Buffer.from(payload),
        headers: {
          "content-type": PROTOBUF_CONTENT_TYPE,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(PROTOBUF_CONTENT_TYPE);

      // Decode the protobuf response
      const responseBody = fromBinary(
        ExportLogsServiceResponseSchema,
        new Uint8Array(response.rawPayload)
      );

      expect(responseBody.partialSuccess?.rejectedLogRecords).toBe(0n);

      // Verify the datasource was called
      expect(writeLogsSpy).toHaveBeenCalledTimes(1);
      const calledWith = writeLogsSpy.mock.calls[0]![0];

      // Verify traceId and spanId were converted to hex strings
      const logRecord =
        calledWith.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0];
      expect(logRecord.traceId).toBe("0123456789abcdef0123456789abcdef");
      expect(logRecord.spanId).toBe("0123456789abcdef");
      expect(logRecord.timeUnixNano).toBe("1704067200000000000");
      expect(logRecord.severityNumber).toBe(9); // INFO
    });
  });

  describe("AnyValue types", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("converts doubleValue, boolValue attributes", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "double.attr",
                  value: {
                    value: { case: "doubleValue", value: 3.14 },
                  },
                },
                {
                  key: "bool.attr",
                  value: {
                    value: { case: "boolValue", value: true },
                  },
                },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeTracesSpy.mock.calls[0]![0];
      const attrs = calledWith.resourceSpans?.[0]?.resource?.attributes;

      expect(attrs?.[0]?.value?.doubleValue).toBe(3.14);
      expect(attrs?.[1]?.value?.boolValue).toBe(true);
    });

    it("converts bytesValue, arrayValue, kvlistValue attributes", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "bytes.attr",
                  value: {
                    value: {
                      case: "bytesValue",
                      value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
                    },
                  },
                },
                {
                  key: "array.attr",
                  value: {
                    value: {
                      case: "arrayValue",
                      value: {
                        values: [
                          { value: { case: "stringValue", value: "item1" } },
                          { value: { case: "intValue", value: 42n } },
                        ],
                      },
                    },
                  },
                },
                {
                  key: "kvlist.attr",
                  value: {
                    value: {
                      case: "kvlistValue",
                      value: {
                        values: [
                          {
                            key: "nested.key",
                            value: {
                              value: { case: "stringValue", value: "nested" },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeTracesSpy.mock.calls[0]![0];
      const attrs = calledWith.resourceSpans?.[0]?.resource?.attributes;

      // bytesValue converted to hex
      expect(attrs?.[0]?.value?.bytesValue).toBe("deadbeef");
      // arrayValue with nested values
      expect(attrs?.[1]?.value?.arrayValue?.values).toHaveLength(2);
      expect(attrs?.[1]?.value?.arrayValue?.values?.[0]?.stringValue).toBe(
        "item1"
      );
      // kvlistValue with nested key-value
      expect(attrs?.[2]?.value?.kvlistValue?.values?.[0]?.key).toBe(
        "nested.key"
      );
    });
  });

  describe("span with status", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("converts span status correctly", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                    status: {
                      code: 2, // ERROR
                      message: "Something went wrong",
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeTracesSpy.mock.calls[0]![0];
      const span = calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];

      expect(span.status.code).toBe(2);
      expect(span.status.message).toBe("Something went wrong");
    });
  });

  describe("metrics with exemplars (direct converter test)", () => {
    it("decodeMetricsRequest converts exemplars correctly", () => {
      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "http.requests.count",
                    data: {
                      case: "sum",
                      value: {
                        dataPoints: [
                          {
                            timeUnixNano: 1704067260000000000n,
                            value: { case: "asInt", value: 100n },
                            exemplars: [
                              {
                                timeUnixNano: 1704067250000000000n,
                                traceId,
                                spanId,
                                value: { case: "asDouble", value: 0.5 },
                                filteredAttributes: [
                                  {
                                    key: "http.method",
                                    value: {
                                      value: {
                                        case: "stringValue",
                                        value: "GET",
                                      },
                                    },
                                  },
                                ],
                              },
                              {
                                timeUnixNano: 1704067251000000000n,
                                value: { case: "asInt", value: 42n },
                                // no traceId/spanId to test empty branches
                              },
                            ],
                          },
                        ],
                        aggregationTemporality:
                          AggregationTemporality.CUMULATIVE,
                        isMonotonic: true,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportMetricsServiceRequestSchema, request);
      const result = decodeMetricsRequest(new Uint8Array(payload));

      const dataPoint =
        result.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.sum
          ?.dataPoints?.[0];

      expect(dataPoint?.exemplars).toHaveLength(2);
      // First exemplar with traceId/spanId
      expect(dataPoint?.exemplars?.[0]?.traceId).toBe(
        "0123456789abcdef0123456789abcdef"
      );
      expect(dataPoint?.exemplars?.[0]?.spanId).toBe("0123456789abcdef");
      expect(dataPoint?.exemplars?.[0]?.asDouble).toBe(0.5);
      expect(dataPoint?.exemplars?.[0]?.filteredAttributes).toHaveLength(1);
      // Second exemplar without traceId/spanId
      expect(dataPoint?.exemplars?.[1]?.asInt).toBe("42");
      expect(dataPoint?.exemplars?.[1]?.traceId).toBeUndefined();
    });
  });

  describe("empty fields branch coverage", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("handles span with empty attributes, no events, no links", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            resource: {
              attributes: [], // empty attributes
            },
            scopeSpans: [
              {
                scope: { name: "" }, // empty scope name
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "minimal-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                    attributes: [], // empty span attributes
                    events: [], // no events
                    links: [], // no links
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      expect(response.statusCode).toBe(200);
      const calledWith = writeTracesSpy.mock.calls[0]![0];
      const span = calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];

      // Empty arrays should become undefined
      expect(
        calledWith.resourceSpans?.[0]?.resource?.attributes
      ).toBeUndefined();
      expect(span.attributes).toBeUndefined();
      expect(span.events).toBeUndefined();
      expect(span.links).toBeUndefined();
      // Empty scope name should become undefined
      expect(
        calledWith.resourceSpans?.[0]?.scopeSpans?.[0]?.scope?.name
      ).toBeUndefined();
    });
  });

  describe("error handling", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("returns 404 for non-existent protobuf endpoint", async () => {
      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: vi.fn(),
          writeLogs: vi.fn(),
        },
      });

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [],
      });
      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const response = await server.inject({
        method: "POST",
        url: "/v1/unknown",
        payload: Buffer.from(payload),
        headers: { "content-type": PROTOBUF_CONTENT_TYPE },
      });

      // Non-existent route returns 404
      expect(response.statusCode).toBe(404);
    });
  });

  describe("index.ts re-exports", () => {
    it("exports all expected symbols", () => {
      // Verify all exports from index.ts are accessible
      expect(decodeTracesRequest).toBeDefined();
      expect(decodeMetricsRequest).toBeDefined();
      expect(decodeLogsRequest).toBeDefined();
      expect(encodeTracesResponse).toBeDefined();
      expect(encodeMetricsResponse).toBeDefined();
      expect(encodeLogsResponse).toBeDefined();
      expect(protobufPlugin).toBeDefined();
      expect(PROTOBUF_CT).toBe("application/x-protobuf");
    });

    it("encodeTracesResponse returns Uint8Array", () => {
      const result = encodeTracesResponse({ rejectedSpans: "0" });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("encodeMetricsResponse returns Uint8Array", () => {
      const result = encodeMetricsResponse({ rejectedDataPoints: "0" });
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("encodeLogsResponse returns Uint8Array", () => {
      const result = encodeLogsResponse({ rejectedLogRecords: "0" });
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe("converter unit tests", () => {
    it("decodeTracesRequest can be called directly", () => {
      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [],
      });
      const payload = toBinary(ExportTraceServiceRequestSchema, request);

      const result = decodeTracesRequest(new Uint8Array(payload));
      expect(result.resourceSpans).toEqual([]);
    });

    it("decodeMetricsRequest can be called directly", () => {
      const request = create(ExportMetricsServiceRequestSchema, {
        resourceMetrics: [],
      });
      const payload = toBinary(ExportMetricsServiceRequestSchema, request);

      const result = decodeMetricsRequest(new Uint8Array(payload));
      expect(result.resourceMetrics).toEqual([]);
    });

    it("decodeLogsRequest can be called directly", () => {
      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [],
      });
      const payload = toBinary(ExportLogsServiceRequestSchema, request);

      const result = decodeLogsRequest(new Uint8Array(payload));
      expect(result.resourceLogs).toEqual([]);
    });

    it("handles attribute with undefined/empty value", () => {
      const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
      const spanId = hexToBytes("0123456789abcdef");

      // Create request with attribute that has no value set
      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "empty.attr",
                  // value is undefined - tests the !value branch
                },
                {
                  key: "valid.attr",
                  value: { value: { case: "stringValue", value: "test" } },
                },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "test",
                    startTimeUnixNano: 1704067200000000000n,
                    endTimeUnixNano: 1704067260000000000n,
                  },
                ],
              },
            ],
          },
        ],
      });

      const payload = toBinary(ExportTraceServiceRequestSchema, request);
      const result = decodeTracesRequest(new Uint8Array(payload));

      // Empty value should be converted to undefined
      expect(
        result.resourceSpans?.[0]?.resource?.attributes?.[0]?.value
      ).toBeUndefined();
      // Valid value should still work
      expect(
        result.resourceSpans?.[0]?.resource?.attributes?.[1]?.value?.stringValue
      ).toBe("test");
    });
  });

  describe("JSON requests still work", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("accepts JSON and returns JSON response", async () => {
      const writeTracesSpy = vi.fn().mockResolvedValue({
        rejectedSpans: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn(),
          writeTraces: writeTracesSpy,
          writeLogs: vi.fn(),
        },
      });

      const response = await server.inject({
        method: "POST",
        url: "/v1/traces",
        payload: {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: "test-service" },
                  },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: "test-instrumentation" },
                  spans: [
                    {
                      traceId: "0123456789abcdef0123456789abcdef",
                      spanId: "0123456789abcdef",
                      name: "test-span",
                      kind: 2,
                      startTimeUnixNano: "1704067200000000000",
                      endTimeUnixNano: "1704067260000000000",
                      status: { code: 1 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        headers: {
          "content-type": "application/json",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toEqual({
        partialSuccess: {
          rejectedSpans: undefined,
          errorMessage: undefined,
        },
      });
    });
  });
});
