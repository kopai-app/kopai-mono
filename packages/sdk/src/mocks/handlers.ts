import { http, HttpResponse } from "msw";
import type {
  OtelTracesRow,
  OtelLogsRow,
  OtelMetricsRow,
  MetricsDiscoveryResult,
  SearchResult,
  ApiErrorResponse,
} from "../types.js";

const BASE_URL = "https://api.kopai.test";

// Sample trace data
export const sampleTrace = {
  SpanId: "span-123",
  TraceId: "trace-456",
  Timestamp: "1705000000000000000",
  SpanName: "test-span",
  ServiceName: "test-service",
} satisfies OtelTracesRow;

// Sample log data
export const sampleLog = {
  Timestamp: "1705000000000000000",
  Body: "Test log message",
  SeverityText: "INFO",
  ServiceName: "test-service",
} satisfies OtelLogsRow;

// Sample metric data
export const sampleMetric = {
  MetricType: "Gauge",
  MetricName: "test-metric",
  Value: 42,
  TimeUnix: "1705000000000000000",
  StartTimeUnix: "1705000000000000000",
  ServiceName: "test-service",
} satisfies OtelMetricsRow;

// Sample metrics discovery
export const sampleDiscovery = {
  metrics: [
    {
      name: "http.request.duration",
      type: "Histogram",
      unit: "ms",
      description: "HTTP request duration",
      attributes: {
        values: { method: ["GET", "POST"], status_code: ["200", "404"] },
      },
      resourceAttributes: {
        values: { "service.name": ["api", "web"] },
      },
    },
  ],
} satisfies MetricsDiscoveryResult;

export const handlers = [
  // Traces endpoint
  http.post(`${BASE_URL}/v1/traces`, async (info) => {
    const { request } = info;

    // Check auth first (no body parsing needed)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          code: "UNAUTHORIZED",
        } satisfies ApiErrorResponse,
        { status: 401 }
      );
    }

    // Clone and parse body
    const body = (await request.clone().json()) as Record<string, unknown>;

    // Return paginated response
    if (body.cursor === "page2") {
      return HttpResponse.json({
        data: [{ ...sampleTrace, SpanId: "span-page2" }],
        nextCursor: null,
      } satisfies SearchResult<OtelTracesRow>);
    }

    if (body.traceId === "trace-multi-page") {
      return HttpResponse.json({
        data: [sampleTrace],
        nextCursor: "page2",
      } satisfies SearchResult<OtelTracesRow>);
    }

    return HttpResponse.json({
      data: [sampleTrace],
      nextCursor: null,
    } satisfies SearchResult<OtelTracesRow>);
  }),

  // Logs endpoint
  http.post(`${BASE_URL}/v1/logs`, async (info) => {
    const { request } = info;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          code: "UNAUTHORIZED",
        } satisfies ApiErrorResponse,
        { status: 401 }
      );
    }

    const body = (await request.clone().json()) as Record<string, unknown>;

    if (body.cursor === "page2") {
      return HttpResponse.json({
        data: [{ ...sampleLog, Body: "Log page 2" }],
        nextCursor: null,
      } satisfies SearchResult<OtelLogsRow>);
    }

    if (body.traceId === "trace-multi-page") {
      return HttpResponse.json({
        data: [sampleLog],
        nextCursor: "page2",
      } satisfies SearchResult<OtelLogsRow>);
    }

    return HttpResponse.json({
      data: [sampleLog],
      nextCursor: null,
    } satisfies SearchResult<OtelLogsRow>);
  }),

  // Metrics endpoint
  http.post(`${BASE_URL}/v1/metrics`, async (info) => {
    const { request } = info;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          code: "UNAUTHORIZED",
        } satisfies ApiErrorResponse,
        { status: 401 }
      );
    }

    const body = (await request.clone().json()) as Record<string, unknown>;

    if (body.cursor === "page2") {
      return HttpResponse.json({
        data: [{ ...sampleMetric, Value: 100 }],
        nextCursor: null,
      } satisfies SearchResult<OtelMetricsRow>);
    }

    if (body.metricName === "multi-page-metric") {
      return HttpResponse.json({
        data: [sampleMetric],
        nextCursor: "page2",
      } satisfies SearchResult<OtelMetricsRow>);
    }

    return HttpResponse.json({
      data: [sampleMetric],
      nextCursor: null,
    } satisfies SearchResult<OtelMetricsRow>);
  }),

  // Metrics discovery endpoint
  http.get(`${BASE_URL}/v1/metrics/discover`, (info) => {
    const { request } = info;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          code: "UNAUTHORIZED",
        } satisfies ApiErrorResponse,
        { status: 401 }
      );
    }

    return HttpResponse.json(sampleDiscovery);
  }),

  // 404 endpoint for testing
  http.post(`${BASE_URL}/v1/not-found`, () => {
    return HttpResponse.json(
      {
        type: "https://api.kopai.io/errors/not-found",
        title: "Not Found",
        code: "NOT_FOUND",
        detail: "Resource not found",
      } satisfies ApiErrorResponse,
      { status: 404 }
    );
  }),
];

export { BASE_URL };
