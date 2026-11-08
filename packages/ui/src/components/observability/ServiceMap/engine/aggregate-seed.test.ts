import { describe, it, expect } from "vitest";
import { kopaiQuery, kopaiQueryCompiler } from "@kopai/core";
import {
  buildSeedQueries,
  parseSeed,
  PEER_SERVICE_KEY,
} from "./aggregate-seed.js";
import { M_MS, SEED_LIMIT } from "./config.js";

type Row = kopaiQuery.KopaiAggregateRow;

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

function peerRow(
  service: string,
  calls: number,
  attrs: Partial<Record<string, string>>,
  errRate = 0
): Row {
  return {
    "service.name": service,
    [PEER_SERVICE_KEY]: null,
    "db.system.name": null,
    "db.namespace": null,
    "messaging.system": null,
    "messaging.destination.name": null,
    "messaging.operation.type": null,
    "server.address": null,
    ...attrs,
    calls,
    errRate,
  };
}

const node = (svc: string, kind: string, spans: number, errRate = 0): Row => ({
  "service.name": svc,
  SpanKind: kind,
  spans,
  errRate,
});

describe("buildSeedQueries", () => {
  it("both queries validate against the core zod schema and compiler", () => {
    const q = buildSeedQueries(NOW);
    for (const body of [q.nodes, q.edges]) {
      const parsed = kopaiQuery.TraceAggregateQuerySchema.parse(body);
      expect(() => kopaiQueryCompiler.validateKopaiQuery(parsed)).not.toThrow();
    }
  });

  it("covers [now − M, now] as an absolute window with the A1 shape", () => {
    const { nodes, edges } = buildSeedQueries(NOW);
    expect(nodes.timeDimension).toEqual({
      type: "absolute",
      startTime: new Date(NOW - M_MS).toISOString(),
      endTime: new Date(NOW).toISOString(),
    });
    expect(nodes.dimensions).toEqual(["service.name", "SpanKind"]);
    expect(nodes.limit).toBe(SEED_LIMIT);
    expect(edges.filters).toEqual([
      { column: "SpanKind", op: "in", values: ["Client", "Producer"] },
    ]);
    expect(edges.dimensions).toContainEqual({
      container: "SpanAttributes",
      key: "peer.service",
    });
    expect(edges.measures.map((m) => m.as)).toEqual(["calls", "errRate"]);
  });
});

describe("parseSeed", () => {
  it("sums the SpanKinds per service", () => {
    const seed = parseSeed(
      [
        node("cart", "Server", 100, 0.1),
        node("cart", "Client", 300, 0),
        node("cart", "Internal", 100, 0),
        node("web", "Server", 50, 0),
      ],
      []
    );
    expect(seed.nodes).toEqual([
      { id: "cart", spans: 500, errors: 10, errorRate: 0.02 },
      { id: "web", spans: 50, errors: 0, errorRate: 0 },
    ]);
    expect(seed.truncated).toBe(false);
  });

  it("sets truncated when either result hits 10000 rows", () => {
    const many = Array.from({ length: SEED_LIMIT }, (_, i) =>
      node(`svc-${i}`, "Server", 1)
    );
    expect(parseSeed(many, []).truncated).toBe(true);
    expect(parseSeed(many.slice(1), []).truncated).toBe(false);
    const manyEdges = Array.from({ length: SEED_LIMIT }, (_, i) =>
      peerRow("a", 1, { "server.address": `h${i}.example.com` })
    );
    expect(parseSeed([], manyEdges).truncated).toBe(true);
  });

  it("maps peer rows to virtual nodes and edges, merging rows with the same target", () => {
    const seed = parseSeed(
      [node("checkout", "Server", 10), node("cart", "Server", 10)],
      [
        peerRow("checkout", 40, {
          "db.system.name": "postgresql",
          "db.namespace": "shop",
          "server.address": "pg-1",
        }),
        peerRow(
          "checkout",
          10,
          {
            "db.system.name": "postgresql",
            "db.namespace": "shop",
            "server.address": "pg-2",
          },
          0.5
        ),
        peerRow("checkout", 7, { "server.address": "cart:8080" }), // known: dropped
        peerRow("checkout", 3, {}), // no peer
        peerRow("cart", 5, {
          "messaging.system": "kafka",
          "messaging.destination.name": "orders",
          "messaging.operation.type": "receive",
        }),
      ]
    );
    expect(seed.virtualNodes).toEqual([
      {
        id: "db:postgresql/shop",
        label: "shop (postgresql)",
        kind: "database",
      },
      { id: "mq:kafka/orders", label: "orders (kafka)", kind: "messaging" },
    ]);
    expect(seed.edges).toEqual([
      { source: "mq:kafka/orders", target: "cart", calls: 5, errors: 0 },
      {
        source: "checkout",
        target: "db:postgresql/shop",
        calls: 50,
        errors: 5,
      },
    ]);
    expect(seed.clientNoPeer).toBe(3);
  });

  it("per-source cap: 30 hosts give 20 ext targets plus ext:<src>/other; other sources unaffected", () => {
    const rows: Row[] = [];
    // calls 30..1, so the top 20 are hosts 0..19 and the rest sum 10+9+…+1
    for (let i = 0; i < 30; i++) {
      rows.push(
        peerRow("gateway", 30 - i, { "server.address": `10.0.0.${i}` })
      );
    }
    for (let i = 0; i < 5; i++) {
      rows.push(
        peerRow("billing", 1, { "server.address": `b${i}.example.com` })
      );
    }
    const seed = parseSeed(
      [node("gateway", "Server", 1), node("billing", "Server", 1)],
      rows
    );

    const fromGateway = seed.edges.filter((e) => e.source === "gateway");
    const ext = fromGateway.filter((e) => e.target !== "ext:gateway/other");
    expect(ext).toHaveLength(20);
    expect(ext.map((e) => e.target)).toEqual(
      Array.from({ length: 20 }, (_, i) => `ext:10.0.0.${i}`)
    );
    const other = fromGateway.find((e) => e.target === "ext:gateway/other");
    expect(other?.calls).toBe(55);
    expect(seed.virtualNodes.find((n) => n.id === "ext:gateway/other")).toEqual(
      {
        id: "ext:gateway/other",
        label: "other (10 targets)",
        kind: "external",
      }
    );
    expect(seed.virtualNodes.some((n) => n.id === "ext:10.0.0.25")).toBe(false);

    const fromBilling = seed.edges.filter((e) => e.source === "billing");
    expect(fromBilling).toHaveLength(5);
    expect(fromBilling.some((e) => e.target.endsWith("/other"))).toBe(false);
  });

  it("breaks per-source ties by id", () => {
    const rows = ["c.example", "a.example", "b.example"].map((h) =>
      peerRow("s", 1, { "server.address": h })
    );
    const seed = parseSeed([node("s", "Server", 1)], rows, { perSource: 2 });
    expect(seed.edges.map((e) => e.target)).toEqual([
      "ext:a.example",
      "ext:b.example",
      "ext:s/other",
    ]);
  });
});
