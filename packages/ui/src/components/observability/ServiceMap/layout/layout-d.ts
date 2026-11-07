/**
 * Layout D, "centred flow" (R2-8, R2-9, Q19, PR §5.5).
 *
 * Incremental port of `computeFlow` from docs/service-map/mockup-scale.js:
 * the hub sits at (0,0); callees go right by shortest directed distance from
 * the hub, callers go left by shortest directed distance to the hub, anything
 * else takes its strongest placed neighbour's column ±1. Columns wrap into
 * lanes of K rows. A node is anchored once placed.
 *
 * Q19: on frame 1 (the first call with a hub) lanes are reserved for every
 * column from the expected final size, so later frames rarely need a new lane.
 * Reservations never shrink. When a column still overflows, it gains a lane and
 * every column further out shifts as one block; the shift is reported as a
 * `ShiftEvent` so the canvas can animate it.
 *
 * Pure and deterministic: `prev` is never mutated, and every iteration order
 * is fixed (calls desc, then id).
 */
import {
  COL_GAP,
  K_MAX,
  K_MIN,
  LANE,
  LANE_PENALTY,
  ROW,
  TRAY_COL,
  TRAY_GAP,
  TRAY_MIN_PER_ROW,
  TRAY_ROW,
} from "./constants.js";

export interface LayoutNode {
  id: string;
  spans: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
  calls: number;
}

export interface LayoutGraph {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
  /** Chosen by the engine (R2-2). Only read until the layout has a hub. */
  hub: string | null;
}

export interface Point {
  x: number;
  y: number;
}

/** Column, lane inside the column, row inside the lane. */
export interface Slot {
  c: number;
  l: number;
  r: number;
}

export interface TrayState {
  /** Left edge of slot 0, fixed on frame 1. */
  readonly left: number;
  /** y of the first tray row, fixed on frame 1. */
  readonly top: number;
  /** Slots per row, fixed on frame 1. */
  readonly perRow: number;
  /** Slot list in fixed order; `null` is a slot freed by a node that connected. */
  readonly slots: readonly (string | null)[];
}

export interface LayoutState {
  readonly hub: string;
  /** Rows per lane, fixed on frame 1. */
  readonly K: number;
  readonly lo: number;
  readonly hi: number;
  /** Anchored slot of every node ever placed on the map. */
  readonly slots: ReadonlyMap<string, Slot>;
  /** Lanes reserved per column; never shrinks. */
  readonly lanes: ReadonlyMap<number, number>;
  readonly tray: TrayState;
}

/**
 * Every column at or beyond `fromColumn` (same side of the hub) moved by `dx`
 * because a column nearer the hub gained lanes.
 */
export interface ShiftEvent {
  fromColumn: number;
  dx: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TrayLayout {
  /** Tray node ids in slot order. */
  ids: string[];
  positions: ReadonlyMap<string, Point>;
  /** Number of nodes in the tray. */
  count: number;
  perRow: number;
  /** Rows up to the last occupied slot. */
  rows: number;
  /** Background band behind the tray (null when the tray is empty). */
  band: { x: number; y: number; width: number; height: number } | null;
}

export interface LayoutResult {
  state: LayoutState | null;
  /** Positions of nodes placed on the map (not the tray). */
  positions: ReadonlyMap<string, Point>;
  tray: TrayLayout;
  shifts: ShiftEvent[];
  /** Extent of every node centre and the tray band; null when nothing is shown. */
  bounds: Bounds | null;
}

/** Space above the first tray row for the band's label. */
const TRAY_BAND_HEAD = 44;

export function lanesK(n: number): number {
  return Math.max(K_MIN, Math.min(K_MAX, Math.ceil(Math.sqrt(n))));
}

interface Neighbour {
  n: string;
  calls: number;
  /** True when the edge goes from this node to `n`. */
  out: boolean;
}

interface Adjacency {
  adj: Map<string, Neighbour[]>;
  outE: Map<string, string[]>;
  inE: Map<string, string[]>;
}

function buildAdjacency(
  ids: ReadonlySet<string>,
  edges: readonly LayoutEdge[]
): Adjacency {
  // Merge parallel edges so the input order of edges never matters.
  const merged = new Map<string, LayoutEdge>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const calls = Number.isFinite(e.calls) ? Math.max(0, e.calls) : 0;
    const key = `${e.source}\u0000${e.target}`;
    const m = merged.get(key);
    if (m) m.calls += calls;
    else merged.set(key, { source: e.source, target: e.target, calls });
  }
  const adj = new Map<string, Neighbour[]>();
  const outE = new Map<string, string[]>();
  const inE = new Map<string, string[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const e of merged.values()) {
    push(adj, e.source, { n: e.target, calls: e.calls, out: true });
    push(adj, e.target, { n: e.source, calls: e.calls, out: false });
    push(outE, e.source, e.target);
    push(inE, e.target, e.source);
  }
  for (const list of adj.values()) {
    list.sort(
      (a, b) =>
        b.calls - a.calls ||
        (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) ||
        Number(b.out) - Number(a.out)
    );
  }
  return { adj, outE, inE };
}

