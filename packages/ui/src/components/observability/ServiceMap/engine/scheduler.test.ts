import { describe, it, expect } from "vitest";
import type { OtelTracesRow } from "@kopai/sdk";
import {
  DEFAULT_CONFIG,
  DELAY_MS,
  M_MS,
  PROBE_RESERVE,
  SCAN_MAX_REQUESTS,
  type EngineConfig,
} from "./config.js";
import { createServiceMapEngine, formatCoverage } from "./engine.js";
import { edgeId } from "./graph-state.js";
import { ScanRun } from "./scheduler.js";
import { msToNs, nsMinusOne } from "./time.js";
import {
  backwardSource,
  createFakeClock,
  createMockClient,
  filterOf,
  isBackward,
  isForward,
  isProbePage,
  pairRows,
  row,
  seedNodeRows,
  seedPeerRow,
  serialGaps,
  type MockHandlers,
} from "./test-utils.js";
import type { ServiceMapSnapshot } from "./types.js";

const START = Date.UTC(2026, 10, 6, 12, 0, 0);
const T0 = START - DELAY_MS;
const LO = START - M_MS;

function setup(h: MockHandlers, config?: Partial<EngineConfig>) {
  const clock = createFakeClock(START);
  const mock = createMockClient(clock, h);
  const snaps: ServiceMapSnapshot[] = [];
  const engine = createServiceMapEngine({
    client: mock.client,
    clock,
    config,
    onSnapshot: (s) => snaps.push(s),
  });
  const untilPhase = (phase: string, limitMs = 3 * M_MS) =>
    clock.runUntil(() => engine.stats().phase === phase, limitMs);
  return { clock, mock, engine, snaps, untilPhase };
}

/** Backward pages that each hold one a → b call in their time slice. */
function abPages(pages: number) {
  return backwardSource({
    pages,
    loMs: LO,
    hiMs: T0,
    rowsFor: (i, _hi, lo) => pairRows(`ab${i}`, "a", "b", Math.floor(lo) + 10),
  });
}

function edgeCalls(s: ServiceMapSnapshot | null, from: string, to: string) {
  return s?.edges.find((e) => e.id === edgeId(from, to))?.calls ?? 0;
}

describe("scan order and request queue", () => {
  it("starts with getServices and 2 aggregates, then a DESC page over [now − 60 min, now − 30 s − 1]", async () => {
    const { clock, mock, engine } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(5),
    });
    engine.start();
    await clock.runUntil(() => mock.calls.length >= 5);
    const [cs, c0, c1, c2, c3] = mock.calls;
    expect(cs?.method).toBe("getServices");
    expect(c0?.method).toBe("queryTracesAggregate");
    expect(c1?.method).toBe("queryTracesAggregate");
    expect(c2?.method).toBe("searchTracesPage");
    expect(filterOf(c2!)).toEqual({
      timestampMin: msToNs(START - 60 * 60_000),
      timestampMax: nsMinusOne(msToNs(START - 30_000)),
      sortOrder: "DESC",
      limit: 1000,
    });
    // The next page follows the cursor with the same fixed window.
    expect(filterOf(c3!)).toMatchObject({
      cursor: "1",
      timestampMin: msToNs(LO),
      timestampMax: nsMinusOne(msToNs(T0)),
    });
    engine.stop();
  });

  it("never overlaps requests and keeps ≥ 100 ms between them", async () => {
    const { mock, engine, untilPhase, clock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(60),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(60_000); // a few live forward ticks too
    expect(mock.calls.length).toBeGreaterThan(35);
    expect(mock.maxInFlight()).toBe(1);
    const gaps = serialGaps(mock.calls);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
    engine.stop();
  });
});

