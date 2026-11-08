import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { layoutFrames, type LayoutResult, type Point } from "./layout-d.js";
import { discover, type Fixture, type FixtureFrame } from "./fixtures.js";
import { LANE, ROW, TRAY_COL, TRAY_ROW } from "./constants.js";
import type { NodeKind } from "../engine/types.js";

/** Fixed seed so CI runs are reproducible; bounded runs keep CI inside its timeouts. */
const SEED = 20261107;
const KINDS: NodeKind[] = [
  "service",
  "service",
  "service",
  "database",
  "messaging",
  "external",
];

/**
 * A random fixture: `n` nodes (mostly services) discovered over `frames`
 * frames, ≤ 2.5 edges per node (plus at most one per burst node) with random
 * weights and stages, self-calls and parallel edges included. Some nodes
 * appear only on later frames.
 */
interface EdgeRec {
  s: number;
  t: number;
  calls: number;
  stage: number;
}

function fixtureArb(minN: number, maxN: number, frames?: number) {
  return fc
    .record({
      n: fc.integer({ min: minN, max: maxN }),
      frames:
        frames === undefined
          ? fc.integer({ min: 1, max: 5 })
          : fc.constant(frames),
    })
    .chain(({ n, frames: f }) =>
      fc.record({
        frames: fc.constant(f),
        // late burst: the last `burst` nodes are discovered after frame 1 as
        // callees of the hub, so column +1 can outgrow its frame-1 reservation
        burst:
          f < 2
            ? fc.constant(0)
            : fc.integer({ min: 0, max: Math.floor(n / 2) }),
        nodes: fc.array(
          fc.record({
            kind: fc.constantFrom(...KINDS),
            spans: fc.integer({ min: 0, max: 100_000 }),
            stage: fc.oneof(
              { weight: 2, arbitrary: fc.constant(1) },
              { weight: 1, arbitrary: fc.integer({ min: 1, max: f }) }
            ),
          }),
          { minLength: n, maxLength: n }
        ),
        edges:
          n === 0
            ? fc.constant<EdgeRec[]>([])
            : fc.array(
                fc.record({
                  s: fc.integer({ min: 0, max: n - 1 }),
                  t: fc.integer({ min: 0, max: n - 1 }),
                  calls: fc.integer({ min: 1, max: 50_000 }),
                  stage: fc.integer({ min: 1, max: f }),
                }),
                { maxLength: Math.floor(2.5 * n) }
              ),
      })
    )
    .map(({ frames, burst, nodes, edges }) => {
      const id = (i: number) => `n${String(i).padStart(3, "0")}`;
      const n = nodes.length;
      const fixture: Fixture = {
        nodes: nodes.map((x, i) => {
          if (burst > 0 && i === 0) {
            // the busiest service with a connection, so it becomes the hub
            return { id: id(i), kind: "service", spans: 1_000_000, stage: 1 };
          }
          if (i >= n - burst) {
            return {
              id: id(i),
              kind: "service",
              spans: x.spans,
              stage: 2 + (i % (frames - 1)),
            };
          }
          return { id: id(i), ...x };
        }),
        edges: edges.map((e) => ({
          source: id(e.s),
          target: id(e.t),
          calls: e.calls,
          stage: e.stage,
        })),
      };
      for (let i = Math.max(1, n - burst); i < n; i++) {
        const stage = 2 + (i % (frames - 1));
        fixture.edges.push({ source: id(0), target: id(i), calls: 1, stage });
      }
      return discover(fixture, frames);
    });
}

function finite(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Grid spacing check: distinct x at least `dx` apart, y in one x at least `dy` apart. */
function overlaps(pts: Iterable<Point>, dx: number, dy: number): string | null {
  const byX = new Map<number, number[]>();
  for (const p of pts) {
    const ys = byX.get(p.x);
    if (ys) ys.push(p.y);
    else byX.set(p.x, [p.y]);
  }
  const xs = [...byX.keys()].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] as number) - (xs[i - 1] as number);
    if (d < dx) return `x ${xs[i - 1]} and ${xs[i]} only ${d} apart`;
  }
  for (const [x, ys] of byX) {
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const d = (ys[i] as number) - (ys[i - 1] as number);
      if (d < dy) return `x=${x}: y ${ys[i - 1]} and ${ys[i]} only ${d} apart`;
    }
  }
  return null;
}

/** Totals over a whole property run, to prove the run exercised shifts and the tray. */
const seen = { shifts: 0, trayFrames: 0, placedMoves: 0 };

