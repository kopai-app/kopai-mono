import { describe, it, expect } from "vitest";
import {
  countNodeMoves,
  lanesK,
  layoutFrames,
  updateLayout,
  type LayoutResult,
  type Point,
} from "./layout-d.js";
import {
  fixtureFrames,
  genSystem,
  discover,
  trayOrderFrames,
  type FixtureFrame,
  type FixtureName,
} from "./fixtures.js";
import { LANE, ROW, TRAY_COL, TRAY_ROW } from "./constants.js";
import { truncateName } from "./viewport.js";

/**
 * Node moves recorded from this implementation (Q19 reservation). The test
 * fails if a count goes up; lower it here when the layout improves.
 */
const MOVES_STAR150 = 0;
const MOVES_GEN120 = 26;
const MOVES_GEN400 = 133;
/** Ceilings measured on the mock-up without reservation (PR §5.5 table). */
const MOCKUP_CEILING = { star150: 16, gen120: 37, gen400: 188 } as const;

function run(name: FixtureName): {
  frames: FixtureFrame[];
  rs: LayoutResult[];
} {
  const frames = fixtureFrames(name);
  return { frames, rs: layoutFrames(frames) };
}

const colOf = (r: LayoutResult, id: string) => r.state?.slots.get(id)?.c;

/** Every node of the frame is shown exactly once: on the map or in the tray. */
function expectComplete(frame: FixtureFrame, r: LayoutResult) {
  const shown = [...r.positions.keys(), ...r.tray.ids];
  expect(new Set(shown).size).toBe(shown.length);
  expect(new Set(shown)).toEqual(new Set(frame.nodes.map((n) => n.id)));
}

/** Placed nodes sit on a grid: distinct x at least one lane apart, rows at least ROW apart. */
function expectNoOverlap(r: LayoutResult) {
  const check = (pts: Iterable<Point>, dx: number, dy: number) => {
    const byX = new Map<number, number[]>();
    for (const p of pts) {
      const ys = byX.get(p.x);
      if (ys) ys.push(p.y);
      else byX.set(p.x, [p.y]);
    }
    const xs = [...byX.keys()].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect((xs[i] as number) - (xs[i - 1] as number)).toBeGreaterThanOrEqual(
        dx
      );
    }
    for (const ys of byX.values()) {
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        expect(
          (ys[i] as number) - (ys[i - 1] as number)
        ).toBeGreaterThanOrEqual(dy);
      }
    }
  };
  check(r.positions.values(), LANE, ROW);
  check(r.tray.positions.values(), TRAY_COL, TRAY_ROW);
}