describe("shared budget and stop rule (Q11, A6, PD-8)", () => {
  const unconnected = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [
      `s${String(i).padStart(2, "0")}`,
      1000 - i,
    ])
  );

  /** A probe page of service X with 2 traces, and the traces themselves. */
  const probeHandlers: Pick<MockHandlers, "probe" | "trace"> = {
    probe: (f) => {
      const x = f.serviceName ?? "";
      const ts = Number(BigInt(f.timestampMax ?? "0") / 1_000_000n) - 60_000;
      return {
        data: [1, 2].map((k) =>
          row({
            traceId: `${x}-t${k}`,
            spanId: `${x}-c${k}`,
            parentId: `${x}-p${k}`,
            svc: x,
            tsMs: ts - k,
          })
        ),
        nextCursor: null,
      };
    },
    trace: (traceId) => {
      const [x, t] = traceId.split("-");
      const ts = START - 50 * 60_000;
      return [
        row({ traceId, spanId: `${x}-p${t?.slice(1)}`, svc: "gw", tsMs: ts }),
        row({
          traceId,
          spanId: `${x}-c${t?.slice(1)}`,
          parentId: `${x}-p${t?.slice(1)}`,
          svc: x ?? "",
          tsMs: ts + 1,
        }),
      ];
    },
  };

  it("500 pages + 60 unconnected services: ≤ budget calls before live, stop on budget, reserve left for probes", async () => {
    const { mock, engine, untilPhase, clock } = setup(
      {
        seed: (w) =>
          w === "nodes" ? seedNodeRows({ a: 5000, b: 10, ...unconnected }) : [],
        backward: abPages(500),
        ...probeHandlers,
      },
      // A 50-request scan ends before a 10 s poll is due; poll faster so
      // forward ticks run during the scan and are counted too.
      { pollMs: 1000 }
    );
    engine.start();
    expect(await untilPhase("live")).toBe(true);
    const callsBeforeLive = mock.calls.length;
    expect(callsBeforeLive).toBeLessThanOrEqual(SCAN_MAX_REQUESTS);
    // Every request before live was counted against the one budget.
    expect(engine.stats().scanRequests).toBe(callsBeforeLive);
    expect(callsBeforeLive).toBe(SCAN_MAX_REQUESTS); // probes used the reserve up to 0

    const firstProbe = mock.calls.findIndex(isProbePage);
    expect(firstProbe).toBeGreaterThan(0);
    // The backward phase stopped with exactly PROBE_RESERVE requests left.
    expect(SCAN_MAX_REQUESTS - firstProbe).toBe(PROBE_RESERVE);
    // Forward ticks ran during the scan and were counted.
    const fwdDuringScan = mock.calls.slice(0, firstProbe).filter(isForward);
    expect(fwdDuringScan.length).toBeGreaterThan(0);
    const backward = mock.calls.filter(isBackward).length;
    // getServices + 2 aggregates + pages.
    expect(3 + backward + fwdDuringScan.length).toBe(firstProbe);

    // PROBE_RESERVE requests = services × (1 page + 2 traces), busiest first.
    const probed = mock.calls
      .filter(isProbePage)
      .map((c) => filterOf(c).serviceName);
    expect(probed).toEqual(Object.keys(unconnected).slice(0, probed.length));
    expect(probed.length).toBeGreaterThanOrEqual(
      Math.floor(PROBE_RESERVE / 3) - 1
    );
    expect(
      mock.calls.filter((c) => c.method === "getTrace").length
    ).toBeLessThanOrEqual(2 * probed.length);

    const before = mock.calls.length;
    await clock.advance(6 * 60_000); // 6 min of live
    const snap = engine.getSnapshot();
    expect(snap?.scan.stopReason).toBe("budget");
    expect(snap?.scan.requests).toBe(SCAN_MAX_REQUESTS);
    expect(snap?.scan.state).toBe("live");
    // Live ticks and the 5-min seed refresh keep running, uncounted.
    const live = mock.calls.slice(before);
    expect(live.filter(isForward).length).toBeGreaterThanOrEqual(30);
    expect(live.filter((c) => c.method === "queryTracesAggregate").length).toBe(
      2
    );
    engine.stop();
  });

  it("interleaved forward paging also stops when the budget hits 0", async () => {
    const { mock, engine, untilPhase, clock } = setup(
      {
        seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
        backward: abPages(500),
        // An endless forward stream: every page has a next cursor.
        forward: (f) => ({
          data: [row({ spanId: `f${f.cursor ?? 0}`, svc: "a", tsMs: T0 + 1 })],
          nextCursor: String(Number(f.cursor ?? 0) + 1),
        }),
      },
      { scanMaxRequests: 120, probeReserve: 0, fwdMaxPages: 1000 }
    );
    engine.start();
    expect(await untilPhase("live")).toBe(true);
    expect(engine.stats().scanRequests).toBe(120);
    expect(mock.calls.length).toBe(120);
    // Some of the budget went to forward pages interleaved with the scan.
    expect(mock.calls.filter(isForward).length).toBeGreaterThan(0);
    await clock.advance(800);
    expect(engine.getSnapshot()?.scan.stopReason).toBe("budget");
    engine.stop();
  });

  it("stops with coverage when the scan reaches now − M", async () => {
    const { engine, untilPhase, clock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(10),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(1000);
    const s = engine.getSnapshot();
    expect(s?.scan.stopReason).toBe("coverage");
    expect(s?.coverage.fromMs).toBeLessThan(clock.now() - M_MS + 60_000);
    engine.stop();
  });

  it("stops with no-more-data on a null cursor; the window counts as covered", async () => {
    const { engine, untilPhase, clock, mock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5, x: 3 }) : []),
      backward: backwardSource({
        pages: 3,
        loMs: T0 - 10 * 60_000,
        hiMs: T0,
        rowsFor: (i, _hi, lo) => pairRows(`p${i}`, "a", "b", Math.floor(lo)),
      }),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(1000);
    const s = engine.getSnapshot();
    expect(s?.scan.stopReason).toBe("no-more-data");
    expect(s?.coverage.fromMs).toBeGreaterThanOrEqual(LO);
    expect(s?.coverage.fromMs).toBeLessThanOrEqual(clock.now() - M_MS);
    expect(formatCoverage(s!)).toBe("covers 60 of 60 min");
    // Nothing older exists, so no probe for the unconnected `x`.
    expect(mock.calls.some(isProbePage)).toBe(false);
    engine.stop();
  });
});

