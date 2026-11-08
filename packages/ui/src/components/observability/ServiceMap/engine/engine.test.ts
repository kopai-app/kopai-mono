import { describe, it, expect } from "vitest";
import type { OtelTracesRow, TracesDataFilter } from "@kopai/sdk";
import { DELAY_MS, M_MS, type EngineConfig } from "./config.js";
import {
  createServiceMapEngine,
  formatCoverage,
  systemClock,
} from "./engine.js";
import { backoffMs } from "./scheduler.js";
import { edgeId } from "./graph-state.js";
import { msToNs } from "./time.js";
import {
  backwardSource,
  createFakeClock,
  createMockClient,
  filterOf,
  isBackward,
  pairRows,
  row,
  seedNodeRows,
  type MockHandlers,
} from "./test-utils.js";
import type { ServiceMapSnapshot } from "./types.js";

const START = Date.UTC(2026, 10, 6, 12, 0, 0);
const T0 = START - DELAY_MS;
const LO = START - M_MS;

function setup(h: MockHandlers, config?: Partial<EngineConfig>) {
  const clock = createFakeClock(START);
  const mock = createMockClient(clock, h);
  const snaps: { atMs: number; s: ServiceMapSnapshot }[] = [];
  const engine = createServiceMapEngine({
    client: mock.client,
    clock,
    config,
    onSnapshot: (s) => snaps.push({ atMs: clock.now(), s }),
  });
  const untilPhase = (phase: string, limitMs = 3 * M_MS) =>
    clock.runUntil(() => engine.stats().phase === phase, limitMs);
  return { clock, mock, engine, snaps, untilPhase };
}

const abPages = (pages: number) =>
  backwardSource({
    pages,
    loMs: LO,
    hiMs: T0,
    rowsFor: (i, _hi, lo) => pairRows(`ab${i}`, "a", "b", Math.floor(lo) + 10),
  });

const seedAB = (w: "nodes" | "edges") =>
  w === "nodes" ? seedNodeRows({ a: 100, b: 50 }) : [];

describe("snapshot throttle", () => {
  it("emits at most once per 750 ms, and the first snapshot carries the hub", async () => {
    const { engine, clock, snaps, untilPhase } = setup({
      seed: seedAB,
      backward: abPages(300),
    });
    engine.start();
    await untilPhase("live");
    await clock.advance(60_000);
    expect(snaps.length).toBeGreaterThan(15);
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]!.atMs - snaps[i - 1]!.atMs).toBeGreaterThanOrEqual(750);
      expect(snaps[i]!.s.seq).toBeGreaterThan(snaps[i - 1]!.s.seq);
    }
    // The first snapshot after page 1 already names the hub.
    const firstWithEdges = snaps.find((x) => x.s.edges.length > 0);
    expect(firstWithEdges?.s.hub).toBe("a");
    engine.stop();
  });
});

describe("errors and backoff (last good graph kept)", () => {
  it("an error on page 5 keeps the graph; retry() resumes from the cursor", async () => {
    let failed = false;
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(20),
      fail: (call) => {
        if (!failed && isBackward(call) && filterOf(call).cursor === "4") {
          failed = true;
          throw new Error("HTTP 503");
        }
      },
    });
    engine.start();
    expect(
      await clock.runUntil(() => engine.getSnapshot()?.scan.state === "error")
    ).toBe(true);
    const s = engine.getSnapshot()!;
    expect(s.error).toBe("HTTP 503");
    expect(s.edges.find((e) => e.id === edgeId("a", "b"))?.calls).toBe(4);
    expect(s.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(s.hub).toBe("a");

    const failedCall = mock.calls.find((c) => c.failed)!;
    const n = mock.calls.length;
    engine.retry();
    await clock.runUntil(() => mock.calls.length > n);
    const retried = mock.calls[n]!;
    expect(isBackward(retried)).toBe(true);
    expect(filterOf(retried).cursor).toBe("4");
    // retry() skipped the 1 s backoff (only the 100 ms gap applies).
    expect(retried.startMs - failedCall.endMs!).toBeLessThan(1000);

    await clock.runUntil(() => engine.stats().phase === "live");
    await clock.advance(1000);
    const after = engine.getSnapshot()!;
    expect(after.error).toBeNull();
    expect(after.scan.state).toBe("live");
    expect(after.edges.find((e) => e.id === edgeId("a", "b"))?.calls).toBe(20);
    engine.stop();
  });

  it("backs off 1 s, 2 s, 4 s between consecutive failures and recovers", async () => {
    let failures = 0;
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(3),
      fail: (call) => {
        if (isBackward(call) && failures < 3) {
          failures++;
          throw new Error("boom");
        }
      },
    });
    engine.start();
    await clock.runUntil(() => engine.stats().phase === "live");
    const back = mock.calls.filter(isBackward);
    expect(back.filter((c) => c.failed)).toHaveLength(3);
    const waits = back.slice(1, 4).map((c, i) => c.startMs - back[i]!.endMs!);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
    expect(waits[1]).toBeGreaterThanOrEqual(2000);
    expect(waits[2]).toBeGreaterThanOrEqual(4000);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(10)).toBe(30_000);
    engine.stop();
  });

  it("when failures use up the budget, the backward scan stops with stopReason error", async () => {
    const { engine, clock } = setup(
      {
        seed: seedAB,
        backward: abPages(100),
        fail: (call) => {
          if (isBackward(call)) throw new Error("down");
        },
      },
      { scanMaxRequests: 10, probeReserve: 2 }
    );
    engine.start();
    await clock.runUntil(() => engine.stats().phase === "live", 10 * M_MS);
    await clock.advance(1000);
    const s = engine.getSnapshot()!;
    expect(s.scan.stopReason).toBe("error");
    expect(s.scan.requests).toBeLessThanOrEqual(10);
    engine.stop();
  });
});