function bfs(start: string, next: Map<string, string[]>): Map<string, number> {
  const d = new Map<string, number>([[start, 0]]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const u = q[i] as string;
    const du = d.get(u) as number;
    for (const v of next.get(u) ?? []) {
      if (!d.has(v)) {
        d.set(v, du + 1);
        q.push(v);
      }
    }
  }
  return d;
}

/** BFS from the hub over undirected adjacency, neighbours by calls desc. */
function bfsOrder(hub: string, adj: Map<string, Neighbour[]>): string[] {
  const order = [hub];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    for (const { n } of adj.get(order[i] as string) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        order.push(n);
      }
    }
  }
  return order;
}

/** x of lane 0 of every column, from the lane counts (mock-up `xOf`). */
function columnOrigins(
  lanes: ReadonlyMap<number, number>
): Map<number, number> {
  let minC = 0;
  let maxC = 0;
  for (const c of lanes.keys()) {
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }
  const lanesOf = (c: number) => lanes.get(c) ?? 0;
  const origin = new Map<number, number>([[0, 0]]);
  let right = (Math.max(1, lanesOf(0)) - 1) * LANE + LANE / 2;
  for (let k = 1; k <= maxC; k++) {
    const left = right + COL_GAP;
    origin.set(k, left + LANE / 2);
    right = left + lanesOf(k) * LANE;
  }
  let left = -LANE / 2;
  for (let k = -1; k >= minC; k--) {
    const r = left - COL_GAP;
    origin.set(k, r - LANE / 2);
    left = r - lanesOf(k) * LANE;
  }
  return origin;
}

function xOf(origins: Map<number, number>, c: number, l: number): number {
  const o = origins.get(c) ?? 0;
  return c < 0 ? o - l * LANE : o + l * LANE;
}

/** Left and right edge of all reserved lanes. */
function reservedExtent(
  lanes: ReadonlyMap<number, number>,
  origins: Map<number, number>
): { left: number; right: number } {
  let minC = 0;
  let maxC = 0;
  for (const c of lanes.keys()) {
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }
  const n = (c: number) => Math.max(1, lanes.get(c) ?? 1);
  const left =
    minC < 0 ? xOf(origins, minC, n(minC) - 1) - LANE / 2 : -LANE / 2;
  const right = xOf(origins, maxC, n(maxC) - 1) + LANE / 2;
  return { left, right };
}

const EMPTY_TRAY: TrayLayout = {
  ids: [],
  positions: new Map(),
  count: 0,
  perRow: TRAY_MIN_PER_ROW,
  rows: 0,
  band: null,
};

function emptyResult(state: LayoutState | null): LayoutResult {
  return {
    state,
    positions: new Map(),
    tray: EMPTY_TRAY,
    shifts: [],
    bounds: null,
  };
}

/**
 * One layout step. Call it with the previous result's `state` (or null) and
 * the current graph. Returns the new state, the positions of every node in
 * `graph` (map or tray), the block shifts since `prev`, and the bounds.
 */
