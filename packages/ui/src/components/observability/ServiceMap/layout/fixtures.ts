/**
 * Layout fixtures as discovery sequences (the mock-up's 5 stages), shared by
 * tests and stories. `genSystem`, `chain`, `star` and the shop graph are
 * deterministic ports of docs/service-map/mockup-scale.js and
 * mockup-layouts.html, with the same seeds, so move counts are comparable
 * with the mock-up's "Scale check for layout D".
 */
import { chooseHub } from "../engine/graph-state.js";
import type { NodeKind } from "../engine/types.js";
import type { LayoutGraph } from "./layout-d.js";

export interface FixtureNode {
  id: string;
  kind: NodeKind;
  spans: number;
  label?: string;
  /** Error rate as a fraction (0.026 = 2.6 %). */
  errorRate?: number;
  /** First frame the node is known in (default 1: the aggregate seed). */
  stage?: number;
}

export interface FixtureEdge {
  source: string;
  target: string;
  calls: number;
  /** First frame the connection is known in. */
  stage: number;
}

export interface Fixture {
  nodes: FixtureNode[];
  edges: FixtureEdge[];
}

export interface FixtureFrame extends LayoutGraph {
  nodes: FixtureNode[];
  edges: FixtureEdge[];
}

/** Number of discovery frames, as in the mock-up (frame 1, page 3, 12, 41, done). */
export const STAGES = 5;

/**
 * Replays a fixture as `stages` frames: frame `st` holds every node and edge
 * with `stage <= st`. The hub is chosen once, on the first frame with a
 * service (R2-2), and never changes.
 */
export function discover(f: Fixture, stages = STAGES): FixtureFrame[] {
  const frames: FixtureFrame[] = [];
  let hub: string | null = null;
  for (let st = 1; st <= stages; st++) {
    const nodes = f.nodes.filter((n) => (n.stage ?? 1) <= st);
    const known = new Set(nodes.map((n) => n.id));
    const edges = f.edges.filter(
      (e) => e.stage <= st && known.has(e.source) && known.has(e.target)
    );
    hub ??= chooseHub(nodes, edges);
    frames.push({ nodes, edges, hub });
  }
  return frames;
}

