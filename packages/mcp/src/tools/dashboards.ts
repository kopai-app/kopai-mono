import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dashboardDatasource } from "@kopai/core";
import { jsonResult } from "./result.js";

export function registerDashboardTools(
  server: McpServer,
  ds: dashboardDatasource.DynamicDashboardDatasource,
  promptInstructions?: string
): void {
  server.registerTool(
    "kopai_get_dashboard_schema",
    {
      description:
        "Get UI tree schema as markdown prompt instructions for AI agents",
    },
    async () => {
      if (!promptInstructions) {
        return {
          isError: true,
          content: [{ type: "text", text: "Dashboard schema not configured" }],
        };
      }
      return {
        content: [{ type: "text", text: promptInstructions }],
      };
    }
  );

  server.registerTool(
    "kopai_create_dashboard",
    {
      description: "Create a dashboard containing a uiTree",
      inputSchema: dashboardDatasource.createDashboardParams,
    },
    async (args) => {
      const result = await ds.createDashboard(args);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_get_dashboard",
    {
      description: "Get a dashboard containing a uiTree to be rendered",
      inputSchema: z.object({ dashboardId: z.string() }),
    },
    async ({ dashboardId }) => {
      const result = await ds.getDashboard({ id: dashboardId });
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_search_dashboards",
    {
      description: "Search dashboards matching a filter",
      inputSchema: dashboardDatasource.searchDashboardsFilter,
    },
    async (args) => {
      const result = await ds.searchDashboards(args);
      return jsonResult(result);
    }
  );
}
