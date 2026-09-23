/// <reference types="vitest/globals" />
import type { datasource } from "@kopai/core";
import {
  createOptimizedDatasource,
  initializeDatabase,
} from "@kopai/sqlite-datasource";
import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";

import { LIMITS } from "./limits.js";
import { mcpRoutes } from "./routes.js";

const MCP_ACCEPT = "application/json, text/event-stream";

/** Wide enough that no fixture falls outside it. */
const WIDE_WINDOW = {
  type: "absolute" as const,
  startTime: "1970-01-01T00:00:00.000Z",
  endTime: "2200-01-01T00:00:00.000Z",
};

let connection: DatabaseSync;
let ds: datasource.TelemetryDatasource;
let app: FastifyInstance;
let url: string;

async function writeSpan(opts: {
  traceId: string;
  spanId: string;
  serviceName: string;
  spanName: string;
  startTimeNanos: string;
  endTimeNanos: string;
}) {
  await ds.writeTraces({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: opts.serviceName } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "test-scope" },
            spans: [
              {
                traceId: opts.traceId,
                spanId: opts.spanId,
                name: opts.spanName,
                startTimeUnixNano: opts.startTimeNanos,
                endTimeUnixNano: opts.endTimeNanos,
              },
            ],
          },
        ],
      },
    ],
  });
}

/** Sends a JSON-RPC tools/call and returns the tool's parsed payload. */
async function callTool(name: string, args: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: MCP_ACCEPT },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  // The legacy leg frames its answer as an event stream.
  const body = text.startsWith("event:")
    ? (text.split("\n").find((l) => l.startsWith("data:")) ?? "")
        .slice(5)
        .trim()
    : text;
  const envelope = JSON.parse(body) as {
    result?: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
      content?: Array<{ text: string }>;
    };
  };
  const result = envelope.result;
  return {
    status: res.status,
    isError: result?.isError === true,
    structured: result?.structuredContent,
    text: result?.content?.[0]?.text,
  };
}

const traceRaw = (extra: Record<string, unknown> = {}) => ({
  query: {
    signal: "traces",
    mode: "raw",
    dimensions: ["TraceId", "SpanId"],
    timeDimension: WIDE_WINDOW,
    ...extra,
  },
});

const traceAggregate = (extra: Record<string, unknown> = {}) => ({
  query: {
    signal: "traces",
    mode: "aggregate",
    measures: [{ op: "COUNT", as: "spans" }],
    dimensions: ["service.name"],
    timeDimension: WIDE_WINDOW,
    output: { type: "summary" },
    ...extra,
  },
});

