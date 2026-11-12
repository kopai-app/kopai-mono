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
