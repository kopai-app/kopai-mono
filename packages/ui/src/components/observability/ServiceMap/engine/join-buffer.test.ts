import { describe, it, expect } from "vitest";
import { createJoinBuffer, type JoinBuffer } from "./join-buffer.js";
import { H_MS, JOIN_CAP, SKEW_MS } from "./config.js";
import type { Pair, Region, SpanTuple } from "./types.js";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const MIN = 60_000;

function span(
  spanId: string,
  parentId: string,
  svc: string,
  tsMs: number,
  over: Partial<SpanTuple> = {}
): SpanTuple {
  return {
    spanId,
    parentId,
    svc,
    kind: "Server",
    tsMs,
    endMs: tsMs + 50,
    err: false,
    ...over,
  };
}

function ingestAll(
  buf: JoinBuffer,
  spans: SpanTuple[],
  region: Region
): Pair[] {
  return spans.flatMap((s) => buf.ingest(s, region));
}

describe("join across pages (A2/A3)", () => {
  it("DESC: child on page 1, parent on page 3 → exactly one edge parent.svc → child.svc", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const base = T0 - 10 * MIN;
    // page 1 (newest first): the child and unrelated spans
    const p1 = ingestAll(
      buf,
      [span("c1", "p1", "cart", base + 40), span("x1", "", "web", base + 30)],
      "back"
    );
    buf.expire(base + 30, T0, false);
    // page 2: nothing related
    const p2 = ingestAll(buf, [span("x2", "", "web", base + 20)], "back");
    buf.expire(base + 20, T0, false);
    // page 3: the parent
    const p3 = ingestAll(buf, [span("p1", "", "gateway", base)], "back");
    expect([...p1, ...p2]).toEqual([]);
    expect(p3).toEqual([
      { source: "gateway", target: "cart", tsMs: base + 40, err: false },
    ]);
    expect(buf.pendingCount()).toBe(0);
  });

  it("ASC: parent before child → one edge, carrying the child's error flag", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const pairs = ingestAll(
      buf,
      [
        span("p1", "", "gateway", T0 + 1000),
        span("c1", "p1", "cart", T0 + 1010, { err: true }),
      ],
      "fwd"
    );
    expect(pairs).toEqual([
      { source: "gateway", target: "cart", tsMs: T0 + 1010, err: true },
    ]);
  });

  it("a parent with several waiting children pairs each child once", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const base = T0 - MIN;
    ingestAll(
      buf,
      [
        span("c1", "p", "cart", base + 3),
        span("c2", "p", "search", base + 2),
        span("c3", "p", "gateway", base + 1), // same service as parent
      ],
      "back"
    );
    const pairs = buf.ingest(span("p", "", "gateway", base), "back");
    expect(pairs.map((p) => `${p.source}->${p.target}`).sort()).toEqual([
      "gateway->cart",
      "gateway->search",
    ]);
    expect(buf.counters().selfCalls).toBe(1);
    // the parent arriving again (non-adjacent duplicate) is not counted twice
    expect(buf.ingest(span("p", "", "gateway", base), "back")).toEqual([]);
    expect(buf.counters().dupes).toBe(1);
  });
});

describe("self-calls and duplicates (R1-D7, R1-D21)", () => {
  it("a same-service pair gives no edge and increments selfCalls", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const pairs = ingestAll(
      buf,
      [span("p", "", "cart", T0 + 1), span("c", "p", "cart", T0 + 2)],
      "fwd"
    );
    expect(pairs).toEqual([]);
    expect(buf.counters().selfCalls).toBe(1);
  });

  it("a duplicated child row is not counted twice", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const child = span("c", "p", "cart", T0 + 2);
    const pairs = ingestAll(
      buf,
      [span("p", "", "web", T0 + 1), child, { ...child }],
      "fwd"
    );
    expect(pairs).toHaveLength(1);
    expect(buf.counters().dupes).toBe(1);
  });
});

