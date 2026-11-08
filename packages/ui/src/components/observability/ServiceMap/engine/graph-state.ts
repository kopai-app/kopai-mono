import { createBuckets, type Buckets } from "./buckets.js";
import { EDGE_CAP, M_MS, NODE_CAP } from "./config.js";
import type {
  NodeKind,
  Pair,
  ParsedSeed,
  SnapshotEdge,
  SnapshotNode,
} from "./types.js";

interface NodeRec {
  id: string;
  label: string;
  kind: NodeKind;
  /** From the latest seed (0 when the latest seed no longer lists it). */
  seedSpans: number;
  seedErrors: number;
  /** Spans read from pages this session (fallback when there is no seed count). */
  observedSpans: number;
  observedErrors: number;
  lastSeenMs: number;
}

interface EdgeRec {
  id: string;
  source: string;
  target: string;
  virtual: boolean;
  /** Virtual edges only: calls/errors from the latest seed. */
  seedCalls: number;
  seedErrors: number;
}

export interface HubCandidate {
  id: string;
  kind: NodeKind;
  spans: number;
}

/**
 * R2-2: the busiest service (by spans) among services with ≥1 edge of any
 * kind, real or virtual. Fallback: the plain busiest service. Ties by name.
 * Never a virtual node. Null when there are no services.
 */
export function chooseHub(
  nodes: readonly HubCandidate[],
  edges: readonly { source: string; target: string }[]
): string | null {
  const connected = new Set<string>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    connected.add(e.source);
    connected.add(e.target);
  }
  const services = nodes.filter((n) => n.kind === "service");
  const best = (list: readonly HubCandidate[]): string | null => {
    let hub: HubCandidate | null = null;
    for (const n of list) {
      if (
        !hub ||
        n.spans > hub.spans ||
        (n.spans === hub.spans && n.id < hub.id)
      ) {
        hub = n;
      }
    }
    return hub?.id ?? null;
  };
  return best(services.filter((n) => connected.has(n.id))) ?? best(services);
}

export interface GraphSnapshot {
  hub: string | null;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  spansInWindow: number;
  nodeCapHit: boolean;
  edgesDropped: number;
}

export interface GraphState {
  /** Applies a (re)seed: registers nodes and virtual edges, replaces seed counts. */
  applySeed(seed: ParsedSeed): void;
  /**
   * Registers every known service (from getServices) as a node up front, so
   * the map lists all services before spans work out how they connect. A
   * service with no traffic in the window stays dimmed.
   */
  addServices(ids: readonly string[]): void;
  /** Counts one span of a service read from a page. */
  observeSpan(svc: string, tsMs: number, err: boolean): void;
  /** Counts one real cross-service call. False when a cap refused it. */
  addPair(pair: Pair): boolean;
  /** Chooses the hub once (R2-2); later calls return the same hub. */
  selectHub(): string | null;
  hub(): string | null;
  hasNode(id: string): boolean;
  /** Service ids (not virtual nodes). */
  services(): string[];
  /** True when the node has ≥1 edge of any kind. */
  isConnected(id: string): boolean;
  /** Busiest-first span count used for hub choice and probe order. */
  spansOf(id: string): number;
  nodeCount(): number;
  edgeCount(): number;
  /** Ages the bucket rings to `nowMs` (fixed memory). */
  trim(nowMs: number): void;
  buildSnapshot(nowMs: number): GraphSnapshot;
}

export interface GraphStateOptions {
  nodeCap?: number;
  edgeCap?: number;
  windowMs?: number;
}

/**
 * Monotonic node/edge registry (R2-3): entries are never removed; they dim
 * when their traffic ages out of M. Nodes are capped at `nodeCap` (Q16),
 * edges at `edgeCap` (PD-5).
 */
