import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { datasource, dashboardDatasource } from "@kopai/core";
import { mcpPlugin } from "../plugin.js";

type TelemetryDs = datasource.ReadTelemetryDatasource;
type DashboardDs = dashboardDatasource.DynamicDashboardDatasource;

function makeTelemetry(): TelemetryDs {
  return {
    getTraces: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    getLogs: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    getMetrics: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    getAggregatedMetrics: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null }),
    discoverMetrics: vi.fn().mockResolvedValue({ metrics: [] }),
    getServices: vi.fn().mockResolvedValue({ services: ["svc-a"] }),
    getOperations: vi.fn().mockResolvedValue({ operations: [] }),
    getTraceSummaries: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null }),
  };
}

function makeDashboards(): DashboardDs {
  return {
    getDashboard: vi.fn(),
    createDashboard: vi.fn(),
    searchDashboards: vi.fn(),
  };
}

async function postMcp(server: FastifyInstance, body: object) {
  return server.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    payload: JSON.stringify(body),
  });
}

function parseJsonRpcResponse(body: string): unknown {
  // Streamable HTTP may return JSON or SSE. Try JSON first, then extract from SSE.
  try {
    return JSON.parse(body);
  } catch {
    const dataLine = body.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      throw new Error(`unexpected response body: ${body}`);
    }
    return JSON.parse(dataLine.slice("data:".length).trim());
  }
}

describe("mcpPlugin", () => {
  let server: FastifyInstance;
  let telemetry: TelemetryDs;
  let dashboards: DashboardDs;

  beforeEach(async () => {
    telemetry = makeTelemetry();
    dashboards = makeDashboards();
    server = Fastify();
    await server.register(mcpPlugin, {
      readTelemetryDatasource: telemetry,
      dynamicDashboardDatasource: dashboards,
      promptInstructions: "# schema",
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("lists all 12 MCP tools", async () => {
    const res = await postMcp(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(res.statusCode, `body: ${res.body}`).toBe(200);

    const parsed = parseJsonRpcResponse(res.body) as {
      result: { tools: Array<{ name: string }> };
    };
    const toolNames = parsed.result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(
      [
        "kopai_create_dashboard",
        "kopai_discover_metrics",
        "kopai_get_dashboard",
        "kopai_get_dashboard_schema",
        "kopai_get_operations",
        "kopai_get_services",
        "kopai_get_trace",
        "kopai_search_dashboards",
        "kopai_search_logs",
        "kopai_search_metrics",
        "kopai_search_trace_summaries",
        "kopai_search_traces",
      ].sort()
    );
  });

  it("invoking get_services calls the datasource and returns the services", async () => {
    const res = await postMcp(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kopai_get_services", arguments: {} },
    });
    expect(res.statusCode, `body: ${res.body}`).toBe(200);
    expect(telemetry.getServices).toHaveBeenCalled();
    expect(res.body).toContain("svc-a");
  });
});