describe("forward poll (R2-4, PD-3)", () => {
  it("ticks every 10 s with ASC and timestampMax = ns(now − 30 s) − 1; never reads the last 30 s", async () => {
    const { mock, engine, untilPhase, clock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(2),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(5 * 60_000);
    const fwd = mock.calls.filter(isForward);
    expect(fwd.length).toBeGreaterThanOrEqual(29);
    const first = fwd[0]!;
    expect(first.startMs).toBeGreaterThanOrEqual(START + 10_000);
    expect(filterOf(first).timestampMin).toBe(msToNs(T0));
    // Ticks are 10 s apart; each window starts where the last one ended.
    for (let i = 1; i < fwd.length; i++) {
      const prev = filterOf(fwd[i - 1]!);
      const cur = filterOf(fwd[i]!);
      expect(fwd[i]!.startMs - fwd[i - 1]!.startMs).toBeGreaterThanOrEqual(
        10_000
      );
      expect(fwd[i]!.startMs - fwd[i - 1]!.startMs).toBeLessThan(10_500);
      expect(BigInt(cur.timestampMin!)).toBe(BigInt(prev.timestampMax!) + 1n);
    }
    for (const c of mock.calls.filter((c) => c.method === "searchTracesPage")) {
      const f = filterOf(c);
      const tailStart = BigInt(msToNs(c.startMs - DELAY_MS));
      expect(BigInt(f.timestampMax!)).toBeLessThan(tailStart);
      expect(f.timestampMin).toBeDefined(); // PR P19: always bounded below
      expect(f.limit).toBe(1000);
    }
    for (const c of fwd) {
      // timestampMax is ns(tickStart − 30 s) − 1, and the tick starts ≤ gap + latency before the call.
      const f = filterOf(c);
      const max = BigInt(f.timestampMax!) + 1n;
      expect(max).toBeLessThanOrEqual(BigInt(msToNs(c.startMs - DELAY_MS)));
      expect(max).toBeGreaterThan(BigInt(msToNs(c.startMs - DELAY_MS - 200)));
    }
    engine.stop();
  });

  it("the 20-page cap sets behindMs; the boundary keeps ≤ 1000 spanIds at the last nanosecond", async () => {
    let tick = 0;
    let boundaryNs = 0n;
    const forward = (f: { cursor?: string; timestampMin?: string }) => {
      const page = f.cursor ? Number(f.cursor) : 0;
      if (page === 0) tick++;
      if (tick > 1) return { data: [], nextCursor: null };
      const base = BigInt(f.timestampMin!);
      boundaryNs = base + 5_000_000_000n;
      const data: OtelTracesRow[] = [];
      for (let k = 0; k < 1000; k++) {
        // Pages 0–18 step forward; the last 500 rows of page 18 and all of
        // page 19 share one nanosecond (1500 rows).
        const atBoundary = page === 19 || (page === 18 && k >= 500);
        const ns = atBoundary
          ? boundaryNs
          : base + BigInt(page * 1000 + k) * 1000n;
        data.push({
          ...row({ spanId: `f${page}-${k}`, svc: "a", tsMs: 0 }),
          Timestamp: ns.toString(),
        });
      }
      return { data, nextCursor: String(page + 1) };
    };
    const { mock, engine, untilPhase, clock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10 }) : []),
      backward: abPages(1),
      forward: forward as MockHandlers["forward"],
    });
    engine.start();
    await untilPhase("live");
    await clock.runUntil(() => mock.calls.filter(isForward).length >= 20);
    await clock.advance(1000);
    expect(mock.calls.filter(isForward).length).toBe(20);
    expect(engine.stats().boundary).toBe(1000);
    expect(engine.getSnapshot()?.scan.behindMs).toBeGreaterThan(0);

    // The next tick restarts at exactly the boundary nanosecond.
    await clock.runUntil(() => mock.calls.filter(isForward).length >= 21);
    const next = filterOf(mock.calls.filter(isForward)[20]!);
    expect(next.timestampMin).toBe(boundaryNs.toString());
    expect(next.cursor).toBeUndefined();
    await clock.advance(1000);
    expect(engine.getSnapshot()?.scan.behindMs).toBe(0);
    expect(engine.stats().boundary).toBe(0);
    engine.stop();
  });
});

