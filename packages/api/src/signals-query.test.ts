import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { datasource, kopaiQuery } from "@kopai/core";
import { signalsRoutes } from "./index.js";
import { SignalsApiError } from "./routes/errors.js";

class TestSignalsApiError extends SignalsApiError {
  readonly code = "TEST_ERROR";
}

// Per-signal valid bodies. These are minimal but satisfy the
// discriminated-union schema in kopai-query.ts.
const validTraceRaw: kopaiQuery.TraceRawQuery = {
  signal: "traces",
  mode: "raw",
  dimensions: ["SpanId"],
  timeDimension: { type: "relative", lookback: "1h" },
};

const validTraceAggregate: kopaiQuery.TraceAggregateQuery = {
  signal: "traces",
  mode: "aggregate",
  measures: [{ op: "COUNT", as: "c" }],
  timeDimension: { type: "relative", lookback: "1h" },
  output: { type: "summary" },
};

const validLogRaw: kopaiQuery.LogRawQuery = {
  signal: "logs",
  mode: "raw",
  dimensions: ["Body"],
  timeDimension: { type: "relative", lookback: "1h" },
};

const validLogAggregate: kopaiQuery.LogAggregateQuery = {
  signal: "logs",
  mode: "aggregate",
  measures: [{ op: "COUNT", as: "c" }],
  timeDimension: { type: "relative", lookback: "1h" },
  output: { type: "summary" },
};

const validMetricRaw: kopaiQuery.MetricRawQuery = {
  signal: "metrics",
  mode: "raw",
  dimensions: ["MetricName"],
  timeDimension: { type: "relative", lookback: "1h" },
};

const validMetricAggregate: kopaiQuery.MetricAggregateQuery = {
  signal: "metrics",
  mode: "aggregate",
  measures: [{ op: "COUNT", as: "c" }],
  timeDimension: { type: "relative", lookback: "1h" },
  output: { type: "summary" },
};

