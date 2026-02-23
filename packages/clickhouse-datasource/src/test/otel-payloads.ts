/**
 * Comprehensive OTLP JSON payloads covering all CH schema fields.
 * Sent via HTTP/JSON to the OTEL collector's /v1/* endpoints.
 */

function nowNanos(): string {
  return String(Date.now() * 1_000_000);
}

export const TEST_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
export const TEST_SPAN_ID = "b7ad6b7169203331";
export const TEST_PARENT_SPAN_ID = "00f067aa0ba902b7";
export const TEST_LINK_TRACE_ID = "e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3";
export const TEST_LINK_SPAN_ID = "1234567890abcdef";
export const TEST_SERVICE_NAME = "e2e-test-service";
export const TEST_SCOPE_NAME = "e2e-test-scope";
export const TEST_SCOPE_VERSION = "1.0.0";

function otelAttr(key: string, value: string | number | boolean) {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { key, value: { intValue: value } };
    return { key, value: { doubleValue: value } };
  }
  return { key, value: { boolValue: value } };
}

const resourceAttributes = [
  otelAttr("service.name", TEST_SERVICE_NAME),
  otelAttr("service.version", "1.0.0"),
  otelAttr("deployment.environment", "test"),
];

const scopeInfo = {
  name: TEST_SCOPE_NAME,
  version: TEST_SCOPE_VERSION,
};

export function createTracesPayload() {
  const now = nowNanos();
  const endTime = String(BigInt(now) + 5_000_000n); // 5ms duration

  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes },
        scopeSpans: [
          {
            scope: scopeInfo,
            spans: [
              {
                traceId: TEST_TRACE_ID,
                spanId: TEST_PARENT_SPAN_ID,
                name: "GET /api/e2e-test",
                kind: 2, // SERVER
                startTimeUnixNano: now,
                endTimeUnixNano: endTime,
                status: { code: 1, message: "OK" },
                traceState: "vendorname=value",
                attributes: [
                  otelAttr("http.method", "GET"),
                  otelAttr("http.status_code", 200),
                  otelAttr("http.url", "/api/e2e-test"),
                ],
              },
              {
                traceId: TEST_TRACE_ID,
                spanId: TEST_SPAN_ID,
                parentSpanId: TEST_PARENT_SPAN_ID,
                name: "DB query",
                kind: 3, // CLIENT
                startTimeUnixNano: now,
                endTimeUnixNano: endTime,
                status: { code: 1, message: "" },
                attributes: [
                  otelAttr("db.system", "postgresql"),
                  otelAttr("db.statement", "SELECT * FROM users"),
                ],
                events: [
                  {
                    timeUnixNano: now,
                    name: "query_start",
                    attributes: [
                      otelAttr("db.statement", "SELECT * FROM users"),
                    ],
                  },
                ],
                links: [
                  {
                    traceId: TEST_LINK_TRACE_ID,
                    spanId: TEST_LINK_SPAN_ID,
                    traceState: "linked=true",
                    attributes: [otelAttr("link.type", "follows_from")],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function createLogsPayload() {
  const now = nowNanos();

  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttributes },
        scopeLogs: [
          {
            scope: scopeInfo,
            logRecords: [
              {
                timeUnixNano: now,
                observedTimeUnixNano: now,
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: "E2E test log message" },
                traceId: TEST_TRACE_ID,
                spanId: TEST_SPAN_ID,
                flags: 1,
                attributes: [
                  otelAttr("log.source", "e2e-test"),
                  otelAttr("request.id", "req-e2e-001"),
                ],
              },
              {
                timeUnixNano: String(BigInt(now) + 1_000_000n),
                observedTimeUnixNano: String(BigInt(now) + 1_000_000n),
                severityNumber: 17,
                severityText: "ERROR",
                body: { stringValue: "E2E test error log" },
                attributes: [otelAttr("error.type", "TestError")],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function createMetricsPayload() {
  const now = nowNanos();
  const startTime = String(BigInt(now) - 60_000_000_000n); // 60s ago

  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceAttributes },
        scopeMetrics: [
          {
            scope: scopeInfo,
            metrics: [
              {
                name: "e2e.test.gauge",
                description: "E2E test gauge metric",
                unit: "1",
                gauge: {
                  dataPoints: [
                    {
                      timeUnixNano: now,
                      startTimeUnixNano: startTime,
                      asDouble: 42.5,
                      attributes: [
                        otelAttr("region", "us-east"),
                        otelAttr("env", "test"),
                      ],
                    },
                  ],
                },
              },
              {
                name: "e2e.test.sum",
                description: "E2E test sum metric",
                unit: "{requests}",
                sum: {
                  dataPoints: [
                    {
                      timeUnixNano: now,
                      startTimeUnixNano: startTime,
                      asDouble: 100,
                      attributes: [otelAttr("http.method", "GET")],
                    },
                  ],
                  aggregationTemporality: 2,
                  isMonotonic: true,
                },
              },
              {
                name: "e2e.test.histogram",
                description: "E2E test histogram metric",
                unit: "ms",
                histogram: {
                  dataPoints: [
                    {
                      timeUnixNano: now,
                      startTimeUnixNano: startTime,
                      count: "10",
                      sum: 500.0,
                      min: 5.0,
                      max: 95.0,
                      bucketCounts: ["1", "2", "3", "4"],
                      explicitBounds: [10.0, 50.0, 100.0],
                      attributes: [],
                    },
                  ],
                  aggregationTemporality: 2,
                },
              },
              {
                name: "e2e.test.exponential_histogram",
                description: "E2E test exponential histogram",
                unit: "ms",
                exponentialHistogram: {
                  dataPoints: [
                    {
                      timeUnixNano: now,
                      startTimeUnixNano: startTime,
                      count: "5",
                      sum: 250.0,
                      scale: 1,
                      zeroCount: "0",
                      positive: { offset: 0, bucketCounts: ["1", "2", "2"] },
                      negative: { offset: 0, bucketCounts: ["0", "0", "0"] },
                      attributes: [],
                    },
                  ],
                  aggregationTemporality: 2,
                },
              },
              {
                name: "e2e.test.summary",
                description: "E2E test summary metric",
                unit: "ms",
                summary: {
                  dataPoints: [
                    {
                      timeUnixNano: now,
                      startTimeUnixNano: startTime,
                      count: "100",
                      sum: 5000.0,
                      quantileValues: [
                        { quantile: 0.5, value: 50.0 },
                        { quantile: 0.95, value: 95.0 },
                        { quantile: 0.99, value: 99.0 },
                      ],
                      attributes: [],
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
}
