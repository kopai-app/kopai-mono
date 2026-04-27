import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataFilterSchemas, type datasource } from "@kopai/core";
import { jsonResult } from "./result.js";

export function registerMetricTools(
  server: McpServer,
  ds: datasource.ReadMetricsDatasource
): void {
  server.registerTool(
    "kopai_search_metrics",
    {
      description:
        "Search metrics matching a filter. When 'aggregate' is set, returns aggregated results; otherwise returns raw data points.",
      inputSchema: dataFilterSchemas.metricsDataFilterSchema,
    },
    async (args) => {
      const result = args.aggregate
        ? await ds.getAggregatedMetrics(args)
        : await ds.getMetrics(args);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_discover_metrics",
    { description: "Discover available metrics and their attributes" },
    async () => {
      const result = await ds.discoverMetrics({});
      return jsonResult(result);
    }
  );
}