export function createGraphState(opts: GraphStateOptions = {}): GraphState {
  const nodeCap = opts.nodeCap ?? NODE_CAP;
  const edgeCap = opts.edgeCap ?? EDGE_CAP;
  const windowMs = opts.windowMs ?? M_MS;
  const nodes = new Map<string, NodeRec>();
  const edges = new Map<string, EdgeRec>();
  const degree = new Map<string, number>();
  const buckets: Buckets = createBuckets({ edgeCap, windowMs });
  let nodeCapHit = false;
  let edgesDropped = 0;
  let hub: string | null = null;
  let hubChosen = false;

  function ensureNode(
    id: string,
    kind: NodeKind,
    label: string = id
  ): NodeRec | null {
    const n = nodes.get(id);
    if (n) return n;
    if (nodes.size >= nodeCap) {
      nodeCapHit = true;
      return null;
    }
    const rec: NodeRec = {
      id,
      label,
      kind,
      seedSpans: 0,
      seedErrors: 0,
      observedSpans: 0,
      observedErrors: 0,
      lastSeenMs: Number.NEGATIVE_INFINITY,
    };
    nodes.set(id, rec);
    return rec;
  }

  function ensureEdge(
    source: string,
    target: string,
    virtual: boolean
  ): EdgeRec | null {
    const id = edgeId(source, target);
    const e = edges.get(id);
    if (e) return e;
    if (!nodes.has(source) || !nodes.has(target)) return null;
    if (edges.size >= edgeCap) {
      edgesDropped++;
      return null;
    }
    const rec: EdgeRec = {
      id,
      source,
      target,
      virtual,
      seedCalls: 0,
      seedErrors: 0,
    };
    edges.set(id, rec);
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    return rec;
  }

  const spansOf = (n: NodeRec) =>
    n.seedSpans > 0 ? n.seedSpans : n.observedSpans;

  return {
    addServices(ids) {
      for (const id of ids) if (id) ensureNode(id, "service");
    },
    applySeed(seed) {
      const listed = new Set<string>();
      for (const s of seed.nodes) {
        const n = ensureNode(s.id, "service");
        if (!n) continue;
        n.seedSpans = s.spans;
        n.seedErrors = s.errors;
        listed.add(s.id);
      }
      for (const v of seed.virtualNodes) {
        const n = ensureNode(v.id, v.kind, v.label);
        if (n && n.kind !== "service") n.label = v.label;
      }
      const virtualCalls = new Map<string, number>();
      const virtualErrors = new Map<string, number>();
      const seededEdges = new Set<string>();
      for (const e of seed.edges) {
        const rec = ensureEdge(e.source, e.target, true);
        if (!rec || !rec.virtual) continue;
        rec.seedCalls = e.calls;
        rec.seedErrors = e.errors;
        seededEdges.add(rec.id);
        const v = nodes.get(e.target)?.kind === "service" ? e.source : e.target;
        virtualCalls.set(v, (virtualCalls.get(v) ?? 0) + e.calls);
        virtualErrors.set(v, (virtualErrors.get(v) ?? 0) + e.errors);
      }
      // The latest seed is the truth for seed counts: what it no longer lists dims.
      for (const e of edges.values()) {
        if (e.virtual && !seededEdges.has(e.id)) {
          e.seedCalls = 0;
          e.seedErrors = 0;
        }
      }
      for (const n of nodes.values()) {
        if (n.kind === "service") {
          if (!listed.has(n.id)) {
            n.seedSpans = 0;
            n.seedErrors = 0;
          }
        } else {
          n.seedSpans = virtualCalls.get(n.id) ?? 0;
          n.seedErrors = virtualErrors.get(n.id) ?? 0;
        }
      }
    },

    observeSpan(svc, tsMs, err) {
      const n = ensureNode(svc, "service");
      buckets.addSpan(tsMs);
      if (!n) return;
      n.observedSpans++;
      if (err) n.observedErrors++;
      if (tsMs > n.lastSeenMs) n.lastSeenMs = tsMs;
    },

    addPair(pair) {
      const s = ensureNode(pair.source, "service");
      const t = ensureNode(pair.target, "service");
      if (!s || !t) return false;
      const e = ensureEdge(pair.source, pair.target, false);
      if (!e) return false;
      if (pair.tsMs > s.lastSeenMs) s.lastSeenMs = pair.tsMs;
      if (pair.tsMs > t.lastSeenMs) t.lastSeenMs = pair.tsMs;
      if (e.virtual) return true; // never bucket a seed edge
      return buckets.add(e.id, pair.tsMs, pair.err);
    },

    selectHub() {
      if (hubChosen) return hub;
      hub = chooseHub(
        [...nodes.values()].map((n) => ({
          id: n.id,
          kind: n.kind,
          spans: spansOf(n),
        })),
        [...edges.values()]
      );
      hubChosen = hub !== null;
      return hub;
    },
    hub: () => hub,
    hasNode: (id) => nodes.has(id),
    services: () =>
      [...nodes.values()].filter((n) => n.kind === "service").map((n) => n.id),
    isConnected: (id) => (degree.get(id) ?? 0) > 0,
    spansOf(id) {
      const n = nodes.get(id);
      return n ? spansOf(n) : 0;
    },
    nodeCount: () => nodes.size,
    edgeCount: () => edges.size,
    trim: (nowMs) => buckets.trim(nowMs),

    buildSnapshot(nowMs) {
      const lo = nowMs - windowMs;
      const snapNodes: SnapshotNode[] = [...nodes.values()]
        .map((n) => {
          const fromSeed = n.seedSpans > 0;
          const spans = fromSeed ? n.seedSpans : n.observedSpans;
          const errors = fromSeed ? n.seedErrors : n.observedErrors;
          return {
            id: n.id,
            label: n.label,
            kind: n.kind,
            spans,
            errorRate: spans > 0 ? errors / spans : 0,
            active: n.lastSeenMs >= lo || n.seedSpans > 0,
          };
        })
        .sort((a, b) => cmp(a.id, b.id));
      const snapEdges: SnapshotEdge[] = [...edges.values()]
        .map((e) => {
          const { calls, errors } = e.virtual
            ? { calls: e.seedCalls, errors: e.seedErrors }
            : buckets.sumLastM(e.id, nowMs);
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            calls,
            errors,
            active: calls > 0,
            virtual: e.virtual,
          };
        })
        .sort((a, b) => cmp(a.id, b.id));
      return {
        hub,
        nodes: snapNodes,
        edges: snapEdges,
        spansInWindow: buckets.spansLastM(nowMs),
        nodeCapHit,
        edgesDropped: edgesDropped + buckets.edgesDropped(),
      };
    },
  };
}

export function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