describe("shared buffer, region rules (plan §2.1 step 6)", () => {
  it("forward parent in tick n pairs with its child in tick n+1 while the backward scan runs", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const backFrontier = T0 - 40 * MIN; // well below both, backDone = false
    const parentTs = T0 + 5_000;
    // tick n: the parent (short span, so the back-seen rule would expire it)
    expect(
      buf.ingest(
        span("p", "", "gateway", parentTs, { endMs: parentTs + 20 }),
        "fwd"
      )
    ).toEqual([]);
    let fwdFrontier = parentTs + 1_000;
    buf.expire(backFrontier, fwdFrontier, false);
    fwdFrontier += 10_000;
    buf.expire(backFrontier, fwdFrontier, false);
    // tick n+1: the child, 8 s later
    const pairs = buf.ingest(span("c", "p", "cart", parentTs + 8_000), "fwd");
    expect(pairs).toEqual([
      { source: "gateway", target: "cart", tsMs: parentTs + 8_000, err: false },
    ]);
    buf.expire(backFrontier, fwdFrontier + 10_000, false);
    expect(buf.counters().lateUnpaired).toBe(0);
  });

  it("a backward pending child survives a forward expire() and pairs on the next back page", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const childTs = T0 - 2 * MIN;
    buf.ingest(span("c", "p", "cart", childTs), "back");
    // forward far past child.ts + SKEW; backward frontier still above child.ts − H
    buf.expire(childTs - H_MS + 1_000, childTs + 60 * MIN, false);
    expect(buf.pendingCount()).toBe(1);
    expect(buf.counters().lateUnpaired).toBe(0);
    const pairs = buf.ingest(span("p", "", "gateway", childTs - 50), "back");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ source: "gateway", target: "cart" });
  });

  it("a back parent at T0−1s pairs with a forward child at T0+2s after the back frontier moved 30 min down", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const parentTs = T0 - 1_000;
    buf.ingest(
      span("p", "", "gateway", parentTs, { endMs: T0 + 3_000 }),
      "back"
    );
    // the backward scan moves on; the forward watermark is still T0
    for (let m = 1; m <= 30; m++) buf.expire(T0 - m * MIN, T0, false);
    expect(buf.seenCount()).toBe(1);
    // forward tick reads the child, then expires with the new watermark
    const pairs = buf.ingest(span("c", "p", "cart", T0 + 2_000), "fwd");
    expect(pairs).toEqual([
      { source: "gateway", target: "cart", tsMs: T0 + 2_000, err: false },
    ]);
    // once the forward scan has passed parent.end + SKEW, the parent goes
    buf.expire(T0 - 31 * MIN, T0 + 3_000 + SKEW_MS + 1, false);
    expect(buf.seenCount()).toBe(1); // only the forward child is left
  });

  it("a forward child near T0 waits for the backward frontier, then expires", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const childTs = T0 + 1_000;
    buf.ingest(span("c", "p", "cart", childTs), "fwd");
    // forward watermark far ahead, backward frontier has not passed child − H
    buf.expire(T0 - 30_000, childTs + 10 * MIN, false);
    expect(buf.pendingCount()).toBe(1);
    // its parent turns up on a back page just below T0
    expect(buf.ingest(span("p", "", "web", T0 - 500), "back")).toHaveLength(1);
    expect(buf.pendingCount()).toBe(0);

    // a second orphan child near T0 expires once the back frontier passes it
    buf.ingest(span("c2", "p2", "cart", childTs), "fwd");
    buf.expire(childTs - H_MS - 1, childTs + 10 * MIN, false);
    expect(buf.pendingCount()).toBe(0);
    expect(buf.counters().lateUnpaired).toBe(1);
  });

  it("a forward child far from T0 expires on the forward rule alone", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const childTs = T0 + 10 * MIN;
    buf.ingest(span("c", "p", "cart", childTs), "fwd");
    buf.expire(T0 - MIN, childTs + SKEW_MS - 1, false);
    expect(buf.pendingCount()).toBe(1);
    buf.expire(T0 - MIN, childTs + SKEW_MS + 1, false);
    expect(buf.pendingCount()).toBe(0);
    expect(buf.counters().lateUnpaired).toBe(1);
  });

  it("when backDone becomes true every remaining back pending child is lateUnpaired", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    for (let i = 0; i < 5; i++) {
      buf.ingest(span(`c${i}`, `p${i}`, "cart", T0 - MIN - i), "back");
    }
    buf.expire(T0 - 2 * MIN, T0, false);
    expect(buf.pendingCount()).toBe(5);
    buf.expire(T0 - 2 * MIN, T0, true);
    expect(buf.pendingCount()).toBe(0);
    expect(buf.counters().lateUnpaired).toBe(5);
  });

  it("a child whose parent does not arrive within H is lateUnpaired and its pending entry removed", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const childTs = T0 - 5 * MIN;
    buf.ingest(span("c", "p", "cart", childTs), "back");
    buf.expire(childTs - H_MS + 1, T0, false);
    expect(buf.pendingCount()).toBe(1);
    buf.expire(childTs - H_MS - 1, T0, false);
    expect(buf.pendingCount()).toBe(0);
    expect(buf.counters().lateUnpaired).toBe(1);
    // the parent arriving later can no longer make an edge
    expect(
      buf.ingest(span("p", "", "web", childTs - H_MS - 2), "back")
    ).toEqual([]);
  });

  it("forward seen entries expire H behind the forward watermark", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    buf.ingest(span("p", "", "web", T0 + 1_000), "fwd");
    buf.expire(T0 - MIN, T0 + 1_000 + H_MS, false);
    expect(buf.seenCount()).toBe(1);
    buf.expire(T0 - MIN, T0 + 1_000 + H_MS + 1, false);
    expect(buf.seenCount()).toBe(0);
  });
});