describe("probes (R2-5, PD-1)", () => {
  // Backward pages hold only a → b; x, y, z are in the seed but unconnected.
  const seedSpans = { a: 900, b: 800, x: 50, y: 40, z: 30 };

  it("one serviceName page and ≤ 2 traces per unconnected service; pairs counted once, only below coverage", async () => {
    let fromMs = 0;
    const traces: Record<string, OtelTracesRow[]> = {};
    const tsIn = (f: { timestampMax?: string }) =>
      Number(BigInt(f.timestampMax!) / 1_000_000n) - 30_000;
    const { mock, engine, untilPhase, clock } = setup(
      {
        seed: (w) => (w === "nodes" ? seedNodeRows(seedSpans) : []),
        backward: abPages(400),
        probe: (f) => {
          fromMs = Number((BigInt(f.timestampMax!) + 1n) / 1_000_000n);
          const ts = tsIn(f);
          const x = f.serviceName!;
          const ids =
            x === "x"
              ? ["tx1", "tx2", "tx3"]
              : x === "z"
                ? ["tx2", "tz1"]
                : ["ty1"];
          for (const id of ids) {
            if (traces[id]) continue;
            if (id === "tx1") {
              // gw → x → y: connects y, so y is never probed.
              traces[id] = [
                row({ traceId: id, spanId: "tx1-p", svc: "gw", tsMs: ts }),
                row({
                  traceId: id,
                  spanId: "tx1-c",
                  parentId: "tx1-p",
                  svc: "x",
                  tsMs: ts + 1,
                }),
                row({
                  traceId: id,
                  spanId: "tx1-g",
                  parentId: "tx1-c",
                  svc: "y",
                  tsMs: ts + 2,
                }),
              ];
            } else if (id === "tx2") {
              traces[id] = [
                row({ traceId: id, spanId: "tx2-p", svc: "gw", tsMs: ts }),
                row({
                  traceId: id,
                  spanId: "tx2-c",
                  parentId: "tx2-p",
                  svc: "x",
                  tsMs: ts + 1,
                }),
                // Starts after coverageFrom: the main scan already had it.
                row({
                  traceId: id,
                  spanId: "tx2-late",
                  parentId: "tx2-p",
                  svc: "x",
                  tsMs: fromMs + 10,
                }),
              ];
            } else {
              traces[id] = [
                row({ traceId: id, spanId: `${id}-p`, svc: "gw", tsMs: ts }),
                row({
                  traceId: id,
                  spanId: `${id}-c`,
                  parentId: `${id}-p`,
                  svc: x,
                  tsMs: ts + 1,
                }),
              ];
            }
          }
          return {
            data: ids.map((id) =>
              row({
                traceId: id,
                spanId: `${id}-row-${x}`,
                parentId: "pp",
                svc: x,
                tsMs: ts,
              })
            ),
            nextCursor: null,
          };
        },
        trace: (id) => traces[id] ?? [],
      },
      { scanMaxRequests: 50 }
    );
    engine.start();
    expect(await untilPhase("live")).toBe(true);

    const pages = mock.calls
      .filter(isProbePage)
      .map((c) => filterOf(c).serviceName);
    expect(pages).toEqual(["x", "z"]); // y was connected by x's trace
    const traceCalls = mock.calls
      .filter((c) => c.method === "getTrace")
      .map((c) => c.arg);
    expect(traceCalls).toEqual(["tx1", "tx2", "tz1"]); // tx2 not fetched twice

    // The probe window is [now − M, coverageFrom − 1].
    const probeFilter = filterOf(mock.calls.find(isProbePage)!);
    expect(probeFilter.sortOrder).toBe("DESC");
    expect(probeFilter.limit).toBe(1000);
    expect(
      Number(BigInt(probeFilter.timestampMin!) / 1_000_000n)
    ).toBeGreaterThan(LO);

    const s = engine.stats();
    expect(s.scanRequests).toBeLessThanOrEqual(50);
    // Flush a snapshot and look at the edges.
    await clock.advance(2000);
    const snap = engine.getSnapshot();
    expect(edgeCalls(snap, "gw", "x")).toBe(2); // tx1 + tx2, not tx2-late
    expect(edgeCalls(snap, "x", "y")).toBe(1);
    expect(edgeCalls(snap, "gw", "z")).toBe(1);
    const ids = snap!.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    engine.stop();
  });

  it("probes at most 50 services and never beyond the shared budget", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `u${String(i).padStart(2, "0")}`,
        100 - i,
      ])
    );
    const { mock, engine, untilPhase } = setup(
      {
        seed: (w) =>
          w === "nodes" ? seedNodeRows({ a: 900, b: 1, ...many }) : [],
        backward: abPages(500),
        probe: (f) => ({
          data: [1, 2, 3].map((k) =>
            row({
              traceId: `${f.serviceName}-${k}`,
              spanId: `${f.serviceName}-${k}`,
              parentId: "nobody",
              svc: f.serviceName!,
              tsMs: Number(BigInt(f.timestampMax!) / 1_000_000n) - 1000,
            })
          ),
          nextCursor: null,
        }),
        trace: () => [],
      },
      { probeReserve: 170, scanMaxRequests: 200 }
    );
    engine.start();
    expect(await untilPhase("live")).toBe(true);
    const pages = mock.calls.filter(isProbePage);
    expect(pages.length).toBeLessThanOrEqual(50);
    expect(pages.length).toBeGreaterThanOrEqual(45);
    expect(new Set(pages.map((c) => filterOf(c).serviceName)).size).toBe(
      pages.length
    );
    // ≤ 2 traces per probed service.
    expect(
      mock.calls.filter((c) => c.method === "getTrace").length
    ).toBeLessThanOrEqual(2 * pages.length);
    expect(engine.stats().scanRequests).toBeLessThanOrEqual(200);
    expect(mock.calls.length).toBeLessThanOrEqual(200);
    engine.stop();
  });
});

