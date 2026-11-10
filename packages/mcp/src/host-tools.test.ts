/// <reference types="vitest/globals" />
import type { datasource } from "@kopai/core";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  errorResult,
  fromJsonSchema,
  type HostTools,
  type McpServer,
  okResult,
  passThroughValidator,
} from "./index.js";
import { mcpRoutes } from "./routes.js";
import type { ToolCallEvent } from "./types.js";

const MCP_ACCEPT = "application/json, text/event-stream";

const fakeDatasource = {
  query: async () => ({ data: [], nextCursor: null }),
  discoverMetrics: async () => ({ metrics: [] }),
} as unknown as datasource.ReadTelemetryDatasource;

const EMPTY_INPUT = fromJsonSchema(
  { type: "object", properties: {} },
  passThroughValidator
);

/** Registers one host tool whose callback is `run`. */
function tool(
  server: McpServer,
  name: string,
  run: (input: unknown) => unknown = () => okResult({ tool: name })
) {
  return server.registerTool(
    name,
    { description: name, inputSchema: EMPTY_INPUT },
    async (input: unknown) => run(input) as ReturnType<typeof okResult>
  );
}

interface Harness {
  app: FastifyInstance;
  url: string;
  events: ToolCallEvent[];
  logged: unknown[];
}

async function start(hostTools?: HostTools): Promise<Harness> {
  const events: ToolCallEvent[] = [];
  const logged: unknown[] = [];
  const app = Fastify({ logger: false });
  await app.register(mcpRoutes, {
    readTelemetryDatasource: fakeDatasource,
    allowedHosts: ["127.0.0.1"],
    logger: { error: (payload: unknown) => logged.push(payload) },
    onToolCall: (e) => events.push(e),
    ...(hostTools ? { hostTools } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, url: `http://127.0.0.1:${port}/mcp`, events, logged };
}

async function rpc(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string> = {}
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: MCP_ACCEPT,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  // The SDK answers JSON or a one-event SSE stream; read either.
  const json = text.startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice("data: ".length) ?? "null"
      );
  return { status: res.status, json };
}

async function listedNames(
  url: string,
  headers: Record<string, string> = {}
): Promise<string[]> {
  const res = await rpc(url, "tools/list", {}, headers);
  return res.json.result.tools.map((t: { name: string }) => t.name);
}

const call = (url: string, name: string, headers?: Record<string, string>) =>
  rpc(url, "tools/call", { name, arguments: {} }, headers);

describe("hostTools — refused at registration", () => {
  const register = async (hostTools: unknown) => {
    const app = Fastify({ logger: false });
    try {
      await app.register(mcpRoutes, {
        readTelemetryDatasource: fakeDatasource,
        allowedHosts: ["127.0.0.1"],
        hostTools: hostTools as HostTools,
      });
    } finally {
      await app.close();
    }
  };
  const noop = () => {};

  it.each([
    ["null", null],
    ["a function", noop],
    ["a missing register", { names: ["a"] }],
    ["a register that is not a function", { names: ["a"], register: "x" }],
    ["a non-array names", { names: "alert_get", register: noop }],
    ["a names holding a non-string", { names: ["a", 1], register: noop }],
  ])("refuses %s", async (_label, value) => {
    await expect(register(value)).rejects.toThrow(TypeError);
  });

  it.each(["query", "metrics_discover"])(
    "refuses a name that collides with the built-in %s",
    async (name) => {
      await expect(
        register({ names: ["alert_get", name], register: noop })
      ).rejects.toThrow(new RegExp(`"${name}".*built-in`));
    }
  );

  it("refuses a duplicate name", async () => {
    await expect(
      register({ names: ["alert_get", "alert_get"], register: noop })
    ).rejects.toThrow(/"alert_get".*more than once/);
  });

  // The SDK only warns on these, and on a per-request server it would warn on
  // every request.
  it.each([
    ["an empty name", ""],
    ["a name with a space", "alert get"],
    ["a name with a slash", "alert/get"],
    ["a name over 128 characters", "a".repeat(129)],
  ])("refuses %s", async (_label, name) => {
    await expect(register({ names: [name], register: noop })).rejects.toThrow(
      /MCP tool name/
    );
  });

  it("accepts an empty names list", async () => {
    await expect(register({ names: [], register: noop })).resolves.toBe(
      undefined
    );
  });
});

describe("hostTools — tools/list", () => {
  it("lists exactly the two built-ins without hostTools", async () => {
    const h = await start();
    try {
      expect(await listedNames(h.url)).toEqual(["query", "metrics_discover"]);
    } finally {
      await h.app.close();
    }
  });

  // The host decides per caller, from what its own preHandler attached to the
  // request. Here the decision is read straight from a header.
  it("lists the built-ins plus what register added for this request", async () => {
    const h = await start({
      names: ["alert_get", "alert_rule_create"],
      register: (server, request: FastifyRequest) => {
        tool(server, "alert_get");
        if (request.headers["x-role"] === "admin") {
          tool(server, "alert_rule_create");
        }
      },
    });
    try {
      expect(await listedNames(h.url, { "x-role": "admin" })).toEqual([
        "query",
        "metrics_discover",
        "alert_get",
        "alert_rule_create",
      ]);
      expect(await listedNames(h.url, { "x-role": "viewer" })).toEqual([
        "query",
        "metrics_discover",
        "alert_get",
      ]);
    } finally {
      await h.app.close();
    }
  });
});

describe("hostTools — calls are observed by the package", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start({
      names: [
        "host_ok",
        "host_not_found",
        "host_forbidden",
        "host_throws",
        "host_times_out",
        "host_uncoded",
      ],
      register: (server) => {
        tool(server, "host_ok", () => okResult({ rule: "r1" }));
        tool(server, "host_not_found", () =>
          errorResult({ error: "not_found", message: "No rule r9." })
        );
        tool(server, "host_forbidden", () =>
          errorResult({ error: "forbidden", message: "Alerting is off." })
        );
        tool(server, "host_throws", () => {
          throw new Error("connect ECONNREFUSED");
        });
        tool(server, "host_times_out", () => {
          throw Object.assign(new Error("Timeout exceeded"), { code: "159" });
        });
        tool(server, "host_uncoded", () => ({
          content: [{ type: "text", text: "nope" }],
          isError: true,
        }));
      },
    });
  });
  afterAll(async () => {
    await h.app.close();
  });
  beforeEach(() => {
    h.events.length = 0;
    h.logged.length = 0;
  });

  it("returns an okResult in both channels and reports ok once", async () => {
    const res = await call(h.url, "host_ok", { "x-tenant": "acme" });
    expect(res.json.result.structuredContent).toEqual({ rule: "r1" });
    expect(res.json.result.content).toEqual([
      { type: "text", text: JSON.stringify({ rule: "r1" }) },
    ]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ tool: "host_ok", outcome: "ok" });
    expect(h.events[0]?.request.headers["x-tenant"]).toBe("acme");
    expect(h.events[0]).not.toHaveProperty("rowCount");
  });

  it.each([
    ["host_not_found", "not_found", "No rule r9."],
    ["host_forbidden", "forbidden", "Alerting is off."],
  ])(
    "returns %s's errorResult with its message and reports %s",
    async (name, code, message) => {
      const res = await call(h.url, name);
      expect(res.json.result.isError).toBe(true);
      expect(res.json.result.structuredContent).toEqual({
        error: code,
        message,
      });
      expect(h.events.map((e) => e.outcome)).toEqual([code]);
      expect(h.logged).toEqual([]);
    }
  );

  it("turns a throw into a structured upstream_error, logged and reported", async () => {
    const res = await call(h.url, "host_throws");
    expect(res.json.result.isError).toBe(true);
    // A host tool need not run a query, so the message names none.
    expect(res.json.result.structuredContent).toEqual({
      error: "upstream_error",
      message: "The tool call could not be completed.",
    });
    expect(h.events.map((e) => e.outcome)).toEqual(["upstream_error"]);
    expect(h.logged).toHaveLength(1);
    expect((h.logged[0] as Error).message).toContain("ECONNREFUSED");
  });

  it("classifies a resource-limit throw as a built-in's would", async () => {
    const res = await call(h.url, "host_times_out");
    expect(res.json.result.structuredContent).toMatchObject({
      error: "query_too_expensive",
      remedies: expect.any(Array),
    });
    expect(h.events.map((e) => e.outcome)).toEqual(["query_too_expensive"]);
    expect(h.logged).toHaveLength(1);
  });

  it("counts an error result without a known code as upstream_error, and logs it", async () => {
    const res = await call(h.url, "host_uncoded");
    // The host's own result is passed through untouched.
    expect(res.json.result.content).toEqual([{ type: "text", text: "nope" }]);
    expect(h.events.map((e) => e.outcome)).toEqual(["upstream_error"]);
    expect(h.logged).toHaveLength(1);
    expect(JSON.stringify(h.logged[0])).toContain("host_uncoded");
  });
});