describe("updateLayout: fixtures", () => {
  it("empty: no positions, no tray, no bounds on every frame", () => {
    const { rs } = run("empty");
    expect(rs).toHaveLength(5);
    for (const r of rs) {
      expect(r.positions.size).toBe(0);
      expect(r.tray.count).toBe(0);
      expect(r.tray.band).toBeNull();
      expect(r.bounds).toBeNull();
      expect(r.state).toBeNull();
      expect(r.shifts).toEqual([]);
    }
  });

  it("a null hub gives empty output and keeps no state", () => {
    const r = updateLayout(null, {
      nodes: [{ id: "db:pg", spans: 0 }],
      edges: [],
      hub: null,
    });
    expect(r.positions.size).toBe(0);
    expect(r.state).toBeNull();
  });

  it("one: the hub sits at (0,0) and the tray is empty", () => {
    const { rs } = run("one");
    for (const r of rs) {
      expect(r.state?.hub).toBe("my-app");
      expect(r.positions.get("my-app")).toEqual({ x: 0, y: 0 });
      expect(r.tray.count).toBe(0);
      expect(r.tray.band).toBeNull();
      expect(r.bounds).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
    }
  });

  it("oneWithDbs: the databases and the external API go to column +1", () => {
    const { frames, rs } = run("oneWithDbs");
    const r = rs[0] as LayoutResult;
    expectComplete(frames[0] as FixtureFrame, r);
    for (const id of ["pg", "rd", "oa"]) expect(colOf(r, id)).toBe(1);
    // nearest free rows around the hub's row 0, strongest call first
    expect(r.state?.slots.get("pg")?.r).toBe(0);
    expect(countNodeMoves(rs.map((x) => x.positions))).toBe(0);
  });

  it("twoUnconnected: the busier service is the hub, the other waits in the tray", () => {
    const { frames, rs } = run("twoUnconnected");
    rs.forEach((r, i) => {
      expect(r.state?.hub).toBe("api");
      expect(r.positions.get("api")).toEqual({ x: 0, y: 0 });
      expect(r.tray.count).toBe(1);
      expect(r.tray.ids).toEqual(["nightly-export"]);
      expect(r.tray.band).not.toBeNull();
      expectComplete(frames[i] as FixtureFrame, r);
    });
    // tray sits below every reserved row
    const t = rs[0]?.tray.positions.get("nightly-export") as Point;
    expect(t.y).toBeGreaterThan(((rs[0]?.state?.hi ?? 0) + 1) * ROW);
  });

  it("chain15: mid-chain hub, callers at negative columns, callees at positive", () => {
    const { frames, rs } = run("chain15");
    const last = rs[4] as LayoutResult;
    expect(last.state?.hub).toBe("step-08");
    expect(last.tray.count).toBe(0);
    expectComplete(frames[4] as FixtureFrame, last);
    for (let i = 1; i <= 15; i++) {
      const id = "step-" + String(i).padStart(2, "0");
      expect(colOf(last, id)).toBe(i - 8);
      expect(last.positions.get(id)?.y).toBe(0);
    }
    expect(countNodeMoves(rs.map((x) => x.positions))).toBe(0);
  });

  it("shop20: api-gateway is the hub, 7 nodes wait on frame 1, the tray empties", () => {
    const { frames, rs } = run("shop20");
    expect(rs[0]?.state?.hub).toBe("api-gateway");
    expect(rs[0]?.tray.count).toBe(7);
    expect(rs[4]?.tray.count).toBe(0);
    expect(colOf(rs[4] as LayoutResult, "web-frontend")).toBe(-1);
    expect(colOf(rs[4] as LayoutResult, "catalog")).toBe(1);
    rs.forEach((r, i) => {
      expectComplete(frames[i] as FixtureFrame, r);
      expectNoOverlap(r);
    });
  });

  it("star150: column +1 reserves ceil(150/K) lanes on frame 1 and nothing moves", () => {
    const { frames, rs } = run("star150");
    const K = lanesK(156);
    expect(K).toBe(13);
    const expected = Math.ceil(150 / K);
    for (const r of rs) {
      expect(r.state?.K).toBe(K);
      expect(r.state?.lanes.get(1)).toBe(expected);
      expect(r.shifts).toEqual([]);
      expectNoOverlap(r);
    }
    const last = rs[4] as LayoutResult;
    expectComplete(frames[4] as FixtureFrame, last);
    const lanesUsed = new Set(
      [...(last.state?.slots.values() ?? [])]
        .filter((s) => s.c === 1)
        .map((s) => s.l)
    );
    expect(lanesUsed.size).toBe(expected);
    expect(countNodeMoves(rs.map((x) => x.positions))).toBe(MOVES_STAR150);
  });

  it("hubOnlyIncoming: every other node sits at a negative column", () => {
    const { frames, rs } = run("hubOnlyIncoming");
    const last = rs[4] as LayoutResult;
    expect(last.state?.hub).toBe("ledger");
    expect(last.tray.count).toBe(0);
    expectComplete(frames[4] as FixtureFrame, last);
    for (const [id, s] of last.state?.slots ?? []) {
      if (id === "ledger") expect(s).toEqual({ c: 0, l: 0, r: 0 });
      else expect(s.c).toBeLessThan(0);
    }
  });

  it("cycles: terminates, places each node once, columns follow shortest distance", () => {
    const { frames, rs } = run("cycles");
    rs.forEach((r, i) => {
      expectComplete(frames[i] as FixtureFrame, r);
      expectNoOverlap(r);
    });
    const last = rs[4] as LayoutResult;
    expect(last.tray.count).toBe(0);
    expect(colOf(last, "a")).toBe(1);
    // b → hub arrives on frame 2, but b was placed on frame 1 as a callee of a
    expect(colOf(last, "b")).toBe(2);
    expect(colOf(last, "c")).toBe(2);
  });

  it("selfCalls: self-calls never connect a node", () => {
    const { frames, rs } = run("selfCalls");
    expect(rs[0]?.tray.ids).toEqual(["worker", "cron"]);
    expect(colOf(rs[1] as LayoutResult, "worker")).toBe(1);
    expect(rs[4]?.tray.ids).toEqual(["cron"]);
    rs.forEach((r, i) => expectComplete(frames[i] as FixtureFrame, r));
  });

  it("columnExactlyK: K callees fill exactly one lane, no shift", () => {
    const { frames, rs } = run("columnExactlyK");
    for (const r of rs) {
      expect(r.state?.K).toBe(6);
      expect(r.state?.lanes.get(1)).toBe(1);
      expect(r.shifts).toEqual([]);
    }
    const last = rs[4] as LayoutResult;
    expectComplete(frames[4] as FixtureFrame, last);
    const col1 = [...(last.state?.slots.values() ?? [])].filter(
      (s) => s.c === 1
    );
    expect(col1).toHaveLength(6);
    expect(new Set(col1.map((s) => s.r)).size).toBe(6);
    expect(col1.every((s) => s.l === 0)).toBe(true);
    expect(countNodeMoves(rs.map((x) => x.positions))).toBe(0);
  });

  it("longNames: names over 60 chars lay out and truncate to ≤ 21 chars with …", () => {
    const { frames, rs } = run("longNames");
    rs.forEach((r, i) => expectComplete(frames[i] as FixtureFrame, r));
    for (const n of frames[0]?.nodes ?? []) {
      const name = n.label ?? n.id;
      expect(name.length).toBeGreaterThan(60);
      const t = truncateName(name);
      expect(t.length).toBeLessThanOrEqual(21);
      expect(t.endsWith("…")).toBe(true);
      expect(name.startsWith(t.slice(0, -1))).toBe(true);
    }
  });
});