describe("getServices seed", () => {
  it("lists every known service as a node before spans connect them; silent ones are dimmed", async () => {
    const { engine, untilPhase, mock, clock } = setup({
      services: () => ["a", "b", "old-batch"],
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(3),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(2000);
    expect(mock.calls[0]?.method).toBe("getServices");
    const s = engine.getSnapshot()!;
    const old = s.nodes.find((n) => n.id === "old-batch");
    expect(old?.kind).toBe("service");
    expect(old?.active).toBe(false);
    expect(s.nodes.find((n) => n.id === "a")?.active).toBe(true);
    expect(s.hub).toBe("a");
    engine.stop();
  });
});

describe("hub (R2-2)", () => {
  it("is still chosen in live when every backward page failed", async () => {
    const { engine, untilPhase, clock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      fail: (call) => {
        if (isBackward(call)) throw new Error("backend down");
      },
      forward: (f) =>
        f.cursor
          ? { data: [], nextCursor: null }
          : {
              data: pairRows("fw", "a", "b", START - DELAY_MS - 1000),
              nextCursor: null,
            },
    });
    engine.start();
    await untilPhase("live", 6 * M_MS);
    expect(engine.getSnapshot()?.scan.stopReason).toBe("error");
    await clock.advance(25_000);
    expect(engine.getSnapshot()?.hub).toBe("a");
    engine.stop();
  });

  it("is chosen from the seed as soon as page 1 fails, when the seed connects anything", async () => {
    const { engine, clock, mock } = setup({
      seed: (w) =>
        w === "nodes"
          ? seedNodeRows({ a: 10, b: 50 })
          : [seedPeerRow("a", 7, { "db.system.name": "postgresql" })],
      fail: (call) => {
        if (isBackward(call)) throw new Error("backend down");
      },
    });
    engine.start();
    await clock.runUntil(() => mock.calls.filter(isBackward).length >= 1);
    await clock.advance(1000);
    const s = engine.getSnapshot()!;
    expect(s.scan.state).toBe("error");
    // `a` is the only service the seed connects (to its database).
    expect(s.hub).toBe("a");
    expect(mock.calls.filter(isBackward)).toHaveLength(1);
    engine.stop();
  });

  it("waits for page 1 when a failing scan has a seed that connects nothing", async () => {
    const { engine, clock, mock } = setup({
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 50 }) : []),
      fail: (call) => {
        if (isBackward(call)) throw new Error("backend down");
      },
    });
    engine.start();
    await clock.runUntil(() => mock.calls.filter(isBackward).length >= 3);
    await clock.advance(1000);
    expect(engine.getSnapshot()?.hub).toBeNull();
    engine.stop();
  });

  it("is chosen after seed + page 1 and does not change when a busier connected service shows up", async () => {
    const pages = backwardSource({
      pages: 6,
      loMs: LO,
      hiMs: T0,
      rowsFor: (i, _hi, lo) =>
        i === 0
          ? pairRows("first", "a", "b", Math.floor(lo) + 5)
          : pairRows(`late${i}`, "c", "d", Math.floor(lo) + 5),
    });
    const { engine, untilPhase, clock, mock } = setup({
      // c is far busier, but unconnected after page 1.
      seed: (w) =>
        w === "nodes" ? seedNodeRows({ a: 100, b: 50, c: 10_000, d: 1 }) : [],
      backward: pages,
    });
    engine.start();
    await clock.runUntil(
      () =>
        mock.calls.filter(isBackward).length >= 1 &&
        engine.getSnapshot()?.hub != null
    );
    expect(engine.getSnapshot()?.hub).toBe("a");
    await untilPhase("live");
    await clock.advance(2000);
    const s = engine.getSnapshot();
    expect(edgeCalls(s, "c", "d")).toBeGreaterThan(0);
    expect(s?.hub).toBe("a");
    engine.stop();
  });
});

describe("snapshots while paused", () => {
  it("keep the time of the last running snapshot: counts never shrink while no data can arrive", async () => {
    const clock = createFakeClock(START);
    const mock = createMockClient(clock, {
      seed: (w) => (w === "nodes" ? seedNodeRows({ a: 10, b: 5 }) : []),
      backward: abPages(10),
    });
    const run = new ScanRun({
      client: mock.client,
      clock,
      config: DEFAULT_CONFIG,
      onChange: () => {},
    });
    void run.start();
    await clock.runUntil(() => run.stats().phase === "live");
    const before = run.snapshot(1);
    expect(before.spansInWindow).toBeGreaterThan(0);
    run.pause();
    // Half the window later the oldest spans would have left it.
    await clock.advance(M_MS / 2);
    const paused = run.snapshot(2);
    expect(paused.scan.state).toBe("paused");
    expect(paused.spansInWindow).toBe(before.spansInWindow);
    expect(paused.edges).toEqual(before.edges);
    run.resume();
    await clock.advance(1000);
    expect(run.snapshot(3).spansInWindow).toBeLessThan(before.spansInWindow);
    run.abort();
  });
});