describe("hostTools — the name guard", () => {
  // A request that fails inside the server factory must not fall back to the
  // built-ins: a tool missing because of a bug would then look like a tool
  // hidden from this caller.
  const expectFailedRequest = async (
    register: HostTools["register"],
    cause: RegExp
  ) => {
    const h = await start({ names: ["alert_get", "alert_list"], register });
    try {
      const res = await rpc(h.url, "tools/list", {});
      expect(res.status).toBe(500);
      expect(res.json.error.code).toBe(-32603);
      expect(res.json.result).toBeUndefined();
      // The SDK logs nothing for a throwing factory, so the package does.
      expect(h.logged).toHaveLength(1);
      expect((h.logged[0] as Error).message).toMatch(cause);
    } finally {
      await h.app.close();
    }
  };

  it("fails the request when register adds a name it did not declare", async () => {
    await expectFailedRequest(
      (server) => tool(server, "alert_delete"),
      /"alert_delete" is not in hostTools.names \("alert_get", "alert_list"\)/
    );
  });

  it("fails the request when a registered tool is renamed to an undeclared name", async () => {
    await expectFailedRequest((server) => {
      tool(server, "alert_get").update({ name: "query" });
    }, /"query" is not in hostTools.names/);
  });

  it("fails the request when register throws", async () => {
    await expectFailedRequest(() => {
      throw new Error("host bug");
    }, /host bug/);
  });

  it("allows a rename to a declared name, and reports the call under it", async () => {
    const h = await start({
      names: ["alert_get", "alert_list"],
      register: (server) => {
        tool(server, "alert_get").update({ name: "alert_list" });
      },
    });
    try {
      expect(await listedNames(h.url)).toContain("alert_list");
      await call(h.url, "alert_list");
      expect(h.events.map((e) => e.tool)).toEqual(["alert_list"]);
    } finally {
      await h.app.close();
    }
  });

  it("still observes a callback swapped in through update", async () => {
    const h = await start({
      names: ["alert_get"],
      register: (server) => {
        tool(server, "alert_get").update({
          callback: async () =>
            errorResult({ error: "not_found", message: "gone" }),
        });
      },
    });
    try {
      await call(h.url, "alert_get");
      expect(h.events.map((e) => e.outcome)).toEqual(["not_found"]);
    } finally {
      await h.app.close();
    }
  });

  it("allows remove(), which the SDK implements as a rename to null", async () => {
    const h = await start({
      names: ["alert_get"],
      register: (server) => {
        tool(server, "alert_get").remove();
      },
    });
    try {
      expect(await listedNames(h.url)).toEqual(["query", "metrics_discover"]);
    } finally {
      await h.app.close();
    }
  });

  it("fails the request when register adds a built-in name", async () => {
    await expectFailedRequest(
      (server) => tool(server, "query"),
      /"query" is not in hostTools.names/
    );
  });

  // The SDK refuses a second registerTool under one name, but a rename onto
  // a name in use would silently replace that tool.
  it("fails the request when a tool is renamed onto a name already registered", async () => {
    await expectFailedRequest((server) => {
      tool(server, "alert_list");
      tool(server, "alert_get").update({ name: "alert_list" });
    }, /cannot be renamed to "alert_list", which is already registered/);
  });

  it("fails the request when a host tool declares an outputSchema", async () => {
    await expectFailedRequest((server) => {
      server.registerTool(
        "alert_get",
        {
          description: "alert_get",
          inputSchema: EMPTY_INPUT,
          outputSchema: EMPTY_INPUT,
        },
        async () => okResult({})
      );
    }, /"alert_get" declares an outputSchema/);
  });

  it("guards a registration made after register returns", async () => {
    let kept: McpServer | undefined;
    const h = await start({
      names: ["alert_get"],
      register: (server) => {
        kept = server;
      },
    });
    try {
      await listedNames(h.url);
      expect(() => tool(kept as McpServer, "alert_delete")).toThrow(
        /"alert_delete" is not in hostTools.names/
      );
    } finally {
      await h.app.close();
    }
  });

  it("renames and swaps the callback in one update, and reports under the new name", async () => {
    const h = await start({
      names: ["alert_get", "alert_list"],
      register: (server) => {
        tool(server, "alert_get").update({
          name: "alert_list",
          callback: async () =>
            errorResult({ error: "forbidden", message: "no" }),
        });
      },
    });
    try {
      await call(h.url, "alert_list");
      expect(h.events.map((e) => [e.tool, e.outcome])).toEqual([
        ["alert_list", "forbidden"],
      ]);
    } finally {
      await h.app.close();
    }
  });

  // `handle.handler` is the package's wrapper. Passing it back, to decorate
  // it, must not wrap it twice.
  it("observes a callback passed back from handle.handler once", async () => {
    const h = await start({
      names: ["alert_get"],
      register: (server) => {
        const handle = tool(server, "alert_get");
        const previous = handle.handler as (...args: unknown[]) => unknown;
        handle.update({
          callback: async (...args: unknown[]) =>
            previous(...args) as ReturnType<typeof okResult>,
        });
        handle.update({ callback: handle.handler as never });
      },
    });
    try {
      await call(h.url, "alert_get");
      expect(h.events).toHaveLength(1);
    } finally {
      await h.app.close();
    }
  });

  it("hides a disabled host tool from tools/list", async () => {
    const h = await start({
      names: ["alert_get", "alert_list"],
      register: (server) => {
        tool(server, "alert_get").disable();
        const listed = tool(server, "alert_list");
        listed.disable();
        listed.enable();
      },
    });
    try {
      expect(await listedNames(h.url)).toEqual([
        "query",
        "metrics_discover",
        "alert_list",
      ]);
    } finally {
      await h.app.close();
    }
  });

  it("observes a host tool with no inputSchema, whose callback takes only the context", async () => {
    const h = await start({
      names: ["alert_list"],
      register: (server) => {
        server.registerTool(
          "alert_list",
          { description: "alert_list" },
          async () => okResult({ alerts: [] })
        );
      },
    });
    try {
      const res = await call(h.url, "alert_list");
      expect(res.json.result.structuredContent).toEqual({ alerts: [] });
      expect(h.events.map((e) => e.outcome)).toEqual(["ok"]);
    } finally {
      await h.app.close();
    }
  });

  it("fails the request when update adds an outputSchema", async () => {
    await expectFailedRequest((server) => {
      tool(server, "alert_get").update({ outputSchema: EMPTY_INPUT });
    }, /"alert_get" declares an outputSchema/);
  });

  // An async function satisfies `=> void`, and its promise would be dropped.
  it("fails the request when register is async", async () => {
    await expectFailedRequest(async (server) => {
      tool(server, "alert_get");
    }, /register returned a promise; it must be synchronous/);
  });
});