function checkSequence(frames: FixtureFrame[]): void {
  const input = structuredClone(frames);
  const rs = layoutFrames(frames);
  // the same input gives deep-equal output, and the input is untouched
  expect(layoutFrames(input)).toEqual(rs);
  expect(frames).toEqual(input);

  let hub: string | null = null;
  rs.forEach((r, i) => {
    const frame = frames[i] as FixtureFrame;
    const ids = frame.nodes.map((n) => n.id);

    if (r.state === null) {
      // no hub yet (no service): nothing is laid out
      expect(frame.hub).toBeNull();
      expect(r.positions.size + r.tray.count).toBe(0);
      return;
    }

    // every node reachable: exactly once, on the map or in the tray
    const shown = [...r.positions.keys(), ...r.tray.ids];
    expect(shown.length).toBe(ids.length);
    expect(new Set(shown)).toEqual(new Set(ids));

    // no NaN or infinite positions
    for (const p of r.positions.values()) expect(finite(p)).toBe(true);
    for (const p of r.tray.positions.values()) expect(finite(p)).toBe(true);
    if (r.bounds) {
      expect(Object.values(r.bounds).every(Number.isFinite)).toBe(true);
    }

    // no overlaps on the map, in the tray, or between them
    expect(overlaps(r.positions.values(), LANE, ROW)).toBeNull();
    expect(overlaps(r.tray.positions.values(), TRAY_COL, TRAY_ROW)).toBeNull();
    let maxPlacedY = -Infinity;
    for (const p of r.positions.values())
      maxPlacedY = Math.max(maxPlacedY, p.y);
    for (const p of r.tray.positions.values()) {
      expect(p.y - maxPlacedY).toBeGreaterThanOrEqual(ROW);
    }

    // the hub is at (0,0) on every frame and never changes
    hub ??= r.state.hub;
    expect(r.state.hub).toBe(hub);
    expect(r.positions.get(hub)).toEqual({ x: 0, y: 0 });

    if (r.tray.count > 0) seen.trayFrames++;
    if (i === 0) return;
    seen.shifts += r.shifts.length;
    const prev = rs[i - 1] as LayoutResult;
    // a placed node moves only by whole-column ShiftEvent dx (and stays placed)
    for (const [id, p] of prev.positions) {
      const q = r.positions.get(id);
      expect(q).toBeDefined();
      const c = r.state.slots.get(id)?.c as number;
      const dx = r.shifts
        .filter((s) =>
          s.fromColumn > 0 ? c >= s.fromColumn : c <= s.fromColumn
        )
        .reduce((sum, s) => sum + s.dx, 0);
      expect(q).toEqual({ x: p.x + dx, y: p.y });
      if (dx !== 0) seen.placedMoves++;
    }
    for (const s of r.shifts) {
      expect(Math.abs(s.dx) % LANE).toBe(0);
      expect(Math.sign(s.dx)).toBe(Math.sign(s.fromColumn));
    }
    // a tray node never moves while it stays in the tray
    for (const [id, p] of prev.tray.positions) {
      const q = r.tray.positions.get(id);
      if (q) expect(q).toEqual(p);
    }
    // reservations never shrink
    for (const [c, n] of prev.state?.lanes ?? []) {
      expect(r.state.lanes.get(c) ?? 0).toBeGreaterThanOrEqual(n);
    }
  });
}

describe("updateLayout properties", { timeout: 60_000 }, () => {
  it("holds for random graphs of 0–150 nodes over 1–5 frames", () => {
    Object.assign(seen, { shifts: 0, trayFrames: 0, placedMoves: 0 });
    fc.assert(
      fc.property(fixtureArb(0, 150), (frames) => {
        checkSequence(frames);
      }),
      { numRuns: 60, seed: SEED, endOnFailure: true }
    );
    // the generator must reach the interesting cases, not just pass vacuously
    expect(seen.shifts).toBeGreaterThan(0);
    expect(seen.placedMoves).toBeGreaterThan(0);
    expect(seen.trayFrames).toBeGreaterThan(0);
  });

  it("holds for graphs of exactly 600 nodes over 5 frames", () => {
    fc.assert(
      fc.property(fixtureArb(600, 600, 5), (frames) => {
        expect(frames[4]?.nodes.length).toBeLessThanOrEqual(600);
        checkSequence(frames);
      }),
      { numRuns: 3, seed: SEED, endOnFailure: true }
    );
  });
});
