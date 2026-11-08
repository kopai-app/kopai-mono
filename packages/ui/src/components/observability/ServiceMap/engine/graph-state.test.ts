import { describe, it, expect } from "vitest";
import { chooseHub, createGraphState, edgeId } from "./graph-state.js";
import { createJoinBuffer } from "./join-buffer.js";
import { EDGE_CAP, JOIN_CAP, NODE_CAP } from "./config.js";
import type { ParsedSeed, Region, SpanTuple } from "./types.js";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

const svc = (id: string, spans: number) => ({
  id,
  kind: "service" as const,
  spans,
});

function seed(over: Partial<ParsedSeed> = {}): ParsedSeed {
  return {
    nodes: [],
    virtualNodes: [],
    edges: [],
    truncated: false,
    clientNoPeer: 0,
    ...over,
  };
}

describe("chooseHub (R2-2)", () => {
  it("the busiest connected service beats a busier unconnected one", () => {
    expect(
      chooseHub(
        [svc("lonely", 5000), svc("a", 100), svc("b", 300)],
        [{ source: "a", target: "b" }]
      )
    ).toBe("b");
  });

  it("pinned: a service whose only edge is virtual counts as connected; virtual nodes never win", () => {
    const nodes = [
      svc("batch", 900),
      svc("a", 500),
      svc("b", 400),
      { id: "db:postgresql/main", kind: "database" as const, spans: 5000 },
    ];
    const edges = [
      { source: "batch", target: "db:postgresql/main" },
      { source: "a", target: "b" },
    ];
    expect(chooseHub(nodes, edges)).toBe("batch");
  });

  it("with nothing connected, the plain busiest service wins", () => {
    expect(chooseHub([svc("x", 10), svc("y", 30), svc("z", 20)], [])).toBe("y");
  });

  it("ties are broken by name; self-loops are not connections", () => {
    expect(
      chooseHub(
        [svc("m", 50), svc("c", 50), svc("k", 50)],
        [
          { source: "m", target: "k" },
          { source: "c", target: "c" },
        ]
      )
    ).toBe("k");
    expect(chooseHub([svc("b", 7), svc("a", 7)], [])).toBe("a");
  });

  it("no services → null", () => {
    expect(chooseHub([], [])).toBeNull();
    expect(
      chooseHub([{ id: "ext:x", kind: "external", spans: 3 }], [])
    ).toBeNull();
  });
});

