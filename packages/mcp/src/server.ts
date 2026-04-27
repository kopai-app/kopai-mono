import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { datasource, dashboardDatasource } from "@kopai/core";
import { registerTraceTools } from "./tools/traces.js";
import { registerLogTools } from "./tools/logs.js";
import { registerMetricTools } from "./tools/metrics.js";
import { registerDashboardTools } from "./tools/dashboards.js";

export interface McpServerDeps {
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  dynamicDashboardDatasource: dashboardDatasource.DynamicDashboardDatasource;
  promptInstructions?: string;
}

export function buildMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer({ name: "kopai-mcp", version: "0.1.0" });
  registerTraceTools(server, deps.readTelemetryDatasource);
  registerLogTools(server, deps.readTelemetryDatasource);
  registerMetricTools(server, deps.readTelemetryDatasource);
  registerDashboardTools(
    server,
    deps.dynamicDashboardDatasource,
    deps.promptInstructions
  );
  return server;
}