describe("signals query routes", () => {
  let server: FastifyInstance;
  // Legacy/meta spies (unused by these tests but required to satisfy the
  // datasource interface).
  let getTracesSpy: ReturnType<
    typeof vi.fn<datasource.ReadTracesDatasource["getTraces"]>
  >;
  let getLogsSpy: ReturnType<
    typeof vi.fn<datasource.ReadLogsDatasource["getLogs"]>
  >;
  let getMetricsSpy: ReturnType<
    typeof vi.fn<datasource.ReadMetricsDatasource["getMetrics"]>
  >;
  let getAggregatedMetricsSpy: ReturnType<
    typeof vi.fn<datasource.ReadMetricsDatasource["getAggregatedMetrics"]>
  >;
  let discoverMetricsSpy: ReturnType<
    typeof vi.fn<datasource.ReadMetricsDatasource["discoverMetrics"]>
  >;
  let getServicesSpy: ReturnType<
    typeof vi.fn<datasource.ReadTracesMetaDatasource["getServices"]>
  >;
  let getOperationsSpy: ReturnType<
    typeof vi.fn<datasource.ReadTracesMetaDatasource["getOperations"]>
  >;
  let getTraceSummariesSpy: ReturnType<
    typeof vi.fn<datasource.ReadTracesMetaDatasource["getTraceSummaries"]>
  >;
  // Generic `query` — same shape used in other tests.
  type QuerySpyFn = (
    q: kopaiQuery.KopaiQuery & { requestContext?: unknown }
  ) => Promise<unknown>;
  let querySpy: ReturnType<typeof vi.fn<QuerySpyFn>>;

  // The new narrow query spies.
  let queryTracesRawSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryTracesRaw"]>
  >;
  let queryTracesAggregateSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryTracesAggregate"]>
  >;
  let queryLogsRawSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryLogsRaw"]>
  >;
  let queryLogsAggregateSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryLogsAggregate"]>
  >;
  let queryMetricsRawSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryMetricsRaw"]>
  >;
  let queryMetricsAggregateSpy: ReturnType<
    typeof vi.fn<datasource.ReadQueryDatasource["queryMetricsAggregate"]>
  >;

  beforeEach(async () => {
    getTracesSpy = vi.fn<datasource.ReadTracesDatasource["getTraces"]>();
    getLogsSpy = vi.fn<datasource.ReadLogsDatasource["getLogs"]>();
    getMetricsSpy = vi.fn<datasource.ReadMetricsDatasource["getMetrics"]>();
    getAggregatedMetricsSpy =
      vi.fn<datasource.ReadMetricsDatasource["getAggregatedMetrics"]>();
    discoverMetricsSpy =
      vi.fn<datasource.ReadMetricsDatasource["discoverMetrics"]>();
    getServicesSpy =
      vi.fn<datasource.ReadTracesMetaDatasource["getServices"]>();
    getOperationsSpy =
      vi.fn<datasource.ReadTracesMetaDatasource["getOperations"]>();
    getTraceSummariesSpy =
      vi.fn<datasource.ReadTracesMetaDatasource["getTraceSummaries"]>();
    querySpy = vi.fn<QuerySpyFn>();
    queryTracesRawSpy =
      vi.fn<datasource.ReadQueryDatasource["queryTracesRaw"]>();
    queryTracesAggregateSpy =
      vi.fn<datasource.ReadQueryDatasource["queryTracesAggregate"]>();
    queryLogsRawSpy = vi.fn<datasource.ReadQueryDatasource["queryLogsRaw"]>();
    queryLogsAggregateSpy =
      vi.fn<datasource.ReadQueryDatasource["queryLogsAggregate"]>();
    queryMetricsRawSpy =
      vi.fn<datasource.ReadQueryDatasource["queryMetricsRaw"]>();
    queryMetricsAggregateSpy =
      vi.fn<datasource.ReadQueryDatasource["queryMetricsAggregate"]>();

    server = Fastify();
    await server.register(signalsRoutes, {
      readTelemetryDatasource: {
        getTraces: getTracesSpy,
        getLogs: getLogsSpy,
        getMetrics: getMetricsSpy,
        getAggregatedMetrics: getAggregatedMetricsSpy,
        discoverMetrics: discoverMetricsSpy,
        getServices: getServicesSpy,
        getOperations: getOperationsSpy,
        getTraceSummaries: getTraceSummariesSpy,
        query: querySpy as datasource.ReadQueryDatasource["query"],
        queryTracesRaw: queryTracesRawSpy,
        queryTracesAggregate: queryTracesAggregateSpy,
        queryLogsRaw: queryLogsRawSpy,
        queryLogsAggregate: queryLogsAggregateSpy,
        queryMetricsRaw: queryMetricsRawSpy,
        queryMetricsAggregate: queryMetricsAggregateSpy,
      },
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /signals/query/traces/raw", () => {
    const mockTrace = {
      SpanId: "abc123",
      TraceId: "trace-001",
      Timestamp: "1700000000000000000",
      ServiceName: "test-service",
      SpanName: "test-span",
    };

    it("returns rows + cursor and dispatches to queryTracesRaw", async () => {
      queryTracesRawSpy.mockResolvedValue({
        data: [mockTrace],
        nextCursor: null,
      });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/raw",
        payload: validTraceRaw,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockTrace], nextCursor: null });
      expect(queryTracesRawSpy).toHaveBeenCalledTimes(1);
      const arg = queryTracesRawSpy.mock.calls[0]?.[0];
      expect(arg).toMatchObject(validTraceRaw);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/raw",
        payload: { signal: "traces", mode: "raw" },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
      expect(body.detail).toBeDefined();
      expect(queryTracesRawSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryTracesRawSpy.mockRejectedValue(new TestSignalsApiError("Boom"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/raw",
        payload: validTraceRaw,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        title: "Internal server error",
        detail: "Boom",
      });
    });
  });

  describe("POST /signals/query/traces/aggregate", () => {
    it("returns rows and dispatches to queryTracesAggregate", async () => {
      queryTracesAggregateSpy.mockResolvedValue({
        data: [{ c: 42 }],
      });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/aggregate",
        payload: validTraceAggregate,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [{ c: 42 }] });
      expect(queryTracesAggregateSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/aggregate",
        payload: { signal: "traces", mode: "aggregate" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
      });
      expect(queryTracesAggregateSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryTracesAggregateSpy.mockRejectedValue(
        new TestSignalsApiError("Boom")
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/traces/aggregate",
        payload: validTraceAggregate,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        detail: "Boom",
      });
    });
  });

  describe("POST /signals/query/logs/raw", () => {
    const mockLog = {
      Timestamp: "1700000000000000000",
      TraceId: "trace-001",
      SpanId: "span-001",
      SeverityText: "INFO",
      SeverityNumber: 9,
      Body: "Test log",
      ServiceName: "test-service",
    };

    it("returns rows + cursor and dispatches to queryLogsRaw", async () => {
      queryLogsRawSpy.mockResolvedValue({
        data: [mockLog],
        nextCursor: null,
      });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/raw",
        payload: validLogRaw,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockLog], nextCursor: null });
      expect(queryLogsRawSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/raw",
        payload: { signal: "logs", mode: "raw" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
      });
      expect(queryLogsRawSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryLogsRawSpy.mockRejectedValue(new TestSignalsApiError("Boom"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/raw",
        payload: validLogRaw,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        detail: "Boom",
      });
    });
  });

  describe("POST /signals/query/logs/aggregate", () => {
    it("returns rows and dispatches to queryLogsAggregate", async () => {
      queryLogsAggregateSpy.mockResolvedValue({ data: [{ c: 1 }] });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/aggregate",
        payload: validLogAggregate,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [{ c: 1 }] });
      expect(queryLogsAggregateSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/aggregate",
        payload: { signal: "logs", mode: "aggregate" },
      });

      expect(response.statusCode).toBe(400);
      expect(queryLogsAggregateSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryLogsAggregateSpy.mockRejectedValue(new TestSignalsApiError("Boom"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/logs/aggregate",
        payload: validLogAggregate,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ detail: "Boom" });
    });
  });

  describe("POST /signals/query/metrics/raw", () => {
    const mockMetric = {
      MetricType: "Gauge" as const,
      TimeUnix: "1700000000000000000",
      StartTimeUnix: "1700000000000000000",
      MetricName: "cpu_usage",
      Value: 42.5,
      ServiceName: "test-service",
    };

    it("returns rows + cursor and dispatches to queryMetricsRaw", async () => {
      queryMetricsRawSpy.mockResolvedValue({
        data: [mockMetric],
        nextCursor: null,
      });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/raw",
        payload: validMetricRaw,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockMetric], nextCursor: null });
      expect(queryMetricsRawSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/raw",
        payload: { signal: "metrics", mode: "raw" },
      });

      expect(response.statusCode).toBe(400);
      expect(queryMetricsRawSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryMetricsRawSpy.mockRejectedValue(new TestSignalsApiError("Boom"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/raw",
        payload: validMetricRaw,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ detail: "Boom" });
    });
  });

  describe("POST /signals/query/metrics/aggregate", () => {
    it("returns rows and dispatches to queryMetricsAggregate", async () => {
      queryMetricsAggregateSpy.mockResolvedValue({ data: [{ c: 7 }] });

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/aggregate",
        payload: validMetricAggregate,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [{ c: 7 }] });
      expect(queryMetricsAggregateSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/aggregate",
        payload: { signal: "metrics", mode: "aggregate" },
      });

      expect(response.statusCode).toBe(400);
      expect(queryMetricsAggregateSpy).not.toHaveBeenCalled();
    });

    it("returns 500 envelope for SignalsApiError", async () => {
      queryMetricsAggregateSpy.mockRejectedValue(
        new TestSignalsApiError("Boom")
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/query/metrics/aggregate",
        payload: validMetricAggregate,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ detail: "Boom" });
    });
  });
});