describe("stop, pause, resume, restart", () => {
  it("stop() aborts the in-flight request and nothing runs afterwards", async () => {
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(10),
      latencyMs: 5000,
    });
    engine.start();
    await clock.runUntil(() => mock.calls.length === 3);
    const inFlight = mock.calls[2]!;
    expect(inFlight.signal?.aborted).toBe(false);
    engine.stop();
    await clock.flush();
    expect(inFlight.signal?.aborted).toBe(true);
    await clock.advance(10 * 60_000);
    expect(mock.calls).toHaveLength(3);
    expect(clock.pending()).toBe(0);
  });

  it("pause() holds new requests; resume() continues where it left off", async () => {
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(50),
    });
    engine.start();
    await clock.runUntil(() => mock.calls.filter(isBackward).length >= 5);
    engine.pause();
    await clock.advance(1000);
    const n = mock.calls.length;
    await clock.advance(5 * 60_000);
    expect(mock.calls.length).toBe(n);
    expect(engine.getSnapshot()?.scan.state).toBe("paused");
    const lastCursor = filterOf(mock.calls.filter(isBackward).at(-1)!).cursor;

    engine.resume();
    await clock.advance(1000);
    expect(mock.calls.length).toBeGreaterThan(n);
    // A gap < M is caught up by the forward poll, not by a restart.
    expect(
      mock.calls.slice(n).some((c) => c.method === "queryTracesAggregate")
    ).toBe(false);
    const resumed = mock.calls.slice(n).find(isBackward);
    if (resumed) {
      expect(Number(filterOf(resumed).cursor)).toBe(Number(lastCursor) + 1);
    }
    expect(engine.getSnapshot()?.scan.state).not.toBe("paused");
    engine.stop();
  });

  it("pause() right after start(): not even the first request leaves", async () => {
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(5),
    });
    engine.start();
    engine.pause();
    await clock.advance(5 * 60_000);
    expect(mock.calls).toHaveLength(0);
    engine.resume();
    await clock.runUntil(() => mock.calls.length > 0);
    expect(mock.calls[0]?.method).toBe("getServices");
    engine.stop();
  });

  it("resume() after a pause longer than M restarts the session from the seed", async () => {
    const { engine, clock, mock } = setup({
      seed: seedAB,
      backward: abPages(5),
    });
    engine.start();
    await clock.runUntil(() => engine.stats().phase === "live");
    await clock.advance(1000);
    const seqBefore = engine.getSnapshot()!.seq;
    engine.pause();
    await clock.advance(M_MS + 60_000);
    const n = mock.calls.length;
    const resumeAt = clock.now();
    engine.resume();
    await clock.runUntil(() => mock.calls.length >= n + 4);
    const fresh = mock.calls.slice(n);
    expect(fresh[0]?.method).toBe("getServices");
    expect(fresh[1]?.method).toBe("queryTracesAggregate");
    expect(fresh[2]?.method).toBe("queryTracesAggregate");
    const page = filterOf(fresh[3]!);
    expect(page.sortOrder).toBe("DESC");
    // A fresh window, anchored at the restart.
    expect(page.timestampMin).toBe(msToNs(resumeAt - M_MS));
    expect(page.cursor).toBeUndefined();
    await clock.advance(1000);
    const s = engine.getSnapshot()!;
    expect(s.seq).toBeGreaterThan(seqBefore);
    expect(s.scan.requests).toBeLessThan(10);
    engine.stop();
  });
});