export function updateLayout(
  prev: LayoutState | null,
  graph: LayoutGraph
): LayoutResult {
  // Unique nodes, first occurrence wins.
  const spans = new Map<string, number>();
  for (const n of graph.nodes) {
    if (!spans.has(n.id)) {
      spans.set(n.id, Number.isFinite(n.spans) ? n.spans : 0);
    }
  }
  const hub = prev?.hub ?? graph.hub;
  if (hub === null) return emptyResult(prev);
  if (!prev && !spans.has(hub)) return emptyResult(null);

  const ids = new Set(spans.keys());
  const { adj, outE, inE } = buildAdjacency(ids, graph.edges);
  const order = spans.has(hub) ? bfsOrder(hub, adj) : [];
  const down = bfs(hub, outE);
  const up = bfs(hub, inE);

  const K = prev?.K ?? lanesK(spans.size);
  const lo = prev?.lo ?? -Math.floor((K - 1) / 2);
  const hi = prev?.hi ?? lo + K - 1;

  // ---- columns (anchored for placed nodes) --------------------------------
  const prevSlots = prev?.slots ?? new Map<string, Slot>();
  const column = new Map<string, number>();
  for (const [id, s] of prevSlots) column.set(id, s.c);
  const fresh: string[] = [];
  const nearOf = new Map<string, string>();
  for (const id of order) {
    if (column.has(id)) continue;
    if (id === hub) {
      column.set(id, 0);
      fresh.push(id);
      continue;
    }
    const placed = (adj.get(id) ?? []).filter((p) => column.has(p.n));
    // BFS order guarantees at least one placed neighbour.
    const par = placed[0] as Neighbour;
    const parC = column.get(par.n) as number;
    const dn = down.get(id);
    const upd = up.get(id);
    const c =
      dn !== undefined
        ? dn
        : upd !== undefined
          ? -upd
          : par.out
            ? parC - 1
            : parC + 1;
    column.set(id, c);
    const near =
      placed.find((p) => Math.abs((column.get(p.n) as number) - c) === 1) ??
      par;
    nearOf.set(id, near.n);
    fresh.push(id);
  }

  // ---- lanes: Q19 reservation on frame 1, copy-on-write afterwards --------
  const lanes = new Map<number, number>(prev?.lanes ?? []);
  const trayCount1 = prev ? 0 : spans.size - order.length;
  if (!prev) {
    const perColumn = new Map<number, number>();
    for (const id of order) {
      const c = column.get(id) as number;
      perColumn.set(c, (perColumn.get(c) ?? 0) + 1);
    }
    const P = order.length;
    const total = P + trayCount1;
    for (const [c, placed] of perColumn) {
      // ceil((placed_c + tray × placed_c / P) / K), in exact integers.
      lanes.set(c, Math.max(1, Math.ceil((placed * total) / (P * K))));
    }
  }

  // ---- rows and lanes ------------------------------------------------------
  const slots = new Map<string, Slot>(prevSlots);
  const occ = new Map<string, Set<number>>();
  const occSet = (c: number, l: number) => {
    const key = `${c}:${l}`;
    let s = occ.get(key);
    if (!s) {
      s = new Set();
      occ.set(key, s);
    }
    return s;
  };
  for (const s of prevSlots.values()) occSet(s.c, s.l).add(s.r);

  for (const id of fresh) {
    const c = column.get(id) as number;
    if (id === hub) {
      if (!lanes.has(0)) lanes.set(0, 1);
      occSet(0, 0).add(0);
      slots.set(id, { c: 0, l: 0, r: 0 });
      continue;
    }
    if (!lanes.has(c)) lanes.set(c, 1);
    const L = lanes.get(c) as number;
    const nearSlot = slots.get(nearOf.get(id) as string) as Slot;
    const dRow = nearSlot.r;
    let best: Slot | null = null;
    let bestScore = Infinity;
    for (let l = 0; l < L; l++) {
      const taken = occSet(c, l);
      if (taken.size >= K) continue;
      for (let r = lo; r <= hi; r++) {
        if (taken.has(r)) continue;
        const score = Math.abs(r - dRow) + l * LANE_PENALTY;
        if (score < bestScore) {
          bestScore = score;
          best = { c, l, r };
        }
      }
    }
    if (!best) {
      lanes.set(c, L + 1);
      best = { c, l: L, r: Math.max(lo, Math.min(hi, dRow)) };
    }
    occSet(c, best.l).add(best.r);
    slots.set(id, best);
  }

  // ---- shifts: lanes gained since prev, for columns with placed nodes out --
  const shifts: ShiftEvent[] = [];
  if (prev) {
    const cols = [...lanes.keys()].sort((a, b) => a - b);
    for (const c of cols) {
      const before =
        c === 0
          ? Math.max(1, prev.lanes.get(0) ?? 1)
          : (prev.lanes.get(c) ?? 0);
      const after =
        c === 0 ? Math.max(1, lanes.get(0) ?? 1) : (lanes.get(c) ?? 0);
      const grown = after - before;
      if (grown <= 0) continue;
      const fromColumn = c >= 0 ? c + 1 : c - 1;
      const beyond = (k: number) =>
        fromColumn > 0 ? k >= fromColumn : k <= fromColumn;
      let anyOut = false;
      for (const s of prevSlots.values()) {
        if (beyond(s.c)) {
          anyOut = true;
          break;
        }
      }
      if (anyOut) {
        shifts.push({
          fromColumn,
          dx: (fromColumn > 0 ? 1 : -1) * grown * LANE,
        });
      }
    }
  }

  // ---- positions -----------------------------------------------------------
  const origins = columnOrigins(lanes);
  const positions = new Map<string, Point>();
  for (const [id, s] of slots) {
    if (!ids.has(id)) continue;
    positions.set(id, { x: xOf(origins, s.c, s.l), y: s.r * ROW });
  }

  // ---- tray ----------------------------------------------------------------
  let tray: TrayState;
  const byBusiest = (a: string, b: string) =>
    (spans.get(b) as number) - (spans.get(a) as number) ||
    (a < b ? -1 : a > b ? 1 : 0);
  if (!prev) {
    const ext = reservedExtent(lanes, origins);
    const perRow = Math.max(
      TRAY_MIN_PER_ROW,
      Math.floor((ext.right - ext.left) / TRAY_COL)
    );
    const unplaced = [...ids].filter((id) => !slots.has(id)).sort(byBusiest);
    tray = {
      left: ext.left,
      top: (hi + 1) * ROW + TRAY_GAP,
      perRow,
      slots: unplaced,
    };
  } else {
    const inSlots = new Set<string>();
    const next = prev.tray.slots.map((id) => {
      if (id === null) return null;
      inSlots.add(id);
      return slots.has(id) ? null : id;
    });
    const added = [...ids]
      .filter((id) => !slots.has(id) && !inSlots.has(id))
      .sort(byBusiest);
    const changed =
      added.length > 0 || next.some((id, i) => id !== prev.tray.slots[i]);
    tray = changed ? { ...prev.tray, slots: [...next, ...added] } : prev.tray;
  }

  const trayIds: string[] = [];
  const trayPositions = new Map<string, Point>();
  let lastUsed = -1;
  tray.slots.forEach((id, i) => {
    if (id === null || !ids.has(id)) return;
    trayIds.push(id);
    lastUsed = i;
    trayPositions.set(id, {
      x: tray.left + TRAY_COL * (i % tray.perRow) + TRAY_COL / 2,
      y: tray.top + Math.floor(i / tray.perRow) * TRAY_ROW,
    });
  });
  const rows = lastUsed < 0 ? 0 : Math.floor(lastUsed / tray.perRow) + 1;
  const band =
    trayIds.length > 0
      ? {
          x: tray.left,
          y: tray.top - TRAY_BAND_HEAD,
          width: tray.perRow * TRAY_COL,
          height: rows * TRAY_ROW + TRAY_BAND_HEAD - TRAY_ROW / 2 + 16,
        }
      : null;

  // ---- bounds --------------------------------------------------------------
  let bounds: Bounds | null = null;
  const grow = (x: number, y: number) => {
    if (!bounds) bounds = { minX: x, maxX: x, minY: y, maxY: y };
    else {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  };
  for (const p of positions.values()) grow(p.x, p.y);
  for (const p of trayPositions.values()) grow(p.x, p.y);
  if (band) {
    grow(band.x, band.y);
    grow(band.x + band.width, band.y + band.height);
  }

  const state: LayoutState = { hub, K, lo, hi, slots, lanes, tray };
  return {
    state,
    positions,
    tray: {
      ids: trayIds,
      positions: trayPositions,
      count: trayIds.length,
      perRow: tray.perRow,
      rows,
      band,
    },
    shifts,
    bounds,
  };
}

/** Runs `updateLayout` over a discovery sequence, one result per frame. */
export function layoutFrames(graphs: readonly LayoutGraph[]): LayoutResult[] {
  const out: LayoutResult[] = [];
  let state: LayoutState | null = null;
  for (const g of graphs) {
    const r = updateLayout(state, g);
    state = r.state;
    out.push(r);
  }
  return out;
}

/**
 * Node moves as the mock-up's `runChecks` counts them: for each pair of
 * consecutive frames, every node placed in both whose position changed by
 * more than 1 px. Leaving the tray for the map is a placement, not a move.
 */
export function countNodeMoves(
  frames: readonly ReadonlyMap<string, Point>[]
): number {
  let moves = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as ReadonlyMap<string, Point>;
    const b = frames[i] as ReadonlyMap<string, Point>;
    for (const [id, p] of a) {
      const q = b.get(id);
      if (q && Math.hypot(q.x - p.x, q.y - p.y) > 1) moves++;
    }
  }
  return moves;
}
