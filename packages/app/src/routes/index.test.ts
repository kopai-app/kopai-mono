/// <reference types="vitest/globals" />
import {
  createOptimizedDatasource,
  DashboardDbDatasource,
  initializeDatabase,
} from "@kopai/sqlite-datasource";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { DatabaseSync } from "node:sqlite";

import { apiRoutes } from "./index.js";

const MCP_ACCEPT = "application/json, text/event-stream";

let connection: DatabaseSync;
let app: FastifyInstance;

beforeEach(async () => {
  connection = initializeDatabase(":memory:");
  const readTelemetryDatasource = createOptimizedDatasource(connection);
  await readTelemetryDatasource.writeTraces({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "test-scope" },
            spans: [
              {
                traceId: "trace1",
                spanId: "span1",
                name: "POST /orders",
                startTimeUnixNano: "1700000000000000000",
                endTimeUnixNano: "1700000000500000000",
              },
            ],
          },
        ],
      },
    ],
  });

  // Mirrors the compilers server.ts sets, so the MCP routes are exercised
  // alongside the zod-typed signals routes exactly as the app mounts them.
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(apiRoutes, {
    readTelemetryDatasource,
    dynamicDashboardDatasource: new DashboardDbDatasource(connection),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  connection.close();
});

/** Sends a JSON-RPC request to `/mcp` with a loopback Host unless overridden. */
function rpc(
  method: string,
  params: unknown,
  headers: Record<string, string> = {}
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      host: "localhost:8000",
      "content-type": "application/json",
      accept: MCP_ACCEPT,
      ...headers,
    },
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
}

/** The JSON-RPC result, whether the SDK framed it as JSON or as an event. */
function resultOf(body: string) {
  const json = body.startsWith("event:")
    ? (body.split("\n").find((l) => l.startsWith("data:")) ?? "")
        .slice(5)
        .trim()
    : body;
  return (JSON.parse(json) as { result: Record<string, unknown> }).result;
}

describe("/mcp on the app", () => {
  it("lists exactly the query and metrics_discover tools", async () => {
    const res = await rpc("tools/list", {});
    expect(res.statusCode).toBe(200);
    const tools = resultOf(res.body).tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "metrics_discover",
      "query",
    ]);
  });

  it("answers a query from the app's own datasource", async () => {
    const res = await rpc("tools/call", {
      name: "query",
      arguments: {
        query: {
          signal: "traces",
          mode: "raw",
          dimensions: ["TraceId", "SpanId"],
          timeDimension: {
            type: "absolute",
            startTime: "1970-01-01T00:00:00.000Z",
            endTime: "2200-01-01T00:00:00.000Z",
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const result = resultOf(res.body);
    expect(result.isError).not.toBe(true);
    const data = (result.structuredContent as { data: unknown[] }).data;
    expect(data).toEqual([
      expect.objectContaining({ TraceId: "trace1", SpanId: "span1" }),
    ]);
  });

  it.each(["localhost:8000", "127.0.0.1:8000", "[::1]:8000"])(
    "accepts the loopback Host %s",
    async (host) => {
      const res = await rpc("tools/list", {}, { host });
      expect(res.statusCode).toBe(200);
    }
  );

  it("refuses a Host that is not loopback, which is what a DNS-rebinding page sends", async () => {
    const res = await rpc("tools/list", {}, { host: "attacker.example:8000" });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a browser Origin that is not loopback, even with a loopback Host", async () => {
    const res = await rpc(
      "tools/list",
      {},
      { origin: "https://attacker.example" }
    );
    expect(res.statusCode).toBe(403);
  });

  // Checks the Origin allow-list only. A real browser page at this origin is
  // still blocked by CORS, which the app does not serve (OPTIONS /mcp is 404);
  // the README says browser-direct clients are not supported.
  it("accepts a loopback browser Origin on any port", async () => {
    const res = await rpc(
      "tools/list",
      {},
      { origin: "http://localhost:6274" }
    );
    expect(res.statusCode).toBe(200);
  });

  // Pins a known gap rather than endorsing it: the REST routes mounted beside
  // /mcp check neither Host nor Origin, so the same rebinding request that
  // /mcp refuses reads the same data here. When app-wide validation lands,
  // this test should flip to 403 on purpose, not be deleted.
  it("does not yet protect the REST routes from a rebinding Host", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/signals/traces/search",
      headers: {
        host: "attacker.example:8000",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  // Claude Code probes GET while connecting; a 404 there reads as "no server".
  it("answers GET with 405 and Allow: POST", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: { host: "localhost:8000", accept: "text/event-stream" },
    });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("POST");
  });
});
