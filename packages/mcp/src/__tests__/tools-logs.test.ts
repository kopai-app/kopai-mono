import { describe, it, expect, vi } from "vitest";
import type { datasource } from "@kopai/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLogTools } from "../tools/logs.js";
import { connectTestClient, parseJsonContent } from "./helpers.js";

describe("logs mcp tools", () => {
  it("search_logs forwards the filter body", async () => {
    const getLogs = vi.fn<datasource.ReadLogsDatasource["getLogs"]>();
    const logRow = {
      TraceId: "t1",
      SpanId: "s1",
      Timestamp: "1700000000000000000",
      ServiceName: "svc",
      Body: "hello",
    };
    getLogs.mockResolvedValue({ data: [logRow], nextCursor: null });

    const server = new McpServer({ name: "test", version: "0" });
    registerLogTools(server, { getLogs });
    const client = await connectTestClient(server);

    const res = await client.callTool({
      name: "kopai_search_logs",
      arguments: { serviceName: "svc", bodyContains: "hi" },
    });

    expect(getLogs).toHaveBeenCalledWith({
      serviceName: "svc",
      bodyContains: "hi",
    });
    expect(parseJsonContent(res)).toEqual({ data: [logRow], nextCursor: null });
  });
});
