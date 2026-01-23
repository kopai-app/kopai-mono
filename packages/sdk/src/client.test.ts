import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { KopaiClient } from "./client.js";
import { KopaiError, KopaiTimeoutError } from "./errors.js";
import type { OtelTracesRow, OtelLogsRow, OtelMetricsRow } from "./types.js";
import {
  handlers,
  BASE_URL,
  sampleTrace,
  sampleLog,
  sampleMetric,
  sampleDiscovery,
} from "./mocks/handlers.js";

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("KopaiClient", () => {
  let client: KopaiClient;

  beforeEach(() => {
    client = new KopaiClient({
      baseUrl: BASE_URL,
      token: "test-token",
    });
  });

  describe("getTrace", () => {
    it("returns all spans for a trace", async () => {
      const spans = await client.getTrace("trace-456");

      expect(spans).toHaveLength(1);
      expect(spans[0]!.SpanId).toBe(sampleTrace.SpanId);
      expect(spans[0]!.TraceId).toBe(sampleTrace.TraceId);
    });

    it("collects spans from multiple pages", async () => {
      const spans = await client.getTrace("trace-multi-page");

      expect(spans).toHaveLength(2);
      expect(spans[0]!.SpanId).toBe("span-123");
      expect(spans[1]!.SpanId).toBe("span-page2");
    });
  });

  describe("searchTraces", () => {
    it("returns async iterator", async () => {
      const spans: OtelTracesRow[] = [];
      for await (const span of client.searchTraces({ serviceName: "test" })) {
        spans.push(span);
      }

      expect(spans).toHaveLength(1);
      expect(spans[0]!.SpanName).toBe("test-span");
    });

    it("auto-paginates through multiple pages", async () => {
      const spans: OtelTracesRow[] = [];
      for await (const span of client.searchTraces({
        traceId: "trace-multi-page",
      })) {
        spans.push(span);
      }

      expect(spans).toHaveLength(2);
    });
  });

  describe("searchTracesPage", () => {
    it("returns single page with cursor", async () => {
      const result = await client.searchTracesPage({
        traceId: "trace-multi-page",
      });

      expect(result.data).toHaveLength(1);
      expect(result.nextCursor).toBe("page2");
    });
  });

  describe("searchLogs", () => {
    it("returns logs via async iterator", async () => {
      const logs: OtelLogsRow[] = [];
      for await (const log of client.searchLogs({ serviceName: "test" })) {
        logs.push(log);
      }

      expect(logs).toHaveLength(1);
      expect(logs[0]!.Body).toBe(sampleLog.Body);
    });

    it("auto-paginates", async () => {
      const logs: OtelLogsRow[] = [];
      for await (const log of client.searchLogs({
        traceId: "trace-multi-page",
      })) {
        logs.push(log);
      }

      expect(logs).toHaveLength(2);
    });
  });

  describe("searchMetrics", () => {
    it("returns metrics via async iterator", async () => {
      const metrics: OtelMetricsRow[] = [];
      for await (const metric of client.searchMetrics({
        metricType: "Gauge",
      })) {
        metrics.push(metric);
      }

      expect(metrics).toHaveLength(1);
      const metric = metrics[0]!;
      expect(metric.MetricType).toBe("Gauge");
      if (metric.MetricType === "Gauge") {
        expect(metric.Value).toBe(sampleMetric.Value);
      }
    });

    it("auto-paginates", async () => {
      const metrics: OtelMetricsRow[] = [];
      for await (const metric of client.searchMetrics({
        metricType: "Gauge",
        metricName: "multi-page-metric",
      })) {
        metrics.push(metric);
      }

      expect(metrics).toHaveLength(2);
    });
  });

  describe("discoverMetrics", () => {
    it("returns metrics discovery", async () => {
      const result = await client.discoverMetrics();

      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0]!.name).toBe(sampleDiscovery.metrics[0]!.name);
      expect(result.metrics[0]!.type).toBe("Histogram");
    });
  });

  describe("authentication", () => {
    it("sends bearer token in Authorization header", async () => {
      // This is implicitly tested by all successful calls
      const spans = await client.getTrace("trace-456");
      expect(spans).toHaveLength(1);
    });

    it("throws 401 error without token", async () => {
      const unauthClient = new KopaiClient({
        baseUrl: BASE_URL,
      });

      await expect(unauthClient.getTrace("trace-456")).rejects.toThrow(
        KopaiError
      );

      try {
        await unauthClient.getTrace("trace-456");
      } catch (e) {
        const error = e as KopaiError;
        expect(error.status).toBe(401);
        expect(error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("error handling", () => {
    it("throws KopaiError for 404", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/traces`, () => {
          return HttpResponse.json(
            {
              type: "https://api.kopai.io/errors/not-found",
              title: "Trace Not Found",
              code: "TRACE_NOT_FOUND",
              detail: "No trace with that ID",
            },
            { status: 404 }
          );
        })
      );

      await expect(client.getTrace("not-exists")).rejects.toThrow(KopaiError);

      try {
        await client.getTrace("not-exists");
      } catch (e) {
        const error = e as KopaiError;
        expect(error.status).toBe(404);
        expect(error.code).toBe("TRACE_NOT_FOUND");
        expect(error.detail).toBe("No trace with that ID");
      }
    });
  });

  describe("abort signal", () => {
    it("cancels request with AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.searchTracesPage({}, { signal: controller.signal })
      ).rejects.toThrow();
    });
  });

  describe("timeout", () => {
    it("uses default timeout", async () => {
      server.use(
        http.post(`${BASE_URL}/v1/traces`, async () => {
          // This won't actually delay since we're using default timeout
          return HttpResponse.json({
            data: [sampleTrace],
            nextCursor: null,
          });
        })
      );

      // Default timeout is 30s, so this should succeed
      const result = await client.searchTracesPage({});
      expect(result.data).toHaveLength(1);
    });

    it("respects custom timeout", async () => {
      const shortTimeoutClient = new KopaiClient({
        baseUrl: BASE_URL,
        token: "test-token",
        timeout: 10, // 10ms
      });

      server.use(
        http.post(`${BASE_URL}/v1/traces`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({
            data: [sampleTrace],
            nextCursor: null,
          });
        })
      );

      await expect(shortTimeoutClient.searchTracesPage({})).rejects.toThrow(
        KopaiTimeoutError
      );
    });
  });

  describe("custom headers", () => {
    it("includes custom headers in requests", async () => {
      let capturedHeaders: Headers | null = null;

      server.use(
        http.post(`${BASE_URL}/v1/traces`, ({ request }) => {
          capturedHeaders = request.headers;
          return HttpResponse.json({
            data: [sampleTrace],
            nextCursor: null,
          });
        })
      );

      const customClient = new KopaiClient({
        baseUrl: BASE_URL,
        token: "test-token",
        headers: {
          "X-Custom-Header": "custom-value",
        },
      });

      await customClient.searchTracesPage({});

      expect(capturedHeaders!.get("X-Custom-Header")).toBe("custom-value");
      expect(capturedHeaders!.get("Authorization")).toBe("Bearer test-token");
    });
  });
});
