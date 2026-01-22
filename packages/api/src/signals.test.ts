import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { datasource } from "@kopai/core";
import { signalsRoutes } from "./index.js";
import { SignalsApiError } from "./routes/errors.js";

class TestSignalsApiError extends SignalsApiError {
  readonly code = "TEST_ERROR";
}

describe("signalsRoutes", () => {
  let server: FastifyInstance;
  let getTracesSpy: ReturnType<
    typeof vi.fn<datasource.ReadTracesDatasource["getTraces"]>
  >;
  let getLogsSpy: ReturnType<
    typeof vi.fn<datasource.ReadLogsDatasource["getLogs"]>
  >;
  let getMetricsSpy: ReturnType<
    typeof vi.fn<datasource.ReadMetricsDatasource["getMetrics"]>
  >;

  beforeEach(async () => {
    getTracesSpy = vi.fn<datasource.ReadTracesDatasource["getTraces"]>();
    getLogsSpy = vi.fn<datasource.ReadLogsDatasource["getLogs"]>();
    getMetricsSpy = vi.fn<datasource.ReadMetricsDatasource["getMetrics"]>();
    server = Fastify();
    await server.register(signalsRoutes, {
      readTelemetryDatasource: {
        getTraces: getTracesSpy,
        getLogs: getLogsSpy,
        getMetrics: getMetricsSpy,
      },
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /signals/traces/search", () => {
    const mockTrace = {
      SpanId: "abc123",
      TraceId: "trace-001",
      Timestamp: 1700000000000000000,
      ServiceName: "test-service",
      SpanName: "test-span",
    };

    it("returns traces and calls readTracesDatasource.getTraces", async () => {
      getTracesSpy.mockResolvedValue({ data: [mockTrace], nextCursor: null });

      const filter = { serviceName: "test-service" };
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockTrace], nextCursor: null });
      expect(getTracesSpy).toHaveBeenCalledWith(filter);
    });

    it("returns 400 for invalid body", async () => {
      // traceId should be string, not number
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: { traceId: 123 },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error", // TODO: document error
        status: 400,
        title: "Invalid data",
      });
      expect(body.detail).toBeDefined();
    });

    it("returns 400 for invalid JSON", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        headers: { "content-type": "application/json" },
        payload: "{ invalid json }",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
    });

    it("returns 500 for SignalsApiError", async () => {
      getTracesSpy.mockRejectedValue(
        new TestSignalsApiError("Database connection failed")
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error", // TODO: document error
        status: 500,
        title: "Internal server error",
        detail: "Database connection failed",
      });
    });

    it("returns 500 generic for unexpected error", async () => {
      getTracesSpy.mockRejectedValue(new Error("Unexpected failure"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal Server Error" });
    });
  });

  describe("POST /signals/logs/search", () => {
    const mockLog = {
      Timestamp: 1700000000000,
      TraceId: "trace-001",
      SpanId: "span-001",
      SeverityText: "INFO",
      SeverityNumber: 9,
      Body: "Test log message",
      ServiceName: "test-service",
    };

    it("returns logs and calls readLogsDatasource.getLogs", async () => {
      getLogsSpy.mockResolvedValue({ data: [mockLog], nextCursor: null });

      const filter = { serviceName: "test-service" };
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockLog], nextCursor: null });
      expect(getLogsSpy).toHaveBeenCalledWith(filter);
    });

    it("returns 400 for invalid body", async () => {
      // traceId should be string, not number
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/search",
        payload: { traceId: 123 },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
      expect(body.detail).toBeDefined();
    });
  });

  describe("POST /signals/metrics/search", () => {
    const mockMetric = {
      MetricType: "Gauge" as const,
      TimeUnix: 1700000000000,
      StartTimeUnix: 1700000000000,
      MetricName: "cpu_usage",
      Value: 42.5,
      ServiceName: "test-service",
    };

    it("returns metrics and calls readMetricsDatasource.getMetrics", async () => {
      getMetricsSpy.mockResolvedValue({ data: [mockMetric], nextCursor: null });

      const filter = { serviceName: "test-service" };
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockMetric], nextCursor: null });
      expect(getMetricsSpy).toHaveBeenCalledWith(filter);
    });

    it("returns 400 for invalid body", async () => {
      // metricType should be string enum, not number
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/search",
        payload: { metricType: 123 },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
      expect(body.detail).toBeDefined();
    });

    it("returns 500 for SignalsApiError", async () => {
      getMetricsSpy.mockRejectedValue(
        new TestSignalsApiError("Database connection failed")
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        title: "Internal server error",
        detail: "Database connection failed",
      });
    });

    it("returns 500 generic for unexpected error", async () => {
      getMetricsSpy.mockRejectedValue(new Error("Unexpected failure"));

      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal Server Error" });
    });
  });
});
