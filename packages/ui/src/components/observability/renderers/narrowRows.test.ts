import { describe, it, expect } from "vitest";
import {
  narrowRows,
  narrowQueryRows,
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

// narrowQueryRows turns a shape mismatch into an explicit error instead of an
// empty panel: an aggregate-mode (or wrong-signal) result reaching a renderer
// that only draws raw metric rows must be visible to the dashboard author.
describe("narrowQueryRows", () => {
  it("forwards matching rows with no error", () => {
    const res = { data: [{ TimeUnix: "1", Value: 1 }] };
    const out = narrowQueryRows(res, hasMetricRowShape, "metric");
    expect(out.rows).toHaveLength(1);
    expect(out.error).toBeUndefined();
  });

  it("surfaces an error when an aggregate-shaped result reaches a raw renderer", () => {
    // KopaiAggregateRow: dynamic dimension/measure keys, no TimeUnix.
    const res = { data: [{ "service.name": "api", p95_duration: 123 }] };
    const out = narrowQueryRows(res, hasMetricRowShape, "metric");
    expect(out.rows).toEqual([]);
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error?.message).toContain("aggregate-mode");
  });

  it("surfaces an error for a wrong-signal raw result", () => {
    const res = { data: [{ Timestamp: "1", Body: "hello" }] }; // log rows
    const out = narrowQueryRows(res, hasMetricRowShape, "metric");
    expect(out.rows).toEqual([]);
    expect(out.error).toBeInstanceOf(Error);
  });

  it("does NOT error on an empty result set (nothing to draw)", () => {
    const out = narrowQueryRows({ data: [] }, hasMetricRowShape, "metric");
    expect(out.rows).toEqual([]);
    expect(out.error).toBeUndefined();
  });

  it("does NOT error on a null/absent response (loading or upstream fetch error)", () => {
    expect(
      narrowQueryRows(null, hasMetricRowShape, "metric").error
    ).toBeUndefined();
    expect(
      narrowQueryRows({ data: undefined }, hasMetricRowShape, "metric").error
    ).toBeUndefined();
  });

  it("names the signal in the error message", () => {
    const res = { data: [{ foo: "bar" }] };
    expect(
      narrowQueryRows(res, hasMetricRowShape, "metric").error?.message
    ).toContain("raw metric rows");
    expect(
      narrowQueryRows(res, hasLogRowShape, "log").error?.message
    ).toContain("raw log rows");
    expect(
      narrowQueryRows(res, hasTraceRowShape, "trace").error?.message
    ).toContain("raw trace rows");
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
    SpanKind: "Server",
    Duration: "5",
    StatusCode: "Ok",
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
    // Regression: span-like keys but no raw Timestamp (e.g. an aggregate row)
    // must NOT pass now that a string Timestamp is required.
    expect(hasTraceRowShape({ SpanId: "s", TraceId: "t", SpanName: "x" })).toBe(
      false
    );
  });
});
