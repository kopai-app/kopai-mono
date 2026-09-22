/// <reference types="vitest/globals" />
import type { datasource } from "@kopai/core";
import Fastify, { type FastifyInstance } from "fastify";
import http from "node:http";

import { mcpRoutes } from "./routes.js";
import type { ToolCallEvent } from "./types.js";

const MCP_ACCEPT = "application/json, text/event-stream";

interface Harness {
  app: FastifyInstance;
  port: number;
  url: string;
  events: ToolCallEvent[];
  seenContexts: unknown[];
}

async function start(
  opts: { allowedHosts?: string[]; withContext?: boolean } = {}
): Promise<Harness> {
  const events: ToolCallEvent[] = [];
  const seenContexts: unknown[] = [];

  const readTelemetryDatasource = {
    query: async (q: { requestContext?: unknown }) => {
      seenContexts.push(q.requestContext);
      return { data: [{ SpanId: "abc" }], nextCursor: null };
    },
    discoverMetrics: async () => ({ metrics: [] }),
  } as unknown as datasource.ReadTelemetryDatasource;

  const app = Fastify({ logger: false });
  if (opts.withContext) {
    app.decorateRequest("requestContext", null);
    app.addHook("preHandler", async (req) => {
      req.requestContext = { tenant: req.headers["x-tenant"] ?? "none" };
    });
  }
  await app.register(mcpRoutes, {
    readTelemetryDatasource,
    allowedHosts: opts.allowedHosts ?? ["localhost", "127.0.0.1"],
    onToolCall: (e) => events.push(e),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    app,
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    events,
    seenContexts,
  };
}

/** Always drains the body: an undrained response silently curtails the call. */
async function rpc(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: MCP_ACCEPT,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/**
 * node:http rather than fetch, because undici silently strips a forged `Host`
 * header — a fetch-based probe of host validation proves nothing.
 */
function raw(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text })
        );
      }
    );
    req.setTimeout(5000, () => req.destroy(new Error("probe timed out")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const toolsCall = (name: string, args: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

const rawQuery = {
  query: {
    signal: "traces",
    mode: "raw",
    timeDimension: { type: "relative", lookback: "1h" },
  },
};

describe("mcpRoutes — POST", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start({ withContext: true });
  });
  afterAll(async () => {
    await h.app.close();
  });

  it("serves tools/list with no prior initialize — the server is stateless", async () => {
    const res = await rpc(h.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain("metrics_discover");
    expect(res.text).toContain("Query telemetry");
  });

  it("serves tools/call and returns the payload in both channels", async () => {
    const res = await rpc(h.url, toolsCall("query", rawQuery));
    expect(res.status).toBe(200);
    expect(res.text).toContain("structuredContent");
    expect(res.text).toContain("SpanId");
  });

  it("threads the Fastify request's context through to the datasource", async () => {
    h.seenContexts.length = 0;
    await rpc(h.url, toolsCall("query", rawQuery), { "x-tenant": "acme" });
    expect(h.seenContexts).toEqual([{ tenant: "acme" }]);
  });

  it("reports the call to onToolCall with the request attached", async () => {
    h.events.length = 0;
    await rpc(h.url, toolsCall("query", rawQuery), { "x-tenant": "globex" });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.tool).toBe("query");
    expect(h.events[0]?.outcome).toBe("ok");
    expect(h.events[0]?.request.headers["x-tenant"]).toBe("globex");
  });
});

