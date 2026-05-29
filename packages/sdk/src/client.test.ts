import {
  describe,
  it,
  expect,
  expectTypeOf,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { kopaiQuery } from "@kopai/core";
import { KopaiClient } from "./client.js";
import { KopaiError, KopaiTimeoutError } from "./errors.js";
import type {
  OtelTracesRow,
  OtelLogsRow,
  OtelMetricsRow,
  Dashboard,
} from "./types.js";
import {
  handlers,
  BASE_URL,
  sampleTrace,
  sampleLog,
  sampleMetric,
  sampleAggregatedMetric,
  sampleDiscovery,
  sampleDashboard,
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

  describe("searchAggregatedMetrics", () => {
    it("returns aggregated rows", async () => {
      const result = await client.searchAggregatedMetrics({
        metricType: "Sum",
        metricName: "kopai.ingestion.bytes",
        aggregate: "sum",
        groupBy: ["signal"],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(sampleAggregatedMetric);
      expect(result.nextCursor).toBeNull();
    });

    it("rejects groupBy without aggregate", async () => {
      await expect(
        // @ts-expect-error testing runtime validation of invalid input
        client.searchAggregatedMetrics({
          metricType: "Sum",
          groupBy: ["signal"],
        })
      ).rejects.toThrow();
    });

    it("rejects aggregate on Histogram type", async () => {
      await expect(
        client.searchAggregatedMetrics({
          metricType: "Histogram",
          aggregate: "sum",
        })
      ).rejects.toThrow();
    });
  });

  describe("searchMetricsPage with aggregated response", () => {
    it("throws validation error when server returns aggregated shape", async () => {
      // Simulate the bug: searchMetricsPage called but server returns
      // aggregated rows (no MetricType discriminator)
      server.use(
        http.post(`${BASE_URL}/signals/metrics/search`, () =>
          HttpResponse.json({
            data: [sampleAggregatedMetric],
            nextCursor: null,
          })
        )
      );

      await expect(
        client.searchMetricsPage({ metricType: "Gauge" })
      ).rejects.toThrow(/validation/i);
    });
  });

  describe("createDashboard", () => {
    it("creates dashboard and returns result", async () => {
      const result = await client.createDashboard({
        name: "My Dashboard",
        uiTreeVersion: "0.5.0",
        uiTree: sampleDashboard.uiTree,
      });

      expect(result.id).toBe(sampleDashboard.id);
      expect(result.name).toBe("My Dashboard");
      expect(result.uiTreeVersion).toBe(sampleDashboard.uiTreeVersion);
    });

    it("throws on auth error", async () => {
      const unauthClient = new KopaiClient({
        baseUrl: BASE_URL,
      });

      await expect(
        unauthClient.createDashboard({
          name: "Test",
          uiTreeVersion: "0.5.0",
          uiTree: {},
        })
      ).rejects.toThrow(KopaiError);

      try {
        await unauthClient.createDashboard({
          name: "Test",
          uiTreeVersion: "0.5.0",
          uiTree: {},
        });
      } catch (e) {
        const error = e as KopaiError;
        expect(error.status).toBe(401);
        expect(error.code).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("getDashboard", () => {
    it("returns dashboard by id", async () => {
      const result = await client.getDashboard("dash-001");
      expect(result.id).toBe(sampleDashboard.id);
      expect(result.name).toBe(sampleDashboard.name);
    });

    it("throws KopaiError for 404", async () => {
      const error = await client.getDashboard("not-found").catch((e) => e);
      expect(error).toBeInstanceOf(KopaiError);
      expect(error.status).toBe(404);
      expect(error.code).toBe("DASHBOARD_NOT_FOUND");
    });
  });

  describe("searchDashboardsPage", () => {
    it("returns single page", async () => {
      const result = await client.searchDashboardsPage({});
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(sampleDashboard.id);
      expect(result.nextCursor).toBeNull();
    });

    it("returns page with cursor", async () => {
      const result = await client.searchDashboardsPage({
        name: "multi-page",
      });
      expect(result.data).toHaveLength(1);
      expect(result.nextCursor).toBe("page2");
    });
  });

  describe("searchDashboards", () => {
    it("auto-paginates", async () => {
      const dashboards: Dashboard[] = [];
      for await (const d of client.searchDashboards({
        name: "multi-page",
      })) {
        dashboards.push(d);
      }
      expect(dashboards).toHaveLength(2);
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
        http.get(`${BASE_URL}/signals/traces/not-exists`, () => {
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

    it("surfaces Problem Details `detail` in error.message (G4)", async () => {
      const detail =
        "Percentile measures (P50-P999) are not yet supported on the sqlite backend.";
      server.use(
        http.post(`${BASE_URL}/signals/query/metrics/aggregate`, () => {
          return HttpResponse.json(
            {
              type: "https://docs.kopai.app/errors/signals-api-validation-error",
              status: 400,
              title: "Invalid query",
              detail,
            },
            { status: 400 }
          );
        })
      );

      // Valid query (passes local validation) so it reaches the server,
      // which rejects percentiles on the sqlite backend.
      const send = () =>
        client.queryMetricsAggregate({
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "P95", column: "Value", as: "p95" }],
          filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        });

      await expect(send()).rejects.toThrow(KopaiError);

      try {
        await send();
      } catch (e) {
        const error = e as KopaiError;
        expect(error.status).toBe(400);
        expect(error.detail).toBe(detail);
        expect(error.message).toContain("Percentile measures");
        expect(error.message).toContain(detail);
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
        http.post(`${BASE_URL}/signals/traces/search`, async () => {
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
        http.post(`${BASE_URL}/signals/traces/search`, async () => {
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
        http.post(`${BASE_URL}/signals/traces/search`, ({ request }) => {
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

  // ============================================================
  // KopaiQuery SDK methods (Phase 2a)
  // ============================================================
  describe("queryTracesRaw", () => {
    const q: kopaiQuery.TraceRawQuery = {
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      timeDimension: { type: "relative", lookback: "1h" },
    };

    it("POSTs to /signals/query/traces/raw with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/traces/raw`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [sampleTrace],
              nextCursor: "next-page",
            });
          }
        )
      );

      const result = await client.queryTracesRaw(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/traces/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.SpanId).toBe(sampleTrace.SpanId);
      expect(result.nextCursor).toBe("next-page");
    });

    it("rejects invalid query at runtime", async () => {
      await expect(
        // @ts-expect-error invalid runtime input (missing mode)
        client.queryTracesRaw({ signal: "traces", dimensions: ["SpanId"] })
      ).rejects.toThrow();
    });
  });

  describe("queryTracesAggregate", () => {
    const q: kopaiQuery.TraceAggregateQuery = {
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    };

    it("POSTs to /signals/query/traces/aggregate with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/traces/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [{ c: 42 }],
            });
          }
        )
      );

      const result = await client.queryTracesAggregate(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/traces/aggregate`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toEqual([{ c: 42 }]);
    });
  });

  describe("queryLogsRaw", () => {
    const q: kopaiQuery.LogRawQuery = {
      signal: "logs",
      mode: "raw",
      dimensions: ["Body"],
      timeDimension: { type: "relative", lookback: "1h" },
    };

    it("POSTs to /signals/query/logs/raw with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(`${BASE_URL}/signals/query/logs/raw`, async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = await request.clone().json();
          return HttpResponse.json({
            data: [sampleLog],
            nextCursor: null,
          });
        })
      );

      const result = await client.queryLogsRaw(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/logs/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.Body).toBe(sampleLog.Body);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("queryLogsAggregate", () => {
    const q: kopaiQuery.LogAggregateQuery = {
      signal: "logs",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    };

    it("POSTs to /signals/query/logs/aggregate with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/logs/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [{ c: 7 }],
            });
          }
        )
      );

      const result = await client.queryLogsAggregate(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/logs/aggregate`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toEqual([{ c: 7 }]);
    });
  });

  describe("queryMetricsRaw", () => {
    const q: kopaiQuery.MetricRawQuery = {
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName"],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: { type: "relative", lookback: "1h" },
    };

    it("POSTs to /signals/query/metrics/raw with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/metrics/raw`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [sampleMetric],
              nextCursor: null,
            });
          }
        )
      );

      const result = await client.queryMetricsRaw(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/metrics/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.MetricName).toBe(sampleMetric.MetricName);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe("queryMetricsAggregate", () => {
    const q: kopaiQuery.MetricAggregateQuery = {
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    };

    it("POSTs to /signals/query/metrics/aggregate with body + parses response", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/metrics/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [{ c: 99 }],
            });
          }
        )
      );

      const result = await client.queryMetricsAggregate(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/metrics/aggregate`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toEqual([{ c: 99 }]);
    });

    it("rejects a metric query missing the MetricType filter before sending (M1)", async () => {
      // No server mock: validateKopaiQuery must reject locally so the request
      // is never made (would otherwise be a server 400).
      await expect(
        client.queryMetricsAggregate({
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "c" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        })
      ).rejects.toThrow(/MetricType/);
    });
  });

  // ============================================================
  // Polymorphic query() dispatcher (Phase A1)
  // ============================================================
  describe("query (dispatcher)", () => {
    it("dispatches traces+raw to /signals/query/traces/raw", async () => {
      const q: kopaiQuery.TraceRawQuery = {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: { type: "relative", lookback: "1h" },
      };
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/traces/raw`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [sampleTrace],
              nextCursor: "next",
            });
          }
        )
      );

      const result = await client.query(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/traces/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.nextCursor).toBe("next");
    });

    it("dispatches traces+aggregate to /signals/query/traces/aggregate", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/traces/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({ data: [{ c: 1 }] });
          }
        )
      );

      // Inline literal so KopaiQueryResult<Q> can narrow on output.type.
      const result = await client.query({
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: { type: "relative", lookback: "1h" },
        output: { type: "summary" },
      });

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/traces/aggregate`);
      expect(result.data).toEqual([{ c: 1 }]);
      expect(capturedBody).toMatchObject({
        signal: "traces",
        mode: "aggregate",
      });
    });

    it("dispatches logs+raw to /signals/query/logs/raw", async () => {
      const q: kopaiQuery.LogRawQuery = {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: { type: "relative", lookback: "1h" },
      };
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(`${BASE_URL}/signals/query/logs/raw`, async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = await request.clone().json();
          return HttpResponse.json({ data: [sampleLog], nextCursor: null });
        })
      );

      const result = await client.query(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/logs/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("dispatches logs+aggregate to /signals/query/logs/aggregate", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/logs/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({ data: [{ c: 2 }] });
          }
        )
      );

      const result = await client.query({
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: { type: "relative", lookback: "1h" },
        output: { type: "summary" },
      });

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/logs/aggregate`);
      expect(result.data).toEqual([{ c: 2 }]);
      expect(capturedBody).toMatchObject({ signal: "logs", mode: "aggregate" });
    });

    it("dispatches metrics+raw to /signals/query/metrics/raw", async () => {
      const q: kopaiQuery.MetricRawQuery = {
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName"],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: { type: "relative", lookback: "1h" },
      };
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/metrics/raw`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({
              data: [sampleMetric],
              nextCursor: null,
            });
          }
        )
      );

      const result = await client.query(q);

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/metrics/raw`);
      expect(capturedBody).toEqual(q);
      expect(result.data).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("dispatches metrics+aggregate to /signals/query/metrics/aggregate", async () => {
      let capturedUrl = "";
      let capturedBody: unknown = null;
      server.use(
        http.post(
          `${BASE_URL}/signals/query/metrics/aggregate`,
          async ({ request }) => {
            capturedUrl = request.url;
            capturedBody = await request.clone().json();
            return HttpResponse.json({ data: [{ c: 3 }] });
          }
        )
      );

      const result = await client.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: { type: "relative", lookback: "1h" },
        output: { type: "summary" },
      });

      expect(capturedUrl).toBe(`${BASE_URL}/signals/query/metrics/aggregate`);
      expect(result.data).toEqual([{ c: 3 }]);
      expect(capturedBody).toMatchObject({
        signal: "metrics",
        mode: "aggregate",
      });
    });
  });
});