describe("createGraphState", () => {
  it("the hub never changes once set, even when a busier connected service appears", () => {
    const g = createGraphState();
    g.applySeed(
      seed({
        nodes: [
          { id: "a", spans: 100, errors: 0, errorRate: 0 },
          { id: "b", spans: 50, errors: 0, errorRate: 0 },
        ],
      })
    );
    g.addPair({ source: "a", target: "b", tsMs: NOW - MIN, err: false });
    expect(g.selectHub()).toBe("a");
    g.applySeed(
      seed({
        nodes: [
          { id: "a", spans: 100, errors: 0, errorRate: 0 },
          { id: "c", spans: 99_999, errors: 0, errorRate: 0 },
        ],
      })
    );
    g.addPair({ source: "c", target: "b", tsMs: NOW - MIN, err: false });
    expect(g.selectHub()).toBe("a");
    expect(g.buildSnapshot(NOW).hub).toBe("a");
  });

  it("selectHub picks the virtual-only service from a seed (pinned case)", () => {
    const g = createGraphState();
    g.applySeed(
      seed({
        nodes: [
          { id: "batch", spans: 900, errors: 0, errorRate: 0 },
          { id: "a", spans: 500, errors: 0, errorRate: 0 },
          { id: "b", spans: 400, errors: 0, errorRate: 0 },
        ],
        virtualNodes: [
          {
            id: "db:postgresql/main",
            label: "main (postgresql)",
            kind: "database",
          },
        ],
        edges: [
          {
            source: "batch",
            target: "db:postgresql/main",
            calls: 9000,
            errors: 0,
          },
        ],
      })
    );
    g.addPair({ source: "a", target: "b", tsMs: NOW - MIN, err: false });
    expect(g.selectHub()).toBe("batch");
    expect(g.isConnected("batch")).toBe(true);
  });

  it("builds a snapshot with seed nodes, virtual edges and bucketed real edges", () => {
    const g = createGraphState();
    g.applySeed(
      seed({
        nodes: [
          { id: "web", spans: 200, errors: 2, errorRate: 0.01 },
          { id: "cart", spans: 100, errors: 0, errorRate: 0 },
        ],
        virtualNodes: [
          { id: "db:redis", label: "redis", kind: "database" },
          { id: "mq:kafka/orders", label: "orders (kafka)", kind: "messaging" },
        ],
        edges: [
          { source: "cart", target: "db:redis", calls: 40, errors: 4 },
          { source: "mq:kafka/orders", target: "cart", calls: 6, errors: 0 },
        ],
      })
    );
    g.addPair({
      source: "web",
      target: "cart",
      tsMs: NOW - 2 * MIN,
      err: true,
    });
    g.addPair({ source: "web", target: "cart", tsMs: NOW - MIN, err: false });
    g.observeSpan("web", NOW - MIN, false);
    const snap = g.buildSnapshot(NOW);
    expect(snap.nodes.map((n) => [n.id, n.kind, n.spans, n.active])).toEqual([
      ["cart", "service", 100, true],
      ["db:redis", "database", 40, true],
      ["mq:kafka/orders", "messaging", 6, true],
      ["web", "service", 200, true],
    ]);
    expect(snap.nodes.find((n) => n.id === "db:redis")?.errorRate).toBe(0.1);
    expect(snap.edges).toEqual([
      {
        id: edgeId("cart", "db:redis"),
        source: "cart",
        target: "db:redis",
        calls: 40,
        errors: 4,
        active: true,
        virtual: true,
      },
      {
        id: edgeId("mq:kafka/orders", "cart"),
        source: "mq:kafka/orders",
        target: "cart",
        calls: 6,
        errors: 0,
        active: true,
        virtual: true,
      },
      {
        id: edgeId("web", "cart"),
        source: "web",
        target: "cart",
        calls: 2,
        errors: 1,
        active: true,
        virtual: false,
      },
    ]);
    expect(snap.spansInWindow).toBe(1);
  });

  it("edges whose buckets age out of M dim (weight drops, active false) but stay", () => {
    const g = createGraphState();
    g.addPair({ source: "a", target: "b", tsMs: NOW - 50 * MIN, err: false });
    g.addPair({ source: "a", target: "b", tsMs: NOW - 5 * MIN, err: false });
    g.addPair({ source: "b", target: "c", tsMs: NOW - 5 * MIN, err: false });

    const at = (t: number) => g.buildSnapshot(t);
    expect(at(NOW).edges.find((e) => e.id === "a->b")?.calls).toBe(2);
    expect(at(NOW + 20 * MIN).edges.find((e) => e.id === "a->b")?.calls).toBe(
      1
    );

    g.trim(NOW + 70 * MIN);
    const later = at(NOW + 70 * MIN);
    expect(later.edges.map((e) => [e.id, e.calls, e.active])).toEqual([
      ["a->b", 0, false],
      ["b->c", 0, false],
    ]);
    // nodes without seed spans dim too, and never disappear
    expect(later.nodes.map((n) => [n.id, n.active])).toEqual([
      ["a", false],
      ["b", false],
      ["c", false],
    ]);
  });

  it("a reseed that no longer lists a virtual edge or service dims it, never removes it", () => {
    const g = createGraphState();
    g.applySeed(
      seed({
        nodes: [{ id: "a", spans: 10, errors: 0, errorRate: 0 }],
        virtualNodes: [{ id: "ext:x", label: "x", kind: "external" }],
        edges: [{ source: "a", target: "ext:x", calls: 5, errors: 0 }],
      })
    );
    g.applySeed(seed());
    const snap = g.buildSnapshot(NOW);
    expect(snap.nodes.map((n) => [n.id, n.active])).toEqual([
      ["a", false],
      ["ext:x", false],
    ]);
    expect(snap.edges).toEqual([
      expect.objectContaining({ id: "a->ext:x", calls: 0, active: false }),
    ]);
  });

  it("a service the next reseed drops dims at once: listing it in a seed never extends its activity", () => {
    const g = createGraphState();
    // Last span of `a` at NOW − 50 min; the seed at NOW still lists it.
    g.observeSpan("a", NOW - 50 * MIN, false);
    g.applySeed(
      seed({
        nodes: [{ id: "a", spans: 10, errors: 0, errorRate: 0 }],
        virtualNodes: [{ id: "ext:x", label: "x", kind: "external" }],
        edges: [{ source: "a", target: "ext:x", calls: 5, errors: 0 }],
      })
    );
    expect(g.buildSnapshot(NOW).nodes.every((n) => n.active)).toBe(true);
    // The reseed 15 min later no longer lists it: its last span is > M old.
    g.applySeed(seed());
    const later = g.buildSnapshot(NOW + 15 * MIN);
    expect(later.nodes.map((n) => [n.id, n.active])).toEqual([
      ["a", false],
      ["ext:x", false],
    ]);
  });

  it("caps nodes at NODE_CAP and edges at the edge cap, never removing anything", () => {
    const g = createGraphState({ nodeCap: 5, edgeCap: 3 });
    for (let i = 0; i < 8; i++) g.observeSpan(`s${i}`, NOW - MIN, false);
    expect(g.nodeCount()).toBe(5);
    expect(
      g.addPair({ source: "s0", target: "s7", tsMs: NOW, err: false })
    ).toBe(false);
    for (let i = 1; i < 5; i++) {
      g.addPair({ source: "s0", target: `s${i}`, tsMs: NOW - MIN, err: false });
    }
    const snap = g.buildSnapshot(NOW);
    expect(snap.nodeCapHit).toBe(true);
    expect(snap.nodes).toHaveLength(5);
    expect(snap.edges).toHaveLength(3);
    expect(snap.edgesDropped).toBe(1);
  });
});

