import { describe, it, expect } from "vitest";
import { LogBuffer } from "./log-buffer.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

const BASE_NS = 1700000000000000000n;
const ts = (offsetMs: number) =>
  (BASE_NS + BigInt(offsetMs) * 1000000n).toString();

function makeRow(offsetMs: number, body: string, service = "svc"): OtelLogsRow {
  return {
    Timestamp: ts(offsetMs),
    Body: body,
    ServiceName: service,
    SeverityText: "INFO",
    SeverityNumber: 9,
  };
}

describe("LogBuffer", () => {
  it("stores and returns rows sorted by timestamp", () => {
    const buf = new LogBuffer();
    buf.merge([makeRow(200, "second"), makeRow(100, "first")]);
    const all = buf.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]!.Body).toBe("first");
    expect(all[1]!.Body).toBe("second");
  });

  it("deduplicates rows with same key", () => {
    const buf = new LogBuffer();
    const row = makeRow(100, "hello");
    buf.merge([row]);
    buf.merge([row]);
    expect(buf.size).toBe(1);
  });

  it("trims oldest rows when exceeding maxSize", () => {
    const buf = new LogBuffer(3);
    buf.merge([makeRow(10, "a"), makeRow(20, "b"), makeRow(30, "c")]);
    expect(buf.size).toBe(3);

    buf.merge([makeRow(40, "d")]);
    expect(buf.size).toBe(3);
    // oldest ("a" at ts=10) should be gone
    const bodies = buf.getAll().map((r) => r.Body);
    expect(bodies).toEqual(["b", "c", "d"]);
  });

  it("getNewestTimestamp returns latest timestamp", () => {
    const buf = new LogBuffer();
    buf.merge([makeRow(100, "a"), makeRow(300, "c"), makeRow(200, "b")]);
    expect(buf.getNewestTimestamp()).toBe(ts(300));
  });

  it("getNewestTimestamp returns undefined for empty buffer", () => {
    const buf = new LogBuffer();
    expect(buf.getNewestTimestamp()).toBeUndefined();
  });

  it("clear resets the buffer", () => {
    const buf = new LogBuffer();
    buf.merge([makeRow(100, "a")]);
    expect(buf.size).toBe(1);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it("handles empty merge", () => {
    const buf = new LogBuffer();
    buf.merge([]);
    expect(buf.size).toBe(0);
  });

  it("distinguishes rows with same timestamp but different body", () => {
    const buf = new LogBuffer();
    buf.merge([makeRow(100, "hello"), makeRow(100, "world")]);
    expect(buf.size).toBe(2);
  });

  it("distinguishes rows with same timestamp+body but different service", () => {
    const buf = new LogBuffer();
    buf.merge([makeRow(100, "hello", "svc-a"), makeRow(100, "hello", "svc-b")]);
    expect(buf.size).toBe(2);
  });
});