/** mulberry32, the mock-up's `rng`. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svc = (id: string, spans: number, errorRate = 0): FixtureNode => ({
  id,
  kind: "service",
  spans,
  errorRate,
});
const edge = (
  source: string,
  target: string,
  calls: number,
  stage = 1
): FixtureEdge => ({ source, target, calls, stage });

type MockType = "svc" | "db" | "queue" | "ext";
const KIND: Record<MockType, NodeKind> = {
  svc: "service",
  db: "database",
  queue: "messaging",
  ext: "external",
};

/** Port of the mock-up's `genSystem(nSvc, seed)`. */
export function genSystem(nSvc: number, seed: number): Fixture {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)] as T;
  const W1 = [
    "order",
    "cart",
    "user",
    "payment",
    "shipment",
    "stock",
    "price",
    "promo",
    "review",
    "search",
    "recs",
    "media",
    "auth",
    "tax",
    "fraud",
    "loyalty",
    "invoice",
    "refund",
    "notify",
    "geo",
    "catalog",
    "vendor",
    "ledger",
    "quote",
    "route",
    "label",
    "audit",
    "consent",
    "session",
    "profile",
    "wallet",
    "coupon",
    "return",
    "warehouse",
    "courier",
    "rating",
    "feed",
    "chat",
    "report",
    "billing",
    "plan",
    "quota",
    "export",
    "import",
    "image",
    "pdf",
    "sms",
    "email",
    "ab-test",
    "pricing",
  ];
  const W2 = [
    "-svc",
    "-api",
    "-worker",
    "-core",
    "-reader",
    "-writer",
    "-gw",
    "-engine",
    "-store",
    "-proxy",
  ];
  const hub = "edge-gateway";
  const ups =
    nSvc > 50
      ? ["web-app", "mobile-bff", "partner-api", "admin-console"]
      : ["web-app", "mobile-bff"];
  const used = new Set([hub, ...ups]);
  const nm = () => {
    for (let i = 0; i < 80; i++) {
      const n = pick(W1) + pick(W2);
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    const n = "svc-" + used.size;
    used.add(n);
    return n;
  };
  const nodes: (FixtureNode & { type: MockType })[] = [];
  const E = new Map<string, FixtureEdge>();
  const add = (s: string, t: string, calls: number, stage: number) => {
    if (s === t) return;
    const k = s + ">" + t;
    if (!E.has(k)) {
      E.set(k, edge(s, t, Math.max(5, Math.round(calls)), stage));
    }
  };
  const nDom = Math.max(1, nSvc - 1 - ups.length);
  const dom = Array.from({ length: nDom }, nm);
  const all = [hub, ...ups, ...dom];
  const spans = new Map<string, number>();
  all.forEach((id, i) =>
    spans.set(
      id,
      Math.round((90000 / Math.pow(1 + i, 0.8)) * (0.7 + 0.6 * r()))
    )
  );
  spans.set(hub, Math.max(...spans.values()) + 5000);
  const sp = (id: string) => spans.get(id) as number;
  all.forEach((id) =>
    nodes.push({
      id,
      type: "svc",
      kind: "service",
      spans: sp(id),
      errorRate: 0,
    })
  );
  const nFront = Math.max(3, Math.round(nDom * 0.15));
  const nIso = Math.max(1, Math.round(nDom * 0.03));
  const nWork = Math.max(1, Math.round(nDom * 0.08));
  const workers = dom.slice(nDom - nIso - nWork, nDom - nIso);
  const iso = dom.slice(nDom - nIso);
  ups.forEach((u) => add(u, hub, sp(u) * 0.8, 1));
  ups
    .slice(1)
    .forEach((u) => add(u, pick(dom.slice(0, nFront)), sp(u) * 0.2, 1));
  dom.forEach((s, i) => {
    if (workers.includes(s) || iso.includes(s)) return;
    if (i < nFront) {
      add(hub, s, sp(s) * 0.6, 0);
      return;
    }
    add(dom[Math.floor(i * Math.pow(r(), 1.6))] as string, s, sp(s) * 0.5, 0);
    if (r() < 0.25) add(dom[Math.floor(i * r())] as string, s, sp(s) * 0.2, 0);
  });
  const virt = (prefix: string, n: number, type: MockType, lab: () => string) =>
    Array.from({ length: n }, (_, i) => {
      const id = prefix + i;
      nodes.push({ id, type, kind: KIND[type], spans: 0, label: lab() });
      return id;
    });
  const dbs = virt(
    "db",
    Math.max(2, Math.round(nSvc * 0.12)),
    "db",
    () => pick(["postgres", "mysql", "mongodb"]) + " · " + pick(W1)
  );
  const caches = virt(
    "cache",
    Math.max(1, Math.round(nSvc * 0.02)),
    "db",
    () => "redis · " + pick(W1)
  );
  const qs = virt(
    "q",
    Math.max(1, Math.round(nSvc * 0.03)),
    "queue",
    () => "kafka · " + pick(W1) + "-events"
  );
  const exts = [
    "api.stripe.com",
    "api.twilio.com",
    "maps.googleapis.com",
    "api.sendgrid.com",
    "s3.amazonaws.com",
  ]
    .slice(0, nSvc > 50 ? 5 : 3)
    .map((x) => {
      nodes.push({
        id: "x:" + x,
        type: "ext",
        kind: "external",
        spans: 0,
        label: x,
      });
      return "x:" + x;
    });
  const zipf = (a: readonly string[]) =>
    a[
      Math.min(a.length - 1, Math.floor(a.length * Math.pow(r(), 2)))
    ] as string;
  dom.forEach((s) => {
    if (iso.includes(s)) {
      if (r() < 0.5) add(s, zipf(dbs), sp(s) * 0.9, 1);
      return;
    }
    if (r() < 0.6) add(s, zipf(dbs), sp(s) * 0.7, 1);
    if (r() < 0.2) add(s, pick(caches), sp(s) * 0.9, 1);
    if (r() < 0.1) add(s, pick(qs), sp(s) * 0.3, 1);
    if (r() < 0.06) add(s, pick(exts), sp(s) * 0.2, 1);
  });
  workers.forEach((w) => {
    add(pick(qs), w, sp(w) * 0.8, 1);
    if (r() < 0.5) add(w, zipf(dbs), sp(w) * 0.5, 1);
  });
  qs.forEach((q) => {
    if (![...E.values()].some((e) => e.target === q)) {
      add(pick(dom.slice(0, nFront)), q, 500, 1);
    }
  });
  const late = [...E.values()]
    .filter((e) => e.stage === 0)
    .sort((a, b) => b.calls - a.calls);
  late.forEach(
    (e, i) =>
      (e.stage =
        1 + Math.min(4, Math.floor((i / late.length) * 5 * (0.6 + 0.8 * r()))))
  );
  const touched = new Set<string>();
  E.forEach((e) => {
    touched.add(e.source);
    touched.add(e.target);
  });
  return {
    nodes: nodes
      .filter((n) => n.type === "svc" || touched.has(n.id))
      .map((n): FixtureNode => {
        const { id, kind, spans, label, errorRate } = n;
        return label === undefined
          ? { id, kind, spans, errorRate }
          : { id, kind, spans, label, errorRate };
      }),
    edges: [...E.values()],
  };
}