beforeEach(async () => {
  connection = initializeDatabase(":memory:");
  ds = createOptimizedDatasource(connection);
  app = Fastify({ logger: false });
  await app.register(mcpRoutes, {
    readTelemetryDatasource: ds,
    allowedHosts: ["127.0.0.1", "localhost"],
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  url = `http://127.0.0.1:${port}/mcp`;
});

afterEach(async () => {
  await app.close();
  connection.close();
});

describe("against a real SQLite datasource", () => {
  it("returns real rows for a raw trace query", async () => {
    await writeSpan({
      traceId: "trace1",
      spanId: "span1",
      serviceName: "checkout",
      spanName: "POST /orders",
      startTimeNanos: "1700000000000000000",
      endTimeNanos: "1700000000500000000",
    });

    const res = await callTool("query", traceRaw());
    expect(res.isError).toBe(false);
    const data = res.structured?.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]?.SpanId).toBe("span1");
    expect(res.structured).toHaveProperty("nextCursor");
  });

  it("returns real grouped rows for an aggregate query, with no nextCursor", async () => {
    for (const [i, service] of ["checkout", "checkout", "billing"].entries()) {
      await writeSpan({
        traceId: `trace${i}`,
        spanId: `span${i}`,
        serviceName: service,
        spanName: "op",
        startTimeNanos: `170000000${i}000000000`,
        endTimeNanos: `170000000${i}500000000`,
      });
    }

    const res = await callTool("query", traceAggregate());
    expect(res.isError).toBe(false);
    const data = res.structured?.data as Array<Record<string, unknown>>;
    const byService = Object.fromEntries(
      data.map((r) => [r["service.name"], r.spans])
    );
    expect(byService).toEqual({ checkout: 2, billing: 1 });
    // The aggregate response genuinely carries no cursor — asserted here
    // because the fake in the unit tests could not have told us.
    expect(res.structured).not.toHaveProperty("nextCursor");
  });

  it("returns the same JSON the REST route would return", async () => {
    await writeSpan({
      traceId: "trace1",
      spanId: "span1",
      serviceName: "checkout",
      spanName: "POST /orders",
      startTimeNanos: "1700000000000000000",
      endTimeNanos: "1700000000500000000",
    });

    // What the REST handler does, with the tool's effective limit applied.
    const viaRest = await ds.queryTracesRaw({
      ...traceRaw().query,
      limit: LIMITS.raw.fallback,
    } as never);
    const viaTool = await callTool("query", traceRaw());

    expect(viaTool.structured).toEqual(JSON.parse(JSON.stringify(viaRest)));
  });

  it("discovers real metrics", async () => {
    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "checkout" } },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: "orders.placed",
                  unit: "1",
                  description: "Orders placed",
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [
                      {
                        asInt: "5",
                        timeUnixNano: "1700000000000000000",
                        startTimeUnixNano: "1700000000000000000",
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const res = await callTool("metrics_discover", {});
    expect(res.isError).toBe(false);
    const metrics = res.structured?.metrics as Array<{ name: string }>;
    expect(metrics.map((m) => m.name)).toContain("orders.placed");
  });

  it("reports a real compiler rejection as invalid_input at `query`", async () => {
    // Metric queries require a MetricType filter. This is the datasource's own
    // validator talking, not the tool's.
    const res = await callTool("query", {
      query: {
        signal: "metrics",
        mode: "raw",
        dimensions: ["Value"],
        timeDimension: WIDE_WINDOW,
      },
    });
    expect(res.isError).toBe(true);
    expect(res.structured?.error).toBe("invalid_input");
    const issues = res.structured?.issues as Array<{ path: string }>;
    expect(issues[0]?.path).toBe("query");
  });

  it("refuses a real unordered aggregate overflow with no rows", async () => {
    for (let i = 0; i < 4; i++) {
      await writeSpan({
        traceId: `trace${i}`,
        spanId: `span${i}`,
        serviceName: `service-${i}`,
        spanName: "op",
        startTimeNanos: `170000000${i}000000000`,
        endTimeNanos: `170000000${i}500000000`,
      });
    }

    const res = await callTool("query", traceAggregate({ limit: 2 }));
    expect(res.isError).toBe(true);
    expect(res.structured?.error).toBe("result_too_large");
    expect(res.structured?.data).toBeUndefined();
    expect((res.structured?.remedies as string[]).join(" ")).toMatch(/orderBy/);
  });

  it("truncates a real ordered aggregate overflow and says so", async () => {
    for (let i = 0; i < 4; i++) {
      await writeSpan({
        traceId: `trace${i}`,
        spanId: `span${i}`,
        serviceName: `service-${i}`,
        spanName: "op",
        startTimeNanos: `170000000${i}000000000`,
        endTimeNanos: `170000000${i}500000000`,
      });
    }

    const res = await callTool(
      "query",
      traceAggregate({
        limit: 2,
        orderBy: [{ type: "measure", alias: "spans", direction: "desc" }],
      })
    );
    expect(res.isError).toBe(false);
    expect((res.structured?.data as unknown[]).length).toBe(2);
    expect(res.structured?.truncated).toBe(true);
  });

  it("rejects an over-cap raw limit before reaching the database", async () => {
    const res = await callTool(
      "query",
      traceRaw({ limit: LIMITS.raw.max + 1 })
    );
    expect(res.isError).toBe(true);
    expect(res.structured?.error).toBe("invalid_input");
    const issues = res.structured?.issues as Array<{ path: string }>;
    expect(issues.map((i) => i.path)).toEqual(["query.limit"]);
  });
});
