import { describe, it, expect } from "vitest";
import {
  narrowRows,
  hasMetricRowShape,
  hasLogRowShape,
  hasTraceRowShape,
} from "./narrowRows.js";

// L6/L9: the polymorphic `query` dataSource can feed any of the six result
// shapes into a signal-specific renderer. narrowRows must forward rows only
// when they match the expected shape, and return null otherwise so the
// renderer falls back to an empty list instead of rendering garbage.
describe("narrowRows", () => {
  it("returns rows when the shape matches", () => {
    const res = {
      data: [{ TimeUnix: "1", MetricType: "Gauge", Value: 1 }],
    };
    expect(narrowRows(res, hasMetricRowShape)).toHaveLength(1);
  });

  it("returns null when a metric renderer receives log rows (wrong signal)", () => {
    const res = { data: [{ Timestamp: "1", Body: "hello" }] };
    expect(narrowRows(res, hasMetricRowShape)).toBeNull();
  });

  it("returns the row when a metric renderer receives raw metric rows lacking the synthetic MetricType", () => {
    // MetricType is injected by the datasource after mapping; the guard must
    // not depend on it. A row with just TimeUnix is still a metric row.
    const res = { data: [{ TimeUnix: "1", Value: 1 }] };
    expect(narrowRows(res, hasMetricRowShape)).toHaveLength(1);
  });

  it("returns null for non-array / missing data", () => {
    expect(narrowRows({ data: undefined }, hasMetricRowShape)).toBeNull();
    expect(narrowRows(null, hasMetricRowShape)).toBeNull();
    expect(narrowRows(undefined, hasMetricRowShape)).toBeNull();
  });

  it("validates every row, not just the first (a query can mix shapes)", () => {
    const mixed = {
      data: [{ TimeUnix: "1", MetricType: "Gauge" }, { Timestamp: "1" }],
    };
    expect(narrowRows(mixed, hasMetricRowShape)).toBeNull();
  });

  it("returns an empty array for empty data (valid, just no rows)", () => {
    expect(narrowRows({ data: [] }, hasMetricRowShape)).toEqual([]);
  });
});

describe("row shape guards", () => {
  // Minimal rows shaped like what the SQLite/ClickHouse mappers emit: every
  // column key is present for the signal (value may be empty), and never a
  // key from another signal.
  const traceRow = {
    Timestamp: "1",
    SpanId: "s",
    TraceId: "t",
    SpanName: "GET /x",
    SpanKind: "SERVER",
    Duration: "5",
    StatusCode: "OK",
  };
  const logRow = {
    Timestamp: "1",
    SpanId: "s", // a trace-correlated log carries both IDs
    TraceId: "t",
    Body: "hello",
    SeverityText: "INFO",
    SeverityNumber: 9,
    EventName: undefined, // key present, empty value — mappers emit it
  };
  const metricRow = { TimeUnix: "1", MetricName: "m", Value: 1 };

  it("hasMetricRowShape keys on TimeUnix, not the synthetic MetricType", () => {
    expect(hasMetricRowShape(metricRow)).toBe(true);
    expect(hasMetricRowShape({ TimeUnix: "1" })).toBe(true); // no MetricType needed
    expect(hasMetricRowShape({ MetricName: "m" })).toBe(false); // no TimeUnix
    expect(hasMetricRowShape(traceRow)).toBe(false);
    expect(hasMetricRowShape(logRow)).toBe(false);
    expect(hasMetricRowShape(null)).toBe(false);
  });

  it("hasLogRowShape accepts logs and rejects traces and metrics", () => {
    expect(hasLogRowShape(logRow)).toBe(true);
    // Regression: a trace row has Timestamp + no TimeUnix but must NOT pass —
    // it carries span-only keys and no log-only key.
    expect(hasLogRowShape(traceRow)).toBe(false);
    expect(hasLogRowShape(metricRow)).toBe(false);
    // A bare Timestamp with no log-only marker is not enough.
    expect(hasLogRowShape({ Timestamp: "1" })).toBe(false);
  });

  it("hasTraceRowShape accepts spans and rejects trace-correlated logs and metrics", () => {
    expect(hasTraceRowShape(traceRow)).toBe(true);
    // Regression: a trace-correlated log has SpanId + TraceId but must NOT pass.
    expect(hasTraceRowShape(logRow)).toBe(false);
    expect(hasTraceRowShape(metricRow)).toBe(false);
    // SpanId + TraceId alone (no span-only structural key) is not enough.
    expect(hasTraceRowShape({ SpanId: "s", TraceId: "t" })).toBe(false);
  });
});