/** Port of the mock-up's `chain(n)`: each service calls the next. */
export function chain(n: number): Fixture {
  const ids = Array.from(
    { length: n },
    (_, i) => "step-" + String(i + 1).padStart(2, "0")
  );
  const mid = Math.floor(n / 2);
  return {
    nodes: ids.map((id, i) => svc(id, 22000 - Math.abs(i - mid) * 1300)),
    edges: ids
      .slice(1)
      .map((id, i) =>
        edge(
          ids[i] as string,
          id,
          9000,
          1 + Math.min(4, Math.floor(Math.abs(i + 0.5 - mid) / 1.5))
        )
      ),
  };
}

/** Port of the mock-up's `star(n)`: one gateway calling n functions. */
export function star(n: number): Fixture {
  const r = rng(5);
  const nodes: FixtureNode[] = [
    svc("api-gateway", 95000),
    svc("web-app", 60000),
  ];
  const edges: FixtureEdge[] = [];
  const dbs = [
    "postgres · main",
    "postgres · events",
    "redis · cache",
    "mongodb · docs",
  ].map((label, i) => {
    nodes.push({ id: "db" + i, kind: "database", spans: 0, label });
    return "db" + i;
  });
  edges.push(edge("web-app", "api-gateway", 50000, 1));
  for (let i = 0; i < n; i++) {
    const id = "fn-" + String(i + 1).padStart(3, "0");
    const spans = Math.round(30000 / Math.pow(i + 1, 0.7));
    nodes.push(svc(id, spans));
    edges.push(
      edge(
        "api-gateway",
        id,
        spans * 0.8,
        1 + Math.min(4, Math.floor((i / n) * 5))
      )
    );
    if (r() < 0.5) {
      edges.push(edge(id, dbs[Math.floor(r() * 4)] as string, spans * 0.5, 1));
    }
  }
  return { nodes, edges };
}

