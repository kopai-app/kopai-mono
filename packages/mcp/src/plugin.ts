import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer, type McpServerDeps } from "./server.js";

export type McpPluginOptions = McpServerDeps;

export const mcpPlugin: FastifyPluginAsync<McpPluginOptions> = async (
  fastify,
  opts
) => {
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const mcpServer = buildMcpServer(opts);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    reply.raw.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  };

  fastify.post("/mcp", handle);
  fastify.get("/mcp", handle);
  fastify.delete("/mcp", handle);
};
