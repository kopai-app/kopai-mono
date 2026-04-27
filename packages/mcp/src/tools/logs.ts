import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataFilterSchemas, type datasource } from "@kopai/core";
import { jsonResult } from "./result.js";

export function registerLogTools(
  server: McpServer,
  ds: datasource.ReadLogsDatasource
): void {
  server.registerTool(
    "kopai_search_logs",
    {
      description: "Search logs matching a filter",
      inputSchema: dataFilterSchemas.logsDataFilterSchema,
    },
    async (args) => {
      const result = await ds.getLogs(args);
      return jsonResult(result);
    }
  );
}
