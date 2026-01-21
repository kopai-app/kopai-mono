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

  beforeEach(async () => {
    getTracesSpy = vi.fn<datasource.ReadTracesDatasource["getTraces"]>();
    server = Fastify();
    await server.register(signalsRoutes, {
      readTracesDatasource: { getTraces: getTracesSpy },
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
      getTracesSpy.mockResolvedValue([mockTrace]);

      const filter = { serviceName: "test-service" };
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([mockTrace]);
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
});