describe("updateLayout: tray order", () => {
  const frames = trayOrderFrames();
  const rs = layoutFrames(frames);
  const pos = (i: number, id: string) => rs[i]?.tray.positions.get(id);

  it("orders the tray on frame 1 by spans desc", () => {
    expect(rs[0]?.tray.ids).toEqual(["tray-a", "tray-b", "tray-c", "tray-d"]);
  });

  it("a seed refresh that reverses the spans order moves no tray node", () => {
    expect(rs[1]?.tray.ids).toEqual(["tray-a", "tray-b", "tray-c", "tray-d"]);
    for (const id of ["tray-a", "tray-b", "tray-c", "tray-d"]) {
      expect(pos(1, id)).toEqual(pos(0, id));
    }
  });

  it("a tray node that connects leaves its slot empty; the others stay", () => {
    expect(rs[2]?.positions.has("tray-b")).toBe(true);
    expect(rs[2]?.tray.ids).toEqual(["tray-a", "tray-c", "tray-d"]);
    expect(rs[2]?.state?.tray.slots).toEqual([
      "tray-a",
      null,
      "tray-c",
      "tray-d",
    ]);
    for (const id of ["tray-a", "tray-c", "tray-d"]) {
      expect(pos(2, id)).toEqual(pos(0, id));
    }
  });

  it("a newly discovered unconnected node is appended after the last slot", () => {
    const slots = rs[3]?.state?.tray.slots;
    expect(slots).toEqual(["tray-a", null, "tray-c", "tray-d", "tray-new"]);
    const perRow = rs[3]?.tray.perRow as number;
    const p0 = pos(0, "tray-a") as Point;
    expect(pos(3, "tray-new")).toEqual({
      x: p0.x + TRAY_COL * (4 % perRow),
      y: p0.y + Math.floor(4 / perRow) * TRAY_ROW,
    });
    for (const id of ["tray-a", "tray-c", "tray-d"]) {
      expect(pos(3, id)).toEqual(pos(0, id));
    }
    expect(rs[3]?.tray.count).toBe(4);
  });

  it("perRow is fixed on frame 1 and never below 4", () => {
    expect(rs[0]?.tray.perRow).toBeGreaterThanOrEqual(4);
    for (const r of rs) expect(r.tray.perRow).toBe(rs[0]?.tray.perRow);
  });
});

