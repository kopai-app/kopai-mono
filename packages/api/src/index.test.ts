import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { datasource, kopaiQuery } from "@kopai/core";
import { signalsRoutes } from "./index.js";
import { SignalsApiError } from "./routes/errors.js";

class TestSignalsApiError extends SignalsApiError {
  readonly code = "TEST_ERROR";
}

describe("apiRoutes", () => {
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
  // `query` is generic; vi.fn can't preserve the type parameter, so the
  // spy is modeled as the concrete projection and the readTelemetryDatasource
  // entry casts back to the generic interface signature.
  type QuerySpyFn = (
    q: kopaiQuery.KopaiQuery & { requestContext?: unknown }
  ) => Promise<unknown>;
  let querySpy: ReturnType<typeof vi.fn<QuerySpyFn>>;
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

  describe("POST /signals/traces/search", () => {
    const mockTrace = {
      SpanId: "abc123",
      TraceId: "trace-001",
      Timestamp: "1700000000000000000",
      ServiceName: "test-service",
      SpanName: "test-span",
    };

    it("returns traces and calls readTracesDatasource.getTraces", async () => {
      getTracesSpy.mockResolvedValue({ data: [mockTrace], nextCursor: "abc" });

      const filter = { serviceName: "test-service" };
      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockTrace], nextCursor: "abc" });
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
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        title: "Internal server error",
      });
    });

    it("returns 422 with remedies for a ClickHouse resource limit", async () => {
      getTracesSpy.mockRejectedValue(
        Object.assign(new Error("Timeout exceeded: elapsed 30.1 seconds"), {
          code: "159",
          type: "TIMEOUT_EXCEEDED",
        })
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-query-too-expensive",
        status: 422,
        title: "Query too expensive",
      });
      expect(body.detail).toMatch(/time window/);
      expect(body.detail).toMatch(/`Count`/);
      expect(body.detail).not.toMatch(/elapsed|TIMEOUT_EXCEEDED/);
    });

    // Pins the code list. It is mirrored in @kopai/mcp (`limits.ts`, tested in
    // its `tools.test.ts`); a code added to one copy and not the other would
    // give REST and MCP callers different outcomes.
    it.each([
      ["158", "TOO_MANY_ROWS"],
      ["159", "TIMEOUT_EXCEEDED"],
      ["160", "TOO_SLOW"],
      ["241", "MEMORY_LIMIT_EXCEEDED"],
      ["307", "TOO_MANY_BYTES"],
      ["396", "TOO_MANY_ROWS_OR_BYTES"],
    ])("returns 422 for ClickHouse code %s (%s)", async (code, type) => {
      getTracesSpy.mockRejectedValue(
        Object.assign(new Error(`limit reached (${type})`), { code, type })
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(422);
    });

    it("keeps a ClickHouse error with another code a 500", async () => {
      getTracesSpy.mockRejectedValue(
        Object.assign(new Error("Table does not exist (UNKNOWN_TABLE)"), {
          code: "60",
          type: "UNKNOWN_TABLE",
        })
      );

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
    });

    it.each([
      // Fires for a hung server as well as a heavy query.
      ["the client's request timeout", new Error("Timeout error.")],
      [
        "a server-wide memory limit",
        Object.assign(
          new Error("Memory limit (total) exceeded: would use 28.10 GiB"),
          { code: "241", type: "MEMORY_LIMIT_EXCEEDED" }
        ),
      ],
    ])("keeps %s a 500", async (_, thrown) => {
      getTracesSpy.mockRejectedValue(thrown);

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
    });

    it("returns null nextCursor when no more pages", async () => {
      getTracesSpy.mockResolvedValue({ data: [mockTrace], nextCursor: null });

      const response = await server.inject({
        method: "POST",
        url: "/signals/traces/search",
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: [mockTrace], nextCursor: null });
    });
  });
});
