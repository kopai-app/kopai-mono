import { describe, it, expect, vi } from "vitest";
import type { datasource } from "@kopai/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMetricTools } from "../tools/metrics.js";
import { connectTestClient, parseJsonContent } from "./helpers.js";

type Ds = datasource.ReadMetricsDatasource;

function makeDs(): {
  ds: Ds;
  getMetrics: ReturnType<typeof vi.fn<Ds["getMetrics"]>>;
  getAggregatedMetrics: ReturnType<typeof vi.fn<Ds["getAggregatedMetrics"]>>;
  discoverMetrics: ReturnType<typeof vi.fn<Ds["discoverMetrics"]>>;
} {
  const getMetrics = vi.fn<Ds["getMetrics"]>();
  const getAggregatedMetrics = vi.fn<Ds["getAggregatedMetrics"]>();
  const discoverMetrics = vi.fn<Ds["discoverMetrics"]>();
  return {
    ds: { getMetrics, getAggregatedMetrics, discoverMetrics },
    getMetrics,
    getAggregatedMetrics,
    discoverMetrics,
  };
}

function buildServer(ds: Ds) {
  const s = new McpServer({ name: "test", version: "0" });
  registerMetricTools(s, ds);
  return s;
}

describe("metrics mcp tools", () => {
  it("search_metrics without aggregate calls getMetrics", async () => {
    const { ds, getMetrics, getAggregatedMetrics } = makeDs();
    getMetrics.mockResolvedValue({ data: [], nextCursor: null });

    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_search_metrics",
      arguments: { metricType: "Gauge", metricName: "cpu" },
    });

    expect(getMetrics).toHaveBeenCalledWith({
      metricType: "Gauge",
      metricName: "cpu",
    });
    expect(getAggregatedMetrics).not.toHaveBeenCalled();
    expect(parseJsonContent(res)).toEqual({ data: [], nextCursor: null });
  });

  it("search_metrics with aggregate calls getAggregatedMetrics", async () => {
    const { ds, getMetrics, getAggregatedMetrics } = makeDs();
    getAggregatedMetrics.mockResolvedValue({ data: [], nextCursor: null });

    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_search_metrics",
      arguments: { metricType: "Gauge", aggregate: "sum" },
    });

    expect(getAggregatedMetrics).toHaveBeenCalledWith({
      metricType: "Gauge",
      aggregate: "sum",
    });
    expect(getMetrics).not.toHaveBeenCalled();
    expect(parseJsonContent(res)).toEqual({ data: [], nextCursor: null });
  });

  it("discover_metrics returns the discovery payload", async () => {
    const { ds, discoverMetrics } = makeDs();
    discoverMetrics.mockResolvedValue({ metrics: [] });

    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_discover_metrics",
      arguments: {},
    });

    expect(discoverMetrics).toHaveBeenCalledWith({});
    expect(parseJsonContent(res)).toEqual({ metrics: [] });
  });
});
