import { describe, it, expect, vi } from "vitest";
import type { datasource } from "@kopai/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTraceTools } from "../tools/traces.js";
import { connectTestClient, parseJsonContent } from "./helpers.js";

type Ds = datasource.ReadTracesDatasource & datasource.ReadTracesMetaDatasource;

function buildTestServer(ds: Ds) {
  const server = new McpServer({ name: "test", version: "0" });
  registerTraceTools(server, ds);
  return server;
}

function makeDs(): {
  ds: Ds;
  getTraces: ReturnType<typeof vi.fn<Ds["getTraces"]>>;
  getServices: ReturnType<typeof vi.fn<Ds["getServices"]>>;
  getOperations: ReturnType<typeof vi.fn<Ds["getOperations"]>>;
  getTraceSummaries: ReturnType<typeof vi.fn<Ds["getTraceSummaries"]>>;
} {
  const getTraces = vi.fn<Ds["getTraces"]>();
  const getServices = vi.fn<Ds["getServices"]>();
  const getOperations = vi.fn<Ds["getOperations"]>();
  const getTraceSummaries = vi.fn<Ds["getTraceSummaries"]>();
  return {
    ds: { getTraces, getServices, getOperations, getTraceSummaries },
    getTraces,
    getServices,
    getOperations,
    getTraceSummaries,
  };
}

describe("traces mcp tools", () => {
  it("get_trace returns spans for a traceId", async () => {
    const { ds, getTraces } = makeDs();
    const span = {
      SpanId: "s1",
      TraceId: "t1",
      Timestamp: "1700000000000000000",
      ServiceName: "svc",
      SpanName: "op",
    };
    getTraces.mockResolvedValue({ data: [span], nextCursor: null });

    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_get_trace",
      arguments: { traceId: "t1" },
    });

    expect(getTraces).toHaveBeenCalledWith({ traceId: "t1" });
    expect(parseJsonContent(res)).toEqual({ data: [span] });
    expect(res.structuredContent).toEqual({ data: [span] });
  });

  it("search_traces forwards the filter body", async () => {
    const { ds, getTraces } = makeDs();
    getTraces.mockResolvedValue({ data: [], nextCursor: "next" });

    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_search_traces",
      arguments: { serviceName: "svc" },
    });

    expect(getTraces).toHaveBeenCalledWith({ serviceName: "svc" });
    expect(parseJsonContent(res)).toEqual({ data: [], nextCursor: "next" });
  });

  it("get_services returns the services list", async () => {
    const { ds, getServices } = makeDs();
    getServices.mockResolvedValue({ services: ["a", "b"] });

    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_get_services",
      arguments: {},
    });

    expect(getServices).toHaveBeenCalledWith({});
    expect(parseJsonContent(res)).toEqual({ services: ["a", "b"] });
  });

  it("get_operations requires serviceName and passes it through", async () => {
    const { ds, getOperations } = makeDs();
    getOperations.mockResolvedValue({ operations: ["op1"] });

    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_get_operations",
      arguments: { serviceName: "svc" },
    });

    expect(getOperations).toHaveBeenCalledWith({ serviceName: "svc" });
    expect(parseJsonContent(res)).toEqual({ operations: ["op1"] });
  });

  it("search_trace_summaries forwards the filter body", async () => {
    const { ds, getTraceSummaries } = makeDs();
    getTraceSummaries.mockResolvedValue({ data: [], nextCursor: null });

    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_search_trace_summaries",
      arguments: { serviceName: "svc", limit: 5, sortOrder: "ASC" },
    });

    expect(getTraceSummaries).toHaveBeenCalledWith({
      serviceName: "svc",
      limit: 5,
      sortOrder: "ASC",
    });
    expect(parseJsonContent(res)).toEqual({ data: [], nextCursor: null });
  });

  it("get_trace rejects when traceId missing (Zod validation)", async () => {
    const { ds } = makeDs();
    const client = await connectTestClient(buildTestServer(ds));
    const res = await client.callTool({
      name: "kopai_get_trace",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });
});
