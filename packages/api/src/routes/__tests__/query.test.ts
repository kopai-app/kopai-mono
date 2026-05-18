import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { datasource } from "@kopai/core";
import { signalsRoutes } from "../../index.js";

/**
 * Endpoint contract tests for `POST /signals/{traces,logs,metrics}/query`.
 *
 * With the datasource wiring landed, valid bodies now return 200 with the
 * `{ rows, cursor }` envelope (`cursor` omitted for aggregated queries).
 * Invalid bodies are still rejected with a 400 RFC-7807 envelope.
 */
describe("KopaiQuery endpoints — happy path + 400 contract", () => {
  let server: FastifyInstance;

  const executeTracesQuery = vi
    .fn<datasource.ReadTracesDatasource["executeTracesQuery"]>()
    .mockResolvedValue({ rows: [], cursor: null, isAgg: false });
  const executeLogsQuery = vi
    .fn<datasource.ReadLogsDatasource["executeLogsQuery"]>()
    .mockResolvedValue({ rows: [], cursor: null, isAgg: false });
  const executeMetricsQuery = vi
    .fn<datasource.ReadMetricsDatasource["executeMetricsQuery"]>()
    .mockResolvedValue({ rows: [], cursor: null, isAgg: false });

  beforeEach(async () => {
    executeTracesQuery.mockClear();
    executeLogsQuery.mockClear();
    executeMetricsQuery.mockClear();
    executeTracesQuery.mockResolvedValue({
      rows: [],
      cursor: null,
      isAgg: false,
    });
    executeLogsQuery.mockResolvedValue({
      rows: [],
      cursor: null,
      isAgg: false,
    });
    executeMetricsQuery.mockResolvedValue({
      rows: [],
      cursor: null,
      isAgg: false,
    });
    const noop = vi.fn();
    server = Fastify();
    await server.register(signalsRoutes, {
      readTelemetryDatasource: {
        getTraces:
          noop as unknown as datasource.ReadTracesDatasource["getTraces"],
        executeTracesQuery,
        getLogs: noop as unknown as datasource.ReadLogsDatasource["getLogs"],
        executeLogsQuery,
        getMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["getMetrics"],
        getAggregatedMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["getAggregatedMetrics"],
        discoverMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["discoverMetrics"],
        executeMetricsQuery,
        getServices:
          noop as unknown as datasource.ReadTracesMetaDatasource["getServices"],
        getOperations:
          noop as unknown as datasource.ReadTracesMetaDatasource["getOperations"],
        getTraceSummaries:
          noop as unknown as datasource.ReadTracesMetaDatasource["getTraceSummaries"],
      },
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /signals/traces/query", () => {
    const validBody = {
      signal: "traces" as const,
      select: {
        id: { kind: "col" as const, name: "traceId" },
      },
    };

    it("registers the route", () => {
      expect(
        server.hasRoute({ method: "POST", url: "/signals/traces/query" })
      ).toBe(true);
    });

    it("returns 200 + { rows, cursor } for a schema-valid non-agg body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ rows: [], cursor: null });
      expect(executeTracesQuery).toHaveBeenCalledOnce();
    });

    it("returns 200 + { rows } (no cursor key) for an aggregated body", async () => {
      executeTracesQuery.mockResolvedValueOnce({
        rows: [{ c: 7 }],
        cursor: null,
        isAgg: true,
      });
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: {
          signal: "traces",
          select: { c: { kind: "agg", fn: "count" } },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toEqual({ rows: [{ c: 7 }] });
      expect(body).not.toHaveProperty("cursor");
    });

    it("returns 400 for missing select", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: { signal: "traces" },
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

    it("returns 400 for an unknown column name", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: {
          signal: "traces",
          select: {
            id: { kind: "col", name: "definitelyNotAColumn" },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
      });
    });
  });

  describe("POST /signals/logs/query", () => {
    const validBody = {
      signal: "logs" as const,
      select: {
        when: { kind: "col" as const, name: "timestamp" },
      },
    };

    it("registers the route", () => {
      expect(
        server.hasRoute({ method: "POST", url: "/signals/logs/query" })
      ).toBe(true);
    });

    it("returns 200 + { rows, cursor } for a schema-valid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ rows: [], cursor: null });
      expect(executeLogsQuery).toHaveBeenCalledOnce();
    });

    it("returns 400 for missing select", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/query",
        payload: { signal: "logs" },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
    });

    it("returns 400 for an unknown column name", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/query",
        payload: {
          signal: "logs",
          select: {
            x: { kind: "col", name: "definitelyNotAColumn" },
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /signals/metrics/query", () => {
    const validBody = {
      signal: "metrics" as const,
      metricType: "gauge" as const,
      select: {
        v: { kind: "col" as const, name: "value" },
      },
    };

    it("registers the route", () => {
      expect(
        server.hasRoute({ method: "POST", url: "/signals/metrics/query" })
      ).toBe(true);
    });

    it("returns 200 + { rows, cursor } for a schema-valid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ rows: [], cursor: null });
      expect(executeMetricsQuery).toHaveBeenCalledOnce();
    });

    it("returns 400 for missing metricType (discriminator)", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/query",
        payload: {
          signal: "metrics",
          select: { v: { kind: "col", name: "value" } },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
    });

    it("returns 400 for an unknown column for the chosen metricType", async () => {
      // 'value' is invalid on Histogram (gauge/sum only).
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/query",
        payload: {
          signal: "metrics",
          metricType: "histogram",
          select: { v: { kind: "col", name: "value" } },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("datasource error → status mapping", () => {
    it("maps a thrown Error with code='NOT_IMPLEMENTED' to RFC-7807 501", async () => {
      executeTracesQuery.mockRejectedValueOnce(
        Object.assign(new Error("translator can't do percentiles yet"), {
          code: "NOT_IMPLEMENTED" as const,
        })
      );
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: {
          signal: "traces",
          select: { id: { kind: "col", name: "traceId" } },
        },
      });
      expect(response.statusCode).toBe(501);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-not-implemented",
        status: 501,
        title: "Not Implemented",
        detail: "translator can't do percentiles yet",
      });
    });

    it("maps a thrown Error with code='BAD_REQUEST' to RFC-7807 400", async () => {
      executeTracesQuery.mockRejectedValueOnce(
        Object.assign(new Error("malformed cursor"), {
          code: "BAD_REQUEST" as const,
        })
      );
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: {
          signal: "traces",
          select: { id: { kind: "col", name: "traceId" } },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
        detail: "malformed cursor",
      });
    });
  });
});