describe("mcpRoutes — method handling", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start();
  });
  afterAll(async () => {
    await h.app.close();
  });

  // The whole point of routing GET and DELETE: with only a POST route,
  // Fastify's own 404 answers first and the SDK is never consulted. A client
  // that probes GET and sees 404 reads the endpoint as gone.
  it.each(["GET", "DELETE"])("answers %s with 405, not 404", async (method) => {
    const res = await raw(h.port, method, "/mcp", { accept: MCP_ACCEPT });
    expect(res.status).toBe(405);
  });

  it("sends `Allow: POST` on a 405, which the SDK itself does not", async () => {
    const res = await raw(h.port, "GET", "/mcp", { accept: MCP_ACCEPT });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("POST");
  });

  it("does not advertise `Allow` on a successful POST", async () => {
    const res = await rpc(h.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("allow")).toBeNull();
  });

  // Left to whatever CORS plugin the host application registers. Claiming it
  // here would answer preflight 405 and differ between the two mounts.
  it("leaves OPTIONS unrouted, so it does not intercept CORS preflight", async () => {
    const res = await raw(h.port, "OPTIONS", "/mcp", { accept: MCP_ACCEPT });
    expect(res.status).not.toBe(405);
  });

  it.each(["PUT", "PATCH"])("leaves %s unrouted", async (method) => {
    const res = await raw(h.port, method, "/mcp", { accept: MCP_ACCEPT });
    expect(res.status).toBe(404);
  });
});

describe("mcpRoutes — host header validation", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start({ allowedHosts: ["localhost", "127.0.0.1"] });
  });
  afterAll(async () => {
    await h.app.close();
  });

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });

  it("accepts an allow-listed host, port and all", async () => {
    const res = await raw(
      h.port,
      "POST",
      "/mcp",
      {
        host: `127.0.0.1:${h.port}`,
        "content-type": "application/json",
        accept: MCP_ACCEPT,
        "content-length": String(Buffer.byteLength(body)),
      },
      body
    );
    expect(res.status).toBe(200);
  });

  it("refuses a forged host — the DNS rebinding case", async () => {
    const res = await raw(
      h.port,
      "POST",
      "/mcp",
      {
        host: "evil.example.com",
        "content-type": "application/json",
        accept: MCP_ACCEPT,
        "content-length": String(Buffer.byteLength(body)),
      },
      body
    );
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("SpanId");
  });
});

describe("mcpRoutes — Accept negotiation", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start();
  });
  afterAll(async () => {
    await h.app.close();
  });

  it("refuses a request that does not accept both media types", async () => {
    const res = await rpc(
      h.url,
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { accept: "application/json" }
    );
    expect(res.status).toBe(406);
  });
});

describe("mcpRoutes — concurrency", () => {
  // The claim design B rests on: the tool callback closes over the
  // FastifyRequest lexically, so a shared handler could misattribute one
  // caller's context to another. Two hundred interleaved calls across eight
  // tenants, each asserting its own context came back.
  it("attributes every concurrent call to its own request", async () => {
    const seen: Array<{ sent: string; got: unknown }> = [];
    const readTelemetryDatasource = {
      query: async (q: { requestContext?: { tenant?: string } }) => {
        // Yield, so the calls genuinely interleave rather than running to
        // completion one at a time.
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        return {
          data: [{ tenant: q.requestContext?.tenant }],
          nextCursor: null,
        };
      },
      discoverMetrics: async () => ({ metrics: [] }),
    } as unknown as datasource.ReadTelemetryDatasource;

    const app = Fastify({ logger: false });
    app.decorateRequest("requestContext", null);
    app.addHook("preHandler", async (req) => {
      req.requestContext = { tenant: req.headers["x-tenant"] };
    });
    await app.register(mcpRoutes, {
      readTelemetryDatasource,
      allowedHosts: ["127.0.0.1"],
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}/mcp`;

    const tenants = Array.from({ length: 8 }, (_, i) => `t${i}`);
    await Promise.all(
      Array.from({ length: 200 }, async (_, i) => {
        const tenant = tenants[i % 8] as string;
        const res = await rpc(url, toolsCall("query", rawQuery), {
          "x-tenant": tenant,
        });
        const match = /"tenant":"(t\d)"/.exec(res.text);
        seen.push({ sent: tenant, got: match?.[1] });
      })
    );

    await app.close();
    expect(seen).toHaveLength(200);
    expect(seen.filter((s) => s.got !== s.sent)).toEqual([]);
  });
});
