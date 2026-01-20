/// <reference types="vitest/globals" />
import fastify, { type FastifyInstance } from "fastify";
import { collectorRoutes } from "./index.js";
import { CollectorError } from "./routes/errors.js";
import { grpcStatusCode } from "./routes/otlp-schemas.js";
import type { MetricsData } from "@kopai/core";

describe("collectorRoutes", () => {
  describe("POST /v1/metrics", () => {
    let server: FastifyInstance;
    beforeEach(() => {
      server = fastify();
    });

    afterEach(() => {
      server.close();
    });

    it("returns OK and calls telemetryDatasource.writeMetrics", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
        },
      });

      const metricsPayload: MetricsData = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "test-service" } },
                { key: "service.version", value: { stringValue: "1.0.0" } },
              ],
            },
            schemaUrl: "https://opentelemetry.io/schemas/1.0.0",
            scopeMetrics: [
              {
                scope: {
                  name: "test-instrumentation",
                  version: "1.0.0",
                  attributes: [
                    {
                      key: "scope.attr",
                      value: { stringValue: "scope-value" },
                    },
                  ],
                },
                schemaUrl: "https://opentelemetry.io/schemas/1.0.0",
                metrics: [
                  // Gauge metric
                  {
                    name: "system.cpu.usage",
                    description: "CPU usage percentage",
                    unit: "1",
                    gauge: {
                      dataPoints: [
                        {
                          attributes: [{ key: "cpu", value: { intValue: 0 } }],
                          startTimeUnixNano: "1704067200000000000",
                          timeUnixNano: "1704067260000000000",
                          asDouble: 0.75,
                          exemplars: [
                            {
                              filteredAttributes: [
                                {
                                  key: "filtered.attr",
                                  value: { stringValue: "filtered-value" },
                                },
                              ],
                              timeUnixNano: "1704067260000000000",
                              asDouble: 0.8,
                              spanId: "abc123",
                              traceId: undefined,
                            },
                          ],
                          flags: 0,
                        },
                      ],
                    },
                    metadata: [
                      { key: "meta.key", value: { stringValue: "meta-value" } },
                    ],
                  },
                  // Sum metric
                  {
                    name: "http.requests.total",
                    description: "Total HTTP requests",
                    unit: "1",
                    sum: {
                      dataPoints: [
                        {
                          attributes: [
                            {
                              key: "http.method",
                              value: { stringValue: "GET" },
                            },
                            {
                              key: "http.status_code",
                              value: { intValue: 200 },
                            },
                          ],
                          startTimeUnixNano: "1704067200000000000",
                          timeUnixNano: "1704067260000000000",
                          asInt: "1500",
                          flags: 0,
                        },
                      ],
                      aggregationTemporality: 2, // CUMULATIVE
                      isMonotonic: true,
                    },
                  },
                  // Histogram metric
                  {
                    name: "http.request.duration",
                    description: "HTTP request duration",
                    unit: "ms",
                    histogram: {
                      dataPoints: [
                        {
                          attributes: [
                            {
                              key: "http.route",
                              value: { stringValue: "/api/users" },
                            },
                          ],
                          startTimeUnixNano: "1704067200000000000",
                          timeUnixNano: "1704067260000000000",
                          count: "100",
                          sum: 5000,
                          bucketCounts: [10, 20, 30, 25, 10, 5],
                          explicitBounds: [10, 25, 50, 100, 250],
                          exemplars: [
                            {
                              timeUnixNano: "1704067255000000000",
                              asDouble: 45.5,
                              spanId: "span123",
                            },
                          ],
                          flags: 0,
                          min: 2.5,
                          max: 450.0,
                        },
                      ],
                      aggregationTemporality: 2, // CUMULATIVE
                    },
                  },
                  // Exponential Histogram metric
                  {
                    name: "http.request.duration.exp",
                    description: "HTTP request duration (exponential)",
                    unit: "ms",
                    exponentialHistogram: {
                      dataPoints: [
                        {
                          attributes: [
                            {
                              key: "http.route",
                              value: { stringValue: "/api/orders" },
                            },
                          ],
                          startTimeUnixNano: "1704067200000000000",
                          timeUnixNano: "1704067260000000000",
                          count: "50",
                          sum: 2500,
                          scale: 3,
                          zeroCount: 2,
                          positive: {
                            offset: 0,
                            bucketCounts: ["5", "10", "15", "12", "6"],
                          },
                          negative: {
                            offset: 0,
                            bucketCounts: [],
                          },
                          flags: 0,
                          exemplars: [
                            {
                              timeUnixNano: "1704067250000000000",
                              asDouble: 55.0,
                            },
                          ],
                          min: 1.0,
                          max: 200.0,
                          zeroThreshold: 0.001,
                        },
                      ],
                      aggregationTemporality: 2, // CUMULATIVE
                    },
                  },
                  // Summary metric
                  {
                    name: "http.request.latency.summary",
                    description: "HTTP request latency summary",
                    unit: "ms",
                    summary: {
                      dataPoints: [
                        {
                          attributes: [
                            {
                              key: "http.route",
                              value: { stringValue: "/api/products" },
                            },
                          ],
                          startTimeUnixNano: "1704067200000000000",
                          timeUnixNano: "1704067260000000000",
                          count: "200",
                          sum: 10000,
                          quantileValues: [
                            { quantile: 0.0, value: 5.0 }, // min
                            { quantile: 0.5, value: 45.0 }, // median
                            { quantile: 0.9, value: 95.0 }, // p90
                            { quantile: 0.99, value: 150.0 }, // p99
                            { quantile: 1.0, value: 300.0 }, // max
                          ],
                          flags: 0,
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

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: metricsPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        partialSuccess: {
          rejectedDataPoints: undefined,
          errorMessage: undefined,
        },
      });

      expect(writeMetricsSpy).toHaveBeenCalledWith(metricsPayload);
    });

    it("returns 400 and response body as specified in otel collector spec for invalid payload", async () => {
      const writeMetricsSpy = vi.fn().mockResolvedValue({
        rejectedDataPoints: undefined,
        errorMessage: undefined,
      });

      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: writeMetricsSpy,
        },
      });

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: {
          resourceMetrics: [
            {
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: "test.metric",
                      gauge: {
                        dataPoints: [
                          {
                            // Invalid: asDouble should be number, not string
                            asDouble: "not-a-number",
                            timeUnixNano: "1704067260000000000",
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 3, // INVALID_ARGUMENT
        message: "Invalid data",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [
              {
                description: "Invalid input",
                field: "resourceMetrics",
                reason: "invalid_union",
              },
            ],
          },
        ],
      });

      expect(writeMetricsSpy).not.toHaveBeenCalled();
    });

    it("returns 500 with gRPC status when writeMetrics throws CollectorError", async () => {
      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi
            .fn()
            .mockRejectedValue(
              new CollectorError(
                500,
                "Database connection failed",
                grpcStatusCode.INTERNAL
              )
            ),
        },
      });

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: { resourceMetrics: [] },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: grpcStatusCode.INTERNAL,
        message: "Database connection failed",
      });
    });

    it("returns 500 with generic error when writeMetrics throws unexpected error", async () => {
      server.register(collectorRoutes, {
        telemetryDatasource: {
          writeMetrics: vi.fn().mockRejectedValue(new Error("unexpected")),
        },
      });

      const response = await server.inject({
        method: "POST",
        url: "/v1/metrics",
        payload: { resourceMetrics: [] },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: "Internal Server Error",
      });
    });
  });
});
