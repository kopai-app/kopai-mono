import { describe, it, expect } from "vitest";
import { createBuckets } from "./buckets.js";
import { M_MS } from "./config.js";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 30);

describe("createBuckets (A7)", () => {
  it("sums calls and errors in the minutes of [now − M, now]", () => {
    const b = createBuckets();
    b.add("a->b", NOW - 5 * MIN, false);
    b.add("a->b", NOW - 5 * MIN, true);
    b.add("a->b", NOW - 59 * MIN, false);
    b.add("a->b", NOW, true);
    expect(b.sumLastM("a->b", NOW)).toEqual({ calls: 4, errors: 2 });
    expect(b.sumLastM("x->y", NOW)).toEqual({ calls: 0, errors: 0 });
  });

  it("accepts out-of-order minutes (backward scan writes older minutes later)", () => {
    const b = createBuckets();
    b.add("e", NOW - MIN, false);
    b.add("e", NOW - 30 * MIN, false);
    b.add("e", NOW - 10 * MIN, false);
    b.add("e", NOW - 2 * M_MS, false); // older than the ring: ignored
    expect(b.sumLastM("e", NOW).calls).toBe(3);
  });

  it("buckets older than M stop counting as time moves on", () => {
    const b = createBuckets();
    b.add("e", NOW - 50 * MIN, false);
    b.add("e", NOW - 10 * MIN, true);
    expect(b.sumLastM("e", NOW)).toEqual({ calls: 2, errors: 1 });
    expect(b.sumLastM("e", NOW + 15 * MIN)).toEqual({ calls: 1, errors: 1 });
    expect(b.sumLastM("e", NOW + 55 * MIN)).toEqual({ calls: 0, errors: 0 });
    // the key itself stays (edges never disappear, R2-3)
    expect(b.has("e")).toBe(true);
  });

  it("a ring moving forward reuses slots without leaking old counts", () => {
    const b = createBuckets();
    b.add("e", NOW, false);
    // exactly one ring length later the same slot is a new minute
    b.add("e", NOW + 61 * MIN, false);
    expect(b.sumLastM("e", NOW + 61 * MIN).calls).toBe(1);
    b.add("e", NOW + 63 * MIN, false);
    expect(b.sumLastM("e", NOW + 63 * MIN).calls).toBe(2);
  });

  it("trim ages every ring to now without changing in-window sums", () => {
    const b = createBuckets();
    b.add("e", NOW - 30 * MIN, false);
    b.addSpan(NOW - 30 * MIN);
    b.trim(NOW);
    expect(b.sumLastM("e", NOW).calls).toBe(1);
    expect(b.spansLastM(NOW)).toBe(1);
    b.trim(NOW + 31 * MIN);
    expect(b.sumLastM("e", NOW + 31 * MIN).calls).toBe(0);
    expect(b.spansLastM(NOW + 31 * MIN)).toBe(0);
  });

  it("counts spans in the window with the global ring", () => {
    const b = createBuckets();
    for (let i = 0; i < 90; i++) b.addSpan(NOW - i * MIN);
    expect(b.spansLastM(NOW)).toBe(61);
  });

  it("caps edges at EDGE_CAP and counts the overflow", () => {
    const b = createBuckets({ edgeCap: 3 });
    expect(b.add("a", NOW, false)).toBe(true);
    expect(b.add("b", NOW, false)).toBe(true);
    expect(b.add("c", NOW, false)).toBe(true);
    expect(b.add("d", NOW, false)).toBe(false);
    expect(b.add("a", NOW, false)).toBe(true); // existing key still counts
    expect(b.size()).toBe(3);
    expect(b.edgesDropped()).toBe(1);
  });
});