describe("updateLayout: purity and lane growth", () => {
  it("does not mutate its inputs", () => {
    const frames = fixtureFrames("gen120");
    const copy = structuredClone(frames);
    const first = updateLayout(null, frames[0] as FixtureFrame);
    const stateCopy = structuredClone(first.state);
    updateLayout(first.state, frames[4] as FixtureFrame);
    expect(frames).toEqual(copy);
    expect(first.state).toEqual(stateCopy);
  });

  it("an under-predicted column gains a lane and shifts the columns beyond as one block", () => {
    // frame 1: hub → a (column 1), a → b (column 2). Frame 2: 7 more callees
    // in column 1 overflow K = 6 rows.
    const nodes = [
      { id: "hub", spans: 100 },
      { id: "a", spans: 50 },
      { id: "b", spans: 10 },
    ];
    const r1 = updateLayout(null, {
      nodes,
      edges: [
        { source: "hub", target: "a", calls: 10 },
        { source: "a", target: "b", calls: 5 },
      ],
      hub: "hub",
    });
    expect(r1.state?.lanes.get(1)).toBe(1);
    const more = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`,
      spans: 1,
    }));
    const r2 = updateLayout(r1.state, {
      nodes: [...nodes, ...more],
      edges: [
        { source: "hub", target: "a", calls: 10 },
        { source: "a", target: "b", calls: 5 },
        ...more.map((n) => ({ source: "hub", target: n.id, calls: 1 })),
      ],
      hub: "hub",
    });
    expect(r2.state?.lanes.get(1)).toBe(2);
    expect(r2.shifts).toEqual([{ fromColumn: 2, dx: LANE }]);
    expect(r2.positions.get("b")).toEqual({
      x: (r1.positions.get("b") as Point).x + LANE,
      y: (r1.positions.get("b") as Point).y,
    });
    expect(r2.positions.get("a")).toEqual(r1.positions.get("a"));
    expect(countNodeMoves([r1.positions, r2.positions])).toBe(1);
  });

  it("reservations never shrink across frames", () => {
    const rs = layoutFrames(fixtureFrames("gen400"));
    for (let i = 1; i < rs.length; i++) {
      for (const [c, n] of rs[i - 1]?.state?.lanes ?? []) {
        expect(rs[i]?.state?.lanes.get(c)).toBeGreaterThanOrEqual(n);
      }
    }
  });

  it("ignores edges to unknown nodes and merges parallel edges", () => {
    const r = updateLayout(null, {
      nodes: [
        { id: "hub", spans: 9 },
        { id: "x", spans: 1 },
      ],
      edges: [
        { source: "hub", target: "x", calls: 1 },
        { source: "hub", target: "x", calls: 2 },
        { source: "hub", target: "ghost", calls: 99 },
      ],
      hub: "hub",
    });
    expect([...r.positions.keys()].sort()).toEqual(["hub", "x"]);
  });
});

describe("node-move baseline (mock-up runChecks)", () => {
  const moves = (frames: FixtureFrame[]) =>
    countNodeMoves(layoutFrames(frames).map((r) => r.positions));

  it("gen120 stays at or below the recorded count and the mock-up ceiling", () => {
    const m = moves(discover(genSystem(120, 42)));
    expect(MOVES_GEN120).toBeLessThanOrEqual(MOCKUP_CEILING.gen120);
    expect(m).toBeLessThanOrEqual(MOVES_GEN120);
  });

  it("gen400 stays at or below the recorded count and the mock-up ceiling", () => {
    const m = moves(discover(genSystem(400, 7)));
    expect(MOVES_GEN400).toBeLessThanOrEqual(MOCKUP_CEILING.gen400);
    expect(m).toBeLessThanOrEqual(MOVES_GEN400);
  });

  it("star150 stays at or below the recorded count and the mock-up ceiling", () => {
    const m = moves(fixtureFrames("star150"));
    expect(MOVES_STAR150).toBeLessThanOrEqual(MOCKUP_CEILING.star150);
    expect(m).toBeLessThanOrEqual(MOVES_STAR150);
  });

  it("generated fixtures have the mock-up's node counts", () => {
    expect(genSystem(120, 42).nodes).toHaveLength(143);
    expect(genSystem(400, 7).nodes).toHaveLength(473);
    expect(fixtureFrames("star150")[0]?.nodes).toHaveLength(156);
  });

  it("countNodeMoves ignores nodes that leave the tray and moves ≤ 1 px", () => {
    const a = new Map([["x", { x: 0, y: 0 }]]);
    const b = new Map([
      ["x", { x: 0.5, y: 0.5 }],
      ["y", { x: 900, y: 0 }],
    ]);
    const c = new Map([
      ["x", { x: 220, y: 0.5 }],
      ["y", { x: 900, y: 64 }],
    ]);
    expect(countNodeMoves([a, b])).toBe(0);
    expect(countNodeMoves([a, b, c])).toBe(2);
  });
});
