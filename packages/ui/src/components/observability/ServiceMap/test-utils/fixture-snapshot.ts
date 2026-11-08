/**
 * Turns layout fixtures (discovery frames) into engine snapshots, so tests
 * and stories render exactly what a live session would hand the view.
 * Not exported from the package index.
 */
import { M_MS, SCAN_MAX_REQUESTS } from "../engine/config.js";
import { edgeId } from "../engine/graph-state.js";
import type {
  Diagnostics,
  ScanState,
  ServiceMapSnapshot,
} from "../engine/types.js";
import {
  discover,
  rng,
  type Fixture,
  type FixtureFrame,
  type FixtureNode,
} from "../layout/fixtures.js";

/** Fixed "now" so stories and tests are deterministic. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 10, 6, 12, 0, 0);

export const ZERO_DIAGNOSTICS: Diagnostics = {
  dropped: 0,
  lateUnpaired: 0,
  dupes: 0,
  badTimestamp: 0,
  selfCalls: 0,
  clientNoPeer: 0,
  nodeCapHit: false,
  edgesDropped: 0,
  seedTruncated: false,
};

export interface FixtureSnapshotOptions {
  /** Nodes with no traffic in the past 60 min; edges touching them are inactive too. */
  inactive?: Iterable<string>;
  scan?: Partial<ScanState>;
  /** Minutes of the 60-min window covered so far (default 60). */
  coveredMin?: number;
  diagnostics?: Partial<Diagnostics>;
  error?: string | null;
  seq?: number;
}

/** One engine snapshot from one fixture frame. */
export function fixtureSnapshot(
  frame: FixtureFrame,
  opts: FixtureSnapshotOptions = {}
): ServiceMapSnapshot {
  const inactive = new Set(opts.inactive ?? []);
  const kind = new Map(frame.nodes.map((n) => [n.id, n.kind]));
  const nodes = frame.nodes.map((n: FixtureNode) => ({
    id: n.id,
    label: n.label ?? n.id,
    kind: n.kind,
    spans: n.spans,
    errorRate: n.errorRate ?? 0,
    active: !inactive.has(n.id),
  }));
  const edges = frame.edges
    .filter((e) => e.source !== e.target)
    .map((e) => ({
      id: edgeId(e.source, e.target),
      source: e.source,
      target: e.target,
      calls: e.calls,
      errors: 0,
      active: !inactive.has(e.source) && !inactive.has(e.target),
      virtual:
        kind.get(e.source) !== "service" || kind.get(e.target) !== "service",
    }));
  const coveredMin = opts.coveredMin ?? 60;
  return {
    seq: opts.seq ?? 1,
    hub: frame.hub,
    nodes,
    edges,
    coverage: {
      fromMs: FIXTURE_NOW_MS - coveredMin * 60_000,
      toMs: FIXTURE_NOW_MS,
      windowMs: M_MS,
    },
    spansInWindow: frame.nodes.reduce(
      (s, n) => s + (n.kind === "service" ? n.spans : 0),
      0
    ),
    scan: {
      state: "live",
      stopReason: "coverage",
      requests: 48,
      maxRequests: SCAN_MAX_REQUESTS,
      behindMs: 0,
      ...opts.scan,
    },
    diagnostics: { ...ZERO_DIAGNOSTICS, ...opts.diagnostics },
    error: opts.error ?? null,
  };
}

/**
 * Every discovery frame of a fixture as a snapshot: frames 1–4 are a
 * running backward scan covering 12, 24, 36, 48 min; the last frame is live.
 */
export function fixtureSnapshots(
  fixture: Fixture,
  opts: Omit<FixtureSnapshotOptions, "scan" | "coveredMin" | "seq"> = {}
): ServiceMapSnapshot[] {
  const frames = discover(fixture);
  return frames.map((f, i) => {
    const last = i === frames.length - 1;
    return fixtureSnapshot(f, {
      ...opts,
      seq: i + 1,
      coveredMin: last ? 60 : (i + 1) * 12,
      scan: last
        ? { state: "live", stopReason: "coverage", requests: 4 + i * 10 }
        : { state: "scanning", stopReason: null, requests: 3 + i * 10 },
    });
  });
}

/**
 * A large tiered system for the React Flow perf check: `nNodes` nodes
 * (about 8 % databases/queues/external APIs) and exactly `nEdges` distinct
 * directed edges, most of them going to the next tier. Deterministic.
 */
export function perfFixture(nNodes = 500, nEdges = 900, seed = 11): Fixture {
  const r = rng(seed);
  const nVirtual = Math.round(nNodes * 0.08);
  const nSvc = nNodes - nVirtual;
  const tiers = 6;
  const nodes: FixtureNode[] = [];
  const tierOf: string[][] = Array.from({ length: tiers }, () => []);
  for (let i = 0; i < nSvc; i++) {
    const tier = i === 0 ? 0 : 1 + Math.floor((i / nSvc) * (tiers - 1));
    const id = `svc-${String(i).padStart(3, "0")}`;
    nodes.push({
      id,
      kind: "service",
      spans: Math.round(200000 / Math.pow(i + 1, 0.8)),
      errorRate: r() < 0.06 ? 0.01 + r() * 0.08 : r() * 0.004,
    });
    (tierOf[Math.min(tiers - 1, tier)] as string[]).push(id);
  }
  const virtuals: string[] = [];
  const vKinds = ["database", "messaging", "external"] as const;
  for (let i = 0; i < nVirtual; i++) {
    const k = vKinds[i % 3] as (typeof vKinds)[number];
    const id = `${k === "database" ? "db" : k === "messaging" ? "mq" : "ext"}-${i}`;
    nodes.push({ id, kind: k, spans: 0, label: `${k} · ${i}` });
    virtuals.push(id);
  }
  const seen = new Set<string>();
  const edges: Fixture["edges"] = [];
  const add = (s: string, t: string, calls: number) => {
    const key = `${s}\u0000${t}`;
    if (s === t || seen.has(key)) return false;
    seen.add(key);
    edges.push({ source: s, target: t, calls, stage: 1 + Math.floor(r() * 5) });
    return true;
  };
  // Spanning edges first: every service gets a caller in the tier above.
  for (let t = 1; t < tiers; t++) {
    const above = tierOf[t - 1] as string[];
    for (const id of tierOf[t] as string[]) {
      add(
        above[Math.floor(r() * above.length)] as string,
        id,
        50 + Math.floor(r() * 20000)
      );
    }
  }
  // Every virtual node gets one client.
  for (const v of virtuals) {
    add(
      `svc-${String(1 + Math.floor(r() * (nSvc - 1))).padStart(3, "0")}`,
      v,
      100 + Math.floor(r() * 9000)
    );
  }
  // Fill up to exactly nEdges with tier-forward and a few cross-tier calls.
  let guard = 0;
  while (edges.length < nEdges && guard++ < nEdges * 50) {
    const t = Math.floor(r() * (tiers - 1));
    const from = tierOf[t] as string[];
    const toTier = r() < 0.85 ? t + 1 : Math.floor(r() * tiers);
    const to = r() < 0.15 ? virtuals : (tierOf[toTier] as string[]);
    add(
      from[Math.floor(r() * from.length)] as string,
      to[Math.floor(r() * to.length)] as string,
      10 + Math.floor(r() * 5000)
    );
  }
  return { nodes, edges };
}
