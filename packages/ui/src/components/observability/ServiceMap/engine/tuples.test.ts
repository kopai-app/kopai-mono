import { describe, it, expect } from "vitest";
import type { OtelTracesRow } from "@kopai/sdk";
import { createTupleReader, toTuple, UNKNOWN_SERVICE } from "./tuples.js";
import { msToNs, nsMinusOne, nsToMs, minuteOf } from "./time.js";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const LO = NOW - 3_600_000;

function row(over: Partial<OtelTracesRow> & { tsMs?: number } = {}) {
  const { tsMs = NOW - 60_000, ...rest } = over;
  return {
    SpanId: "s1",
    TraceId: "t1",
    Timestamp: msToNs(tsMs),
    ServiceName: "cart",
    SpanKind: "Server",
    ParentSpanId: "p1",
    Duration: "2500000", // 2.5 ms
    StatusCode: "Unset",
    ...rest,
  } satisfies OtelTracesRow;
}

describe("time helpers", () => {
  it("converts ns strings to ms and back", () => {
    expect(nsToMs("1762430400123456789")).toBe(1762430400123);
    expect(nsToMs("999999")).toBe(0);
    expect(nsToMs("0")).toBe(0);
    expect(nsToMs("-5000000")).toBe(-5);
    expect(nsToMs("abc")).toBeNaN();
    expect(msToNs(1762430400123)).toBe("1762430400123000000");
    expect(nsMinusOne("1762430400123000000")).toBe("1762430400122999999");
    expect(minuteOf(120_000)).toBe(2);
    expect(minuteOf(119_999)).toBe(1);
  });
});

describe("toTuple", () => {
  it("maps a row to the minimal tuple", () => {
    const r = toTuple(row({ StatusCode: "Error" }), LO, NOW);
    expect(r).toEqual({
      ok: true,
      tuple: {
        spanId: "s1",
        parentId: "p1",
        svc: "cart",
        kind: "Server",
        tsMs: NOW - 60_000,
        endMs: NOW - 60_000 + 2,
        err: true,
      },
    });
  });

  it("defaults: root span, missing kind, service from resource or unknown", () => {
    const fromResource = toTuple(
      row({
        ParentSpanId: undefined,
        SpanKind: undefined,
        ServiceName: undefined,
        ResourceAttributes: { "service.name": "billing" },
        Duration: undefined,
      }),
      LO,
      NOW
    );
    expect(fromResource.ok && fromResource.tuple).toMatchObject({
      parentId: "",
      kind: "Unspecified",
      svc: "billing",
      endMs: NOW - 60_000,
      err: false,
    });
    const unknown = toTuple(row({ ServiceName: "" }), LO, NOW);
    expect(unknown.ok && unknown.tuple.svc).toBe(UNKNOWN_SERVICE);
  });

  it("classifies bad timestamps (Q18)", () => {
    expect(toTuple(row({ Timestamp: "0" }), LO, NOW)).toEqual({
      ok: false,
      reason: "zero",
    });
    expect(toTuple(row({ tsMs: NOW + 60_000 }), LO, NOW)).toEqual({
      ok: false,
      reason: "future",
    });
    // within the skew pad is fine
    expect(toTuple(row({ tsMs: NOW + 4_000 }), LO, NOW).ok).toBe(true);
    expect(toTuple(row({ tsMs: LO - 1 }), LO, NOW)).toEqual({
      ok: false,
      reason: "window",
    });
  });
});

describe("createTupleReader", () => {
  it("skips an adjacent duplicate (R1-D21) and counts it once", () => {
    const reader = createTupleReader();
    const a = row({ SpanId: "a" });
    expect(reader.read(a, LO, NOW)).not.toBeNull();
    expect(reader.read({ ...a }, LO, NOW)).toBeNull();
    expect(reader.stats().dupes).toBe(1);
    // same timestamp, different span: not a duplicate
    expect(reader.read(row({ SpanId: "b" }), LO, NOW)).not.toBeNull();
    // same span again, but not adjacent: the O(1) guard lets it through
    expect(reader.read(row({ SpanId: "a" }), LO, NOW)).not.toBeNull();
    expect(reader.stats().dupes).toBe(1);
  });

  it("resetAdjacent forgets the previous row", () => {
    const reader = createTupleReader();
    const a = row({ SpanId: "a" });
    reader.read(a, LO, NOW);
    reader.resetAdjacent();
    expect(reader.read(a, LO, NOW)).not.toBeNull();
  });

  it("counts bad timestamps and never moves the window bounds", () => {
    const reader = createTupleReader();
    reader.read(row({ SpanId: "ok1", tsMs: NOW - 120_000 }), LO, NOW);
    reader.read(row({ SpanId: "ok2", tsMs: NOW - 30_000 }), LO, NOW);
    const before = reader.stats();
    expect(before.oldestMs).toBe(NOW - 120_000);
    expect(before.newestMs).toBe(NOW - 30_000);

    expect(reader.read(row({ SpanId: "z", Timestamp: "0" }), LO, NOW)).toBe(
      null
    );
    expect(
      reader.read(row({ SpanId: "f", tsMs: NOW + 86_400_000 }), LO, NOW)
    ).toBe(null);
    expect(
      reader.read(row({ SpanId: "o", tsMs: LO - 86_400_000 }), LO, NOW)
    ).toBe(null);
    const after = reader.stats();
    expect(after.badTimestamp).toBe(3);
    expect(after.oldestMs).toBe(before.oldestMs);
    expect(after.newestMs).toBe(before.newestMs);
  });

  it("interns service names so buffered tuples share one string", () => {
    const reader = createTupleReader();
    const t1 = reader.read(row({ SpanId: "1", ServiceName: "cart" }), LO, NOW);
    const t2 = reader.read(
      row({ SpanId: "2", ServiceName: ["c", "a", "r", "t"].join("") }),
      LO,
      NOW
    );
    expect(t1?.svc).toBe("cart");
    expect(t2?.svc).toBe(t1?.svc);
  });
});
