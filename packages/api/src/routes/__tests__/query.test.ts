import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { datasource } from "@kopai/core";
import { signalsRoutes } from "../../index.js";

/**
 * Endpoint contract tests for the new POST /signals/{traces,logs,metrics}/query
 * routes. The handlers are intentionally unimplemented in this PR (only the
 * schema + 501 wiring): valid bodies return 501 RFC-7807, invalid bodies are
 * rejected by the Fastify validator with a 400 RFC-7807 envelope.
 */
describe("KopaiQuery endpoints (501 + 400 contract)", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const noop = vi.fn();
    server = Fastify();
    await server.register(signalsRoutes, {
      readTelemetryDatasource: {
        getTraces:
          noop as unknown as datasource.ReadTracesDatasource["getTraces"],
        getLogs: noop as unknown as datasource.ReadLogsDatasource["getLogs"],
        getMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["getMetrics"],
        getAggregatedMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["getAggregatedMetrics"],
        discoverMetrics:
          noop as unknown as datasource.ReadMetricsDatasource["discoverMetrics"],
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

    it("returns 501 RFC-7807 for a schema-valid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(501);
      const body = response.json();
      expect(body).toEqual(
        expect.objectContaining({
          type: expect.any(String),
          title: expect.any(String),
          status: 501,
          detail: expect.any(String),
        })
      );
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

    it("returns 501 RFC-7807 for a schema-valid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/logs/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json()).toEqual(
        expect.objectContaining({
          type: expect.any(String),
          title: expect.any(String),
          status: 501,
          detail: expect.any(String),
        })
      );
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

    it("returns 501 RFC-7807 for a schema-valid body", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/signals/metrics/query",
        payload: validBody,
      });

      expect(response.statusCode).toBe(501);
      expect(response.json()).toEqual(
        expect.objectContaining({
          type: expect.any(String),
          title: expect.any(String),
          status: 501,
          detail: expect.any(String),
        })
      );
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
});