// ============================================================
// Type-only: KopaiQuery SDK method return types + variant guards
// ============================================================
describe("KopaiClient kopaiQuery method types", () => {
  it("queryTracesRaw return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryTracesRaw>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: OtelTracesRow[];
      nextCursor: string | null;
    }>();
  });

  it("queryTracesRaw rejects non-trace-raw input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const logRaw: kopaiQuery.LogRawQuery = {
      signal: "logs",
      mode: "raw",
      dimensions: ["Body"],
      timeDimension: { type: "relative", lookback: "1h" },
    };
    if (false as boolean) {
      // @ts-expect-error LogRawQuery is not TraceRawQuery
      void client.queryTracesRaw(logRaw);
    }
    void logRaw;
    expect(true).toBe(true);
  });

  it("queryTracesAggregate return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryTracesAggregate>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: kopaiQuery.KopaiAggregateRow[];
    }>();
  });

  it("queryTracesAggregate rejects non-trace-aggregate input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const traceRaw: kopaiQuery.TraceRawQuery = {
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      timeDimension: { type: "relative", lookback: "1h" },
    };
    if (false as boolean) {
      // @ts-expect-error TraceRawQuery is not TraceAggregateQuery
      void client.queryTracesAggregate(traceRaw);
    }
    void traceRaw;
    expect(true).toBe(true);
  });

  it("queryLogsRaw return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryLogsRaw>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: OtelLogsRow[];
      nextCursor: string | null;
    }>();
  });

  it("queryLogsRaw rejects non-log-raw input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const traceRaw: kopaiQuery.TraceRawQuery = {
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      timeDimension: { type: "relative", lookback: "1h" },
    };
    if (false as boolean) {
      // @ts-expect-error TraceRawQuery is not LogRawQuery
      void client.queryLogsRaw(traceRaw);
    }
    void traceRaw;
    expect(true).toBe(true);
  });

  it("queryLogsAggregate return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryLogsAggregate>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: kopaiQuery.KopaiAggregateRow[];
    }>();
  });

  it("queryLogsAggregate rejects non-log-aggregate input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const traceAgg: kopaiQuery.TraceAggregateQuery = {
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    };
    if (false as boolean) {
      // @ts-expect-error TraceAggregateQuery is not LogAggregateQuery
      void client.queryLogsAggregate(traceAgg);
    }
    void traceAgg;
    expect(true).toBe(true);
  });

  it("queryMetricsRaw return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryMetricsRaw>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: OtelMetricsRow[];
      nextCursor: string | null;
    }>();
  });

  it("queryMetricsRaw rejects non-metric-raw input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const logRaw: kopaiQuery.LogRawQuery = {
      signal: "logs",
      mode: "raw",
      dimensions: ["Body"],
      timeDimension: { type: "relative", lookback: "1h" },
    };
    if (false as boolean) {
      // @ts-expect-error LogRawQuery is not MetricRawQuery
      void client.queryMetricsRaw(logRaw);
    }
    void logRaw;
    expect(true).toBe(true);
  });

  it("queryMetricsAggregate return type is exact", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = ReturnType<typeof _client.queryMetricsAggregate>;
    expectTypeOf<Awaited<R>>().toEqualTypeOf<{
      data: kopaiQuery.KopaiAggregateRow[];
    }>();
  });

  it("queryMetricsAggregate rejects non-metric-aggregate input", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    const logAgg: kopaiQuery.LogAggregateQuery = {
      signal: "logs",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    };
    if (false as boolean) {
      // @ts-expect-error LogAggregateQuery is not MetricAggregateQuery
      void client.queryMetricsAggregate(logAgg);
    }
    void logAgg;
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: polymorphic query() dispatcher (Phase A1)
// ============================================================
describe("KopaiClient.query polymorphic types", () => {
  it("narrows return type for TraceRawQuery", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = Awaited<
      ReturnType<typeof _client.query<kopaiQuery.TraceRawQuery>>
    >;
    expectTypeOf<R>().toEqualTypeOf<{
      data: OtelTracesRow[];
      nextCursor: string | null;
    }>();
  });

  it("narrows return type for TraceAggregateQuery (summary)", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    // Narrow the aggregate variant to the summary output so the conditional
    // in KopaiQueryResult resolves past the output.type discriminator.
    type Q = kopaiQuery.TraceAggregateQuery & {
      output: { type: "summary" };
    };
    type R = Awaited<ReturnType<typeof _client.query<Q>>>;
    expectTypeOf<R>().toEqualTypeOf<{ data: kopaiQuery.KopaiAggregateRow[] }>();
  });

  it("narrows return type for LogRawQuery", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = Awaited<ReturnType<typeof _client.query<kopaiQuery.LogRawQuery>>>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: OtelLogsRow[];
      nextCursor: string | null;
    }>();
  });

  it("narrows return type for LogAggregateQuery (summary)", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type Q = kopaiQuery.LogAggregateQuery & { output: { type: "summary" } };
    type R = Awaited<ReturnType<typeof _client.query<Q>>>;
    expectTypeOf<R>().toEqualTypeOf<{ data: kopaiQuery.KopaiAggregateRow[] }>();
  });

  it("narrows return type for MetricRawQuery", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type R = Awaited<
      ReturnType<typeof _client.query<kopaiQuery.MetricRawQuery>>
    >;
    expectTypeOf<R>().toEqualTypeOf<{
      data: OtelMetricsRow[];
      nextCursor: string | null;
    }>();
  });

  it("narrows return type for MetricAggregateQuery (summary)", () => {
    const _client = new KopaiClient({ baseUrl: "https://x.test" });
    type Q = kopaiQuery.MetricAggregateQuery & { output: { type: "summary" } };
    type R = Awaited<ReturnType<typeof _client.query<Q>>>;
    expectTypeOf<R>().toEqualTypeOf<{ data: kopaiQuery.KopaiAggregateRow[] }>();
  });

  it("rejects shape missing the signal/mode discriminator", () => {
    const client = new KopaiClient({ baseUrl: "https://x.test" });
    if (false as boolean) {
      // @ts-expect-error object lacks signal+mode discriminator; not a KopaiQuery variant
      void client.query({ dimensions: ["SpanId"] });
    }
    expect(true).toBe(true);
  });
});