/** The shop example from mockup-layouts.html (NODES/EDGES). */
export function shop(): Fixture {
  const v = (id: string, kind: NodeKind, label: string): FixtureNode => ({
    id,
    kind,
    spans: 0,
    label,
  });
  return {
    nodes: [
      svc("api-gateway", 48200, 0.004),
      svc("web-frontend", 31500, 0.002),
      svc("catalog", 22800, 0.001),
      svc("cart", 15400, 0.003),
      svc("user-auth", 12900, 0.002),
      svc("pricing", 9800, 0.001),
      svc("search", 8600, 0.002),
      svc("inventory", 7400, 0.005),
      svc("checkout", 6100, 0.018),
      svc("recommendations", 5300, 0),
      svc("payments", 3900, 0.026),
      svc("shipping", 2100, 0.009),
      svc("notifications-worker", 1700, 0.004),
      svc("report-cron", 900, 0),
      v("postgres", "database", "postgres · orders"),
      v("redis", "database", "redis · sessions"),
      v("elasticsearch", "database", "elasticsearch · products"),
      v("kafka", "messaging", "kafka · order-events"),
      v("stripe", "external", "api.stripe.com"),
      v("sendgrid", "external", "api.sendgrid.com"),
    ],
    edges: (
      [
        ["catalog", "postgres", 14200, 1],
        ["cart", "redis", 21000, 1],
        ["user-auth", "redis", 9400, 1],
        ["user-auth", "postgres", 2300, 1],
        ["payments", "postgres", 3700, 1],
        ["payments", "stripe", 3800, 1],
        ["inventory", "postgres", 6800, 1],
        ["shipping", "postgres", 1800, 1],
        ["checkout", "kafka", 3600, 1],
        ["kafka", "notifications-worker", 3500, 1],
        ["notifications-worker", "sendgrid", 1600, 1],
        ["search", "elasticsearch", 8100, 1],
        ["report-cron", "postgres", 850, 1],
        ["web-frontend", "api-gateway", 29800, 1],
        ["api-gateway", "catalog", 18200, 1],
        ["api-gateway", "cart", 12100, 1],
        ["api-gateway", "user-auth", 11800, 1],
        ["catalog", "pricing", 8900, 1],
        ["api-gateway", "checkout", 4100, 2],
        ["checkout", "cart", 3900, 2],
        ["checkout", "payments", 3800, 2],
        ["checkout", "inventory", 3700, 2],
        ["checkout", "shipping", 1900, 3],
        ["api-gateway", "search", 7300, 3],
        ["api-gateway", "recommendations", 4600, 4],
        ["recommendations", "catalog", 4400, 4],
        ["payments", "user-auth", 3700, 5],
      ] as const
    ).map(([s, t, calls, stage]) => edge(s, t, calls, stage)),
  };
}

/** A hub that only receives calls: three levels of callers, nothing outgoing. */
export function hubOnlyIncoming(): Fixture {
  const nodes = [svc("ledger", 50000)];
  const edges: FixtureEdge[] = [];
  for (let i = 0; i < 6; i++) {
    const a = `caller-${i}`;
    nodes.push(svc(a, 20000 - i * 1000));
    edges.push(edge(a, "ledger", 5000 - i * 100, 1 + (i % 3)));
    for (let j = 0; j < 3; j++) {
      const b = `${a}-client-${j}`;
      nodes.push(svc(b, 3000 - j * 100));
      edges.push(edge(b, a, 900 - j * 10, 2 + ((i + j) % 4)));
      if (j === 0) {
        const c = `${b}-ui`;
        nodes.push(svc(c, 800));
        edges.push(edge(c, b, 300, 3 + (i % 3)));
      }
    }
  }
  return { nodes, edges };
}

/** Directed cycles of several lengths, including two-node loops and a cycle through the hub. */
export function cycles(): Fixture {
  const nodes = [
    svc("hub", 40000),
    svc("a", 9000),
    svc("b", 8000),
    svc("c", 7000),
    svc("d", 6000),
    svc("e", 5000),
    svc("f", 4000),
  ];
  return {
    nodes,
    edges: [
      edge("hub", "a", 5000, 1),
      edge("a", "b", 4000, 1),
      edge("b", "hub", 3000, 2),
      edge("a", "c", 2000, 2),
      edge("c", "a", 1900, 3),
      edge("c", "d", 1500, 3),
      edge("d", "e", 1200, 4),
      edge("e", "f", 1100, 4),
      edge("f", "c", 1000, 5),
      edge("e", "e", 999, 1),
    ],
  };
}

/** Services that call themselves; self-calls never become edges (R1-D7). */
export function selfCalls(): Fixture {
  return {
    nodes: [svc("api", 9000), svc("worker", 4000), svc("cron", 300)],
    edges: [
      edge("api", "api", 8000, 1),
      edge("worker", "worker", 3000, 1),
      edge("api", "worker", 500, 2),
      edge("cron", "cron", 100, 3),
    ],
  };
}

