import { hostHeaderValidation } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";

import { registerTools } from "./register.js";
import type { McpRoutesOptions } from "./types.js";

const SERVER_NAME = "kopai";
const SERVER_VERSION = "0.0.0";

/**
 * Mounts the MCP endpoint at `/mcp`, relative to wherever this plugin is
 * registered.
 *
 * The server is stateless: no session id, no server push, and a fresh
 * `McpServer` per request.
 */
export const mcpRoutes: FastifyPluginAsync<McpRoutesOptions> =
  async function mcpRoutes(fastify, opts) {
    // Port-agnostic allow-list on the Host header. This is what stops a page
    // on another origin from resolving a name it controls to 127.0.0.1 and
    // reaching a local server through the browser — the request arrives with
    // the attacker's hostname in `Host`, and that is what is checked.
    //
    // Origin validation is deliberately not mounted here: see the Q10 note in
    // ADR-058. It is undecided, not forgotten.
    fastify.addHook("onRequest", hostHeaderValidation(opts.allowedHosts));

    const handleMcp = async (
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<void> => {
      // RFC 9110 makes `Allow` a MUST on a 405, and the SDK sends none.
      //
      // NOTE it must be set on `reply.raw`, not through `reply.header()`.
      // Fastify stages headers on its own reply object and flushes them when
      // it serializes the response — which never happens once the reply is
      // hijacked, so `reply.header()` here is silently dropped. Writing to the
      // Node response directly is what survives.
      //
      // Only for the methods that will 405: a successful POST has no business
      // advertising `Allow`.
      if (request.method !== "POST") {
        reply.raw.setHeader("Allow", "POST");
      }

      // WHY the factory is built here, inside the route handler, rather than
      // once at registration: the tool callbacks close over `request`
      // lexically, so the host application's per-request context reaches the
      // datasource without this package knowing anything about tenants or
      // credentials. That makes the handler per-request too.
      //
      // The alternative, AsyncLocalStorage, was rejected for consistency:
      // this codebase threads `requestContext` explicitly at every existing
      // call site and uses AsyncLocalStorage nowhere.
      //
      // NOTE `responseMode` is deliberately not passed. It is byte-identical
      // to the `auto` default across every combination measured, its only
      // observable effect is a console.warn emitted once per
      // `createMcpHandler` — which here is once per request — and it silently
      // drops mid-call notifications.
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: SERVER_NAME,
          version: SERVER_VERSION,
        });
        registerTools(server, {
          readTelemetryDatasource: opts.readTelemetryDatasource,
          requestContext: request.requestContext,
          // The request is attached here rather than inside the tool layer,
          // which knows nothing about HTTP.
          onToolCall: opts.onToolCall
            ? (event) => opts.onToolCall?.({ ...event, request })
            : undefined,
        });
        return server;
      });

      reply.hijack();
      // The third argument is the body Fastify has already parsed and
      // drained; passing it means nothing is read from a stream that is
      // already consumed.
      await toNodeHandler(handler, {
        onerror: (error: unknown) => fastify.log.error(error),
      })(request.raw, reply.raw, request.body);
    };

    // POST is the endpoint. GET and DELETE are routed only so that the SDK
    // gets to answer them 405 — with just a POST route, Fastify's own 404
    // handler replies first and the SDK is never consulted. The difference is
    // not cosmetic: Streamable HTTP defines GET as "open an SSE stream", and
    // requires either an event-stream response or a 405. A client that probes
    // GET and receives 404 reads the endpoint as gone rather than as healthy
    // and non-streaming.
    //
    // OPTIONS is deliberately left unrouted. The SDK would answer it 405 like
    // any other non-POST method, which would intercept CORS preflight — and
    // preflight belongs to whatever CORS plugin the host application
    // registers, which differs between the two mounts. PUT and PATCH stay
    // unrouted too and fall through to Fastify's 404; the spec says nothing
    // about them and no client sends them.
    fastify.route({ method: "POST", url: "/mcp", handler: handleMcp });
    fastify.route({ method: "GET", url: "/mcp", handler: handleMcp });
    fastify.route({ method: "DELETE", url: "/mcp", handler: handleMcp });
  };
