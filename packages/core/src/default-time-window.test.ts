/// <reference types="vitest/globals" />
import {
  DEFAULT_TIME_WINDOW_MS,
  withDefaultTimeWindow,
} from "./data-filters-zod.js";

const NOW_MS = 1_800_000_000_000;
const DAY_NS = BigInt(DEFAULT_TIME_WINDOW_MS) * 1_000_000n;
const NOW_NS = BigInt(NOW_MS) * 1_000_000n;

type Filter = {
  serviceName?: string;
  traceId?: string;
  timestampMin?: string;
  timestampMax?: string;
  cursor?: string;
  sortOrder?: "ASC" | "DESC";
};
const window = (filter: Filter, nowMs?: number) =>
  withDefaultTimeWindow(filter, nowMs);

describe("withDefaultTimeWindow", () => {
  it("is 24 hours", () => {
    expect(DEFAULT_TIME_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("bounds a filter with no time range to the last 24 hours", () => {
    const result = window({ serviceName: "api" }, NOW_MS);
    expect(result).toEqual({
      serviceName: "api",
      timestampMin: String(NOW_NS - DAY_NS),
    });
  });

  it("starts 24 hours before timestampMax when only the end is given", () => {
    const max = String(NOW_NS - 5n * DAY_NS);
    const result = window({ timestampMax: max }, NOW_MS);
    expect(result).toEqual({
      timestampMax: max,
      timestampMin: String(NOW_NS - 6n * DAY_NS),
    });
  });

  it("never produces a negative start", () => {
    const result = window({ timestampMax: "1000" }, NOW_MS);
    expect(result.timestampMin).toBe("0");
  });

  it("leaves a filter with timestampMin unchanged", () => {
    const filter = { timestampMin: "1" };
    expect(withDefaultTimeWindow(filter, NOW_MS)).toBe(filter);
  });

  it("leaves a filter with both bounds unchanged", () => {
    const filter = { timestampMin: "1", timestampMax: "2" };
    expect(withDefaultTimeWindow(filter, NOW_MS)).toBe(filter);
  });

  it("leaves a trace lookup by traceId unbounded", () => {
    const filter = { traceId: "abc" };
    expect(withDefaultTimeWindow(filter, NOW_MS)).toBe(filter);
  });

  it("ends the window at now when timestampMax is in the future", () => {
    const max = String(NOW_NS + 7n * DAY_NS);
    const result = window({ timestampMax: max }, NOW_MS);
    expect(result.timestampMin).toBe(String(NOW_NS - DAY_NS));
    expect(result.timestampMax).toBe(max);
  });

  // The window start is recomputed per request. An ascending page continues
  // forward from its cursor, so a start that moved past the cursor would skip
  // the rows in between. Anchoring a day before the cursor keeps every row
  // after it, and keeps whole any trace that began just before it.
  it("anchors an ascending page a day before its cursor", () => {
    const cursorTs = NOW_NS - DAY_NS + 5_000_000_000n; // 5 s into the window
    const result = window(
      { sortOrder: "ASC", cursor: `${String(cursorTs)}:span-1` },
      NOW_MS + 10_000 // the next page comes 10 s later
    );
    expect(result.timestampMin).toBe(String(cursorTs - DAY_NS));
  });

  it("keeps the usual window for a descending page", () => {
    const cursorTs = NOW_NS - 1_000_000_000n;
    const result = window(
      { sortOrder: "DESC", cursor: `${String(cursorTs)}:span-1` },
      NOW_MS
    );
    expect(result.timestampMin).toBe(String(NOW_NS - DAY_NS));
  });

  it("ignores a cursor it cannot read", () => {
    const result = window({ sortOrder: "ASC", cursor: "garbage" }, NOW_MS);
    expect(result.timestampMin).toBe(String(NOW_NS - DAY_NS));
  });

  it("treats an empty traceId as no lookup and still bounds the search", () => {
    const result = window({ traceId: "" }, NOW_MS);
    expect(result.timestampMin).toBe(String(NOW_NS - DAY_NS));
  });

  it("does not mutate the input", () => {
    const filter: Filter = {};
    window(filter, NOW_MS);
    expect(filter).toEqual({});
  });

  it("uses the current time by default", () => {
    const before = BigInt(Date.now()) * 1_000_000n;
    const { timestampMin } = window({});
    const after = BigInt(Date.now()) * 1_000_000n;
    expect(BigInt(timestampMin ?? "")).toBeGreaterThanOrEqual(before - DAY_NS);
    expect(BigInt(timestampMin ?? "")).toBeLessThanOrEqual(after - DAY_NS);
  });
});