describe("long live run (caps independent of session length)", () => {
  it(
    "30 simulated minutes of live traffic keep every structure within its cap",
    { timeout: 60_000 },
    async () => {
      const caps = { joinCap: 400, nodeCap: 60, edgeCap: 45 };
      const STEP = 200; // one trace every 200 ms
      let traceNo = 0;
      const forward = (f: TracesDataFilter) => {
        const lo = Number(BigInt(f.timestampMin!) / 1_000_000n);
        const hi = Number(BigInt(f.timestampMax!) / 1_000_000n);
        const data: OtelTracesRow[] = [];
        for (let ts = Math.ceil(lo / STEP) * STEP; ts <= hi; ts += STEP) {
          const k = traceNo++;
          const id = `lr${k}`;
          // 150 distinct services overall: more than nodeCap.
          const from = `svc${k % 150}`;
          const to = `svc${(k * 7 + 3) % 150}`;
          data.push(
            row({ traceId: id, spanId: `${id}-p`, svc: from, tsMs: ts }),
            row({
              traceId: id,
              spanId: `${id}-c`,
              parentId: `${id}-p`,
              svc: to,
              tsMs: ts + 1,
              err: k % 9 === 0,
            }),
            // A child whose parent never arrives (expires as lateUnpaired).
            row({
              traceId: id,
              spanId: `${id}-o`,
              parentId: `${id}-gone`,
              svc: to,
              tsMs: ts + 2,
            })
          );
        }
        return { data, nextCursor: null };
      };
      const { engine, clock, untilPhase } = setup(
        {
          seed: (w) =>
            w === "nodes" ? seedNodeRows({ svc0: 10, svc1: 5 }) : [],
          backward: abPages(3),
          forward,
        },
        caps
      );
      engine.start();
      await untilPhase("live");
      for (let minute = 0; minute < 30; minute++) {
        await clock.advance(60_000);
        const st = engine.stats();
        expect(st.joinSize).toBeLessThanOrEqual(caps.joinCap);
        expect(st.nodes).toBeLessThanOrEqual(caps.nodeCap);
        expect(st.edges).toBeLessThanOrEqual(caps.edgeCap);
        expect(st.boundary).toBeLessThanOrEqual(1000);
        expect(st.probedTraces).toBeLessThanOrEqual(100);
        const s = engine.getSnapshot()!;
        expect(s.nodes.length).toBeLessThanOrEqual(caps.nodeCap);
        expect(s.edges.length).toBeLessThanOrEqual(caps.edgeCap);
      }
      const s = engine.getSnapshot()!;
      expect(traceNo).toBeGreaterThan(8000);
      expect(s.scan.state).toBe("live");
      expect(s.scan.behindMs).toBe(0);
      expect(s.diagnostics.nodeCapHit).toBe(true);
      expect(s.diagnostics.lateUnpaired).toBeGreaterThan(0);
      expect(s.edges.some((e) => e.active && e.calls > 0)).toBe(true);
      engine.stop();
      expect(clock.pending()).toBe(0);
    }
  );
});

describe("formatCoverage", () => {
  const base = (
    over: Partial<ServiceMapSnapshot["scan"]>,
    from: number | null,
    to: number | null
  ) =>
    ({
      coverage: { fromMs: from, toMs: to, windowMs: M_MS },
      scan: {
        state: "scanning",
        stopReason: null,
        requests: 0,
        maxRequests: 200,
        behindMs: 0,
        ...over,
      },
    }) as ServiceMapSnapshot;

  it("reports the actual coverage in minutes", () => {
    expect(formatCoverage(base({}, null, null))).toBe("covers 0 of 60 min");
    expect(formatCoverage(base({}, START - 6 * 60_000, START))).toBe(
      "covers 6 of 60 min"
    );
    expect(
      formatCoverage(base({ stopReason: "budget" }, START - 59 * 60_000, START))
    ).toBe("covers 59 of 60 min");
  });

  it("a scan that reached the window bottom and a caught-up poll cover all 60 min", () => {
    expect(
      formatCoverage(
        base(
          { stopReason: "coverage", state: "live" },
          START - M_MS,
          START - 40_000
        )
      )
    ).toBe("covers 60 of 60 min");
    expect(
      formatCoverage(
        base(
          { stopReason: "no-more-data", behindMs: 120_000 },
          START - M_MS,
          START - 150_000
        )
      )
    ).toBe("covers 58 of 60 min");
  });
});

describe("systemClock", () => {
  it("sleep resolves after the delay and rejects on abort", async () => {
    await expect(systemClock.sleep(1)).resolves.toBeUndefined();
    const ctl = new AbortController();
    const p = systemClock.sleep(10_000, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow("aborted");
  });
});