describe("cap accounting", () => {
  it("size() counts seen entries plus every pending child", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    for (let i = 0; i < 10; i++) {
      buf.ingest(span(`c${i}`, "p", "cart", T0 - MIN + i), "back");
    }
    expect(buf.pendingCount()).toBe(10);
    expect(buf.seenCount()).toBe(10);
    expect(buf.size()).toBe(20);
  });

  it("overfilling with children of a few parents evicts children one by one", () => {
    const cap = 1000;
    const buf = createJoinBuffer({ t0Ms: T0, cap });
    // children of 3 parents, each also a seen entry → 2 entries per child
    const n = 1500;
    for (let i = 0; i < n; i++) {
      buf.ingest(span(`c${i}`, `p${i % 3}`, "cart", T0 - MIN + i), "back");
      expect(buf.size()).toBeLessThanOrEqual(cap);
    }
    const { dropped } = buf.counters();
    expect(buf.size()).toBe(cap);
    expect(dropped).toBe(2 * n - cap);
    // the parents still pair only with the children that were not evicted
    // (each parent's own seen entry may evict one more child: at most 3)
    const pendingBefore = buf.pendingCount();
    expect(pendingBefore).toBeLessThan(n);
    const pairs = [0, 1, 2].flatMap((p) =>
      buf.ingest(span(`p${p}`, "", "web", T0 - 2 * MIN), "back")
    );
    expect(pairs.length).toBeLessThanOrEqual(pendingBefore);
    expect(pairs.length).toBeGreaterThanOrEqual(pendingBefore - 3);
    expect(buf.counters().dropped - dropped).toBeLessThanOrEqual(3);
    // evictions never become virtual edges: every pair is parent → real child
    expect(pairs.every((p) => p.source === "web" && p.target === "cart")).toBe(
      true
    );
  });

  it("eviction is by insertion order across seen and pending", () => {
    const buf = createJoinBuffer({ t0Ms: T0, cap: 4 });
    buf.ingest(span("a", "pa", "s1", T0 - 10), "back"); // pending a(0), seen a(1)
    buf.ingest(span("b", "", "s2", T0 - 20), "back"); // seen b(2)
    buf.ingest(span("c", "", "s3", T0 - 30), "back"); // seen c(3) → size 4
    buf.ingest(span("d", "", "s4", T0 - 40), "back"); // evicts pending a
    expect(buf.pendingCount()).toBe(0);
    expect(buf.counters().dropped).toBe(1);
    // the evicted child's parent arrives: no edge, no virtual edge
    expect(buf.ingest(span("pa", "", "s9", T0 - 50), "back")).toEqual([]);
    expect(buf.seenCount()).toBe(4);
  });

  it("stays fast and within JOIN_CAP when overfilled at the real cap", () => {
    const buf = createJoinBuffer({ t0Ms: T0 });
    const n = 80_000;
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      buf.ingest(span(`c${i}`, `p${i % 4}`, "cart", T0 - MIN + i), "back");
    }
    const elapsed = performance.now() - start;
    expect(buf.size()).toBe(JOIN_CAP);
    expect(buf.counters().dropped).toBe(2 * n - JOIN_CAP);
    // generous: catches quadratic eviction, not a micro-benchmark
    // scaled by KOPAI_PERF_SCALE (default 1 locally, 25 on CI; plan §4)
    const scale = Number(
      process.env.KOPAI_PERF_SCALE ?? (process.env.CI ? 25 : 1)
    );
    expect(elapsed).toBeLessThan(1_000 * scale);
  });
});
