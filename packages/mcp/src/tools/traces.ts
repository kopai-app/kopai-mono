import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataFilterSchemas, type datasource } from "@kopai/core";
import { jsonResult } from "./result.js";

type Ds = datasource.ReadTracesDatasource & datasource.ReadTracesMetaDatasource;

export function registerTraceTools(server: McpServer, ds: Ds): void {
  server.registerTool(
    "kopai_get_trace",
    {
      description: "Get all spans for a trace by traceId",
      inputSchema: z.object({
        traceId: z.string().describe("A TraceId of the trace"),
      }),
    },
    async ({ traceId }) => {
      const result = await ds.getTraces({ traceId });
      return jsonResult({ data: result.data });
    }
  );

  server.registerTool(
    "kopai_search_traces",
    {
      description: "Search spans matching a filter",
      inputSchema: dataFilterSchemas.tracesDataFilterSchema,
    },
    async (args) => {
      const result = await ds.getTraces(args);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_get_services",
    { description: "List distinct service names" },
    async () => {
      const result = await ds.getServices({});
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_get_operations",
    {
      description: "List distinct operations for a service",
      inputSchema: z.object({ serviceName: z.string() }),
    },
    async ({ serviceName }) => {
      const result = await ds.getOperations({ serviceName });
      return jsonResult(result);
    }
  );

  server.registerTool(
    "kopai_search_trace_summaries",
    {
      description: "Search trace summaries",
      inputSchema: dataFilterSchemas.traceSummariesFilterSchema,
    },
    async (args) => {
      const result = await ds.getTraceSummaries(args);
      return jsonResult(result);
    }
  );
}