describe("long run: caps independent of session length (Q2)", () => {
  it(
    "200k tuples over a simulated 24 h keep size ≤ 50k, edges ≤ 2500, nodes ≤ 2000",
    { timeout: 60_000 },
    () => {
      const DAY = 24 * 60 * MIN;
      const start = NOW;
      const t0 = start;
      const buf = createJoinBuffer({ t0Ms: t0 });
      const g = createGraphState();
      // deterministic mulberry32
      let r = 42;
      const rnd = (n: number) => {
        r = (r + 0x6d2b79f5) | 0;
        let x = Math.imul(r ^ (r >>> 15), 1 | r);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) % n;
      };
      const TOTAL = 200_000;
      const TICKS = 200; // one simulated tick every 7.2 min
      const perTick = TOTAL / TICKS;
      let id = 0;
      let checkpoints = 0;
      for (let tick = 0; tick < TICKS; tick++) {
        const tickStart = start + (tick * DAY) / TICKS;
        const region: Region = "fwd";
        for (let i = 0; i < perTick; i++) {
          const ts = tickStart + i; // dense: 1000 spans within one second
          const rootSvc = `svc-${rnd(3000)}`; // more services than NODE_CAP
          const parentId = `s${id}`;
          const parent: SpanTuple = {
            spanId: parentId,
            parentId: rnd(3) === 0 ? `missing-${id}` : "",
            svc: rootSvc,
            kind: "Client",
            tsMs: ts,
            endMs: ts + 5,
            err: false,
          };
          id++;
          for (const p of buf.ingest(parent, region)) g.addPair(p);
          g.observeSpan(parent.svc, ts, false);
          i++;
          // its child (another service, so edges keep growing past EDGE_CAP)
          const child: SpanTuple = {
            spanId: `s${id++}`,
            parentId,
            svc: `svc-${rnd(3000)}`,
            kind: "Server",
            tsMs: ts + 1,
            endMs: ts + 4,
            err: rnd(50) === 0,
          };
          for (const p of buf.ingest(child, region)) g.addPair(p);
          g.observeSpan(child.svc, child.tsMs, child.err);
        }
        // expire only every 60 ticks, so the buffer overfills in between
        const now = tickStart + 1_000;
        if (tick % 60 === 59) buf.expire(t0 - 60 * MIN, now, true);
        if (tick % 10 === 9) {
          g.trim(now);
          const snap = g.buildSnapshot(now);
          expect(buf.size()).toBeLessThanOrEqual(JOIN_CAP);
          expect(snap.edges.length).toBeLessThanOrEqual(EDGE_CAP);
          expect(snap.nodes.length).toBeLessThanOrEqual(NODE_CAP);
          checkpoints++;
        }
      }
      expect(checkpoints).toBe(20);
      expect(id).toBe(TOTAL);
      const final = g.buildSnapshot(start + DAY);
      // every cap was actually reached
      expect(buf.counters().dropped).toBeGreaterThan(0);
      expect(final.nodeCapHit).toBe(true);
      expect(final.edges.length).toBe(EDGE_CAP);
      expect(final.edgesDropped).toBeGreaterThan(0);
      expect(g.nodeCount()).toBe(NODE_CAP);
    }
  );
});