/** Names longer than 60 characters on services and virtual nodes. */
export function longNames(): Fixture {
  const long = (s: string) => `${s}-${"x".repeat(64 - s.length)}`;
  const hub = long("payments-orchestration-service-eu-west-1");
  const a = long("fraud-detection-realtime-scoring-engine");
  const b = long("customer-notification-dispatcher");
  const db = long("postgres-orders-primary-cluster");
  return {
    nodes: [
      svc(hub, 20000),
      svc(a, 9000),
      svc(b, 3000),
      { id: db, kind: "database", spans: 0, label: `postgres · ${db}` },
    ],
    edges: [edge(hub, a, 6000, 1), edge(hub, db, 5000, 1), edge(a, b, 1000, 3)],
  };
}

/**
 * A hub with exactly K callees (K = 6 for 7 nodes), found over several
 * frames: column +1 fills to exactly K rows in one lane.
 */
export function columnExactlyK(): Fixture {
  const nodes = [svc("gateway", 30000)];
  const edges: FixtureEdge[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `callee-${i + 1}`;
    nodes.push(svc(id, 9000 - i * 1000));
    edges.push(edge("gateway", id, 6000 - i * 500, 1 + Math.floor(i / 2) * 2));
  }
  return { nodes, edges };
}

/**
 * Tray order (plan §2.2): frame 1 has four tray nodes; frame 2 is a seed
 * refresh that reverses their spans order; frame 3 connects `tray-b`; frame 4
 * discovers a new unconnected service with the most spans of all.
 */
export function trayOrderFrames(): FixtureFrame[] {
  const hub = "api";
  const base = (spans: [number, number, number, number]): FixtureNode[] => [
    svc(hub, 50000),
    svc("tray-a", spans[0]),
    svc("tray-b", spans[1]),
    svc("tray-c", spans[2]),
    svc("tray-d", spans[3]),
  ];
  const f1 = { nodes: base([400, 300, 200, 100]), edges: [], hub };
  const f2 = { nodes: base([100, 200, 300, 400]), edges: [], hub };
  const f3 = {
    nodes: base([100, 200, 300, 400]),
    edges: [edge(hub, "tray-b", 50, 3)],
    hub,
  };
  const f4 = {
    nodes: [...base([100, 200, 300, 400]), svc("tray-new", 99999)],
    edges: [edge(hub, "tray-b", 50, 3)],
    hub,
  };
  return [f1, f2, f3, f4];
}

/** Every named fixture of the plan as a discovery sequence. */
export const FIXTURES = {
  empty: (): Fixture => ({ nodes: [], edges: [] }),
  one: (): Fixture => ({ nodes: [svc("my-app", 4200)], edges: [] }),
  oneWithDbs: (): Fixture => ({
    nodes: [
      svc("my-app", 4200),
      { id: "pg", kind: "database", spans: 0, label: "postgres · app" },
      { id: "rd", kind: "database", spans: 0, label: "redis · cache" },
      { id: "oa", kind: "external", spans: 0, label: "api.openai.com" },
    ],
    edges: [
      edge("my-app", "pg", 3100, 1),
      edge("my-app", "rd", 2600, 1),
      edge("my-app", "oa", 240, 1),
    ],
  }),
  twoUnconnected: (): Fixture => ({
    nodes: [svc("api", 5200), svc("nightly-export", 300)],
    edges: [],
  }),
  chain15: () => chain(15),
  shop20: shop,
  star150: () => star(150),
  gen120: () => genSystem(120, 42),
  gen400: () => genSystem(400, 7),
  cycles,
  selfCalls,
  hubOnlyIncoming,
  longNames,
  columnExactlyK,
} satisfies Record<string, () => Fixture>;

export type FixtureName = keyof typeof FIXTURES;

/** Discovery frames of a named fixture. */
export function fixtureFrames(name: FixtureName): FixtureFrame[] {
  return discover(FIXTURES[name]());
}
