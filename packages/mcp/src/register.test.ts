/// <reference types="vitest/globals" />
import { McpServer } from "@modelcontextprotocol/server";
import type { datasource } from "@kopai/core";

import { registerTools } from "./register.js";

interface Registered {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: Record<string, unknown>;
  };
  handler: (input: unknown) => Promise<{ isError?: true }>;
}

/**
 * A stand-in for McpServer that records registrations, so the registration
 * itself can be asserted on without a transport.
 */
function recordingServer() {
  const tools: Registered[] = [];
  const server = {
    registerTool: (
      name: string,
      config: Registered["config"],
      handler: Registered["handler"]
    ) => {
      tools.push({ name, config, handler });
      return {};
    },
  } as unknown as McpServer;
  return { server, tools };
}

const fakeDatasource = (
  onQuery: () => unknown = () => ({ data: [], nextCursor: null })
) =>
  ({
    query: async () => onQuery(),
    discoverMetrics: async () => ({ metrics: [] }),
  }) as unknown as datasource.ReadTelemetryDatasource;

const rawInput = {
  query: {
    signal: "traces",
    mode: "raw",
    timeDimension: { type: "relative", lookback: "1h" },
  },
};

describe("registerTools", () => {
  it("registers exactly the two read-only tools", () => {
    const { server, tools } = recordingServer();
    registerTools(server, { readTelemetryDatasource: fakeDatasource() });
    expect(tools.map((t) => t.name)).toEqual(["query", "metrics_discover"]);
  });

  it("marks both tools read-only, idempotent and closed-world", () => {
    const { server, tools } = recordingServer();
    registerTools(server, { readTelemetryDatasource: fakeDatasource() });
    for (const tool of tools) {
      expect(tool.config.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("advertises no outputSchema", () => {
    const { server, tools } = recordingServer();
    registerTools(server, { readTelemetryDatasource: fakeDatasource() });
    for (const tool of tools) {
      expect(tool.config.outputSchema).toBeUndefined();
    }
  });

  it("gives each tool a title and a description naming its limits", () => {
    const { server, tools } = recordingServer();
    registerTools(server, { readTelemetryDatasource: fakeDatasource() });
    const query = tools.find((t) => t.name === "query");
    expect(query?.config.title).toBe("Query telemetry");
    expect(query?.config.description).toMatch(/signal/);
    expect(query?.config.description).toMatch(/200/);
    expect(query?.config.description).toMatch(/500/);
    // The levers, stated where a model reads before it writes a query.
    expect(query?.config.description).toMatch(
      /multiplied by the number of time buckets/
    );
    expect(query?.config.description).toMatch(/two calls/);
    expect(query?.config.description).toMatch(/metrics_discover/);
    expect(tools.find((t) => t.name === "metrics_discover")?.config.title).toBe(
      "Discover metrics"
    );
  });

  it("fires onToolCall exactly once per call, with the outcome", async () => {
    const events: { tool: string; outcome: string; rowCount?: number }[] = [];
    const { server, tools } = recordingServer();
    registerTools(server, {
      readTelemetryDatasource: fakeDatasource(),
      onToolCall: (e) => events.push(e),
    });

    await tools[0]?.handler(rawInput);
    expect(events).toHaveLength(1);
    expect(events[0]?.tool).toBe("query");
    expect(events[0]?.outcome).toBe("ok");

    await tools[1]?.handler({});
    expect(events).toHaveLength(2);
    expect(events[1]?.tool).toBe("metrics_discover");
  });

  it("reports the outcome of a failure, not just of a success", async () => {
    const events: { outcome: string }[] = [];
    const { server, tools } = recordingServer();
    registerTools(server, {
      readTelemetryDatasource: fakeDatasource(),
      onToolCall: (e) => events.push(e),
    });
    await tools[0]?.handler({ query: { signal: "nope" } });
    expect(events.map((e) => e.outcome)).toEqual(["invalid_input"]);
  });

  it("survives an observer that throws — the host's bug is not the caller's", async () => {
    const { server, tools } = recordingServer();
    registerTools(server, {
      readTelemetryDatasource: fakeDatasource(),
      onToolCall: () => {
        throw new Error("the host's counter blew up");
      },
    });
    const result = await tools[0]?.handler(rawInput);
    expect(result?.isError).toBeUndefined();
  });
});

describe("registering against a real McpServer", () => {
  // Guards the specific trap the pass-through validator sits next to:
  // `fromJsonSchema` takes a provider object with a `getValidator` method, not
  // a validator function. A bare function throws inside the SDK, which
  // swallows it into a 500 on `initialize` — so the failure presents as "the
  // whole server is broken" rather than as a bad argument here.
  it("accepts the schemas and the pass-through validator without throwing", () => {
    const server = new McpServer({ name: "kopai", version: "0.0.0" });
    expect(() =>
      registerTools(server, { readTelemetryDatasource: fakeDatasource() })
    ).not.toThrow();
  });
});
