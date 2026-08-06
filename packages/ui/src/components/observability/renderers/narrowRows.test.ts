import { describe, it, expect } from "vitest";
import {
  narrowRows,
  narrowQueryRows,
  narrowAggregateRows,
  hasMetricRowShape,
  hasLogRowShape,
  hasTraceRowShape,
  hasAggregateRowShape,
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

  it("hasAggregateRowShape accepts flat scalar rows and rejects raw rows", () => {
    // Dimension + measure columns, all scalar.
    expect(hasAggregateRowShape({ SpanName: "trpc.x", calls: 3 })).toBe(true);
    expect(hasAggregateRowShape({ StatusCode: "Error", requests: 0 })).toBe(
      true
    );
    // timeSeries aggregate adds a scalar bucket_start.
    expect(hasAggregateRowShape({ bucket_start: "2024-01-01", value: 1 })).toBe(
      true
    );
    expect(hasAggregateRowShape({ value: null })).toBe(true);
    // Raw rows carry object/array-valued fields — must NOT pass.
    expect(hasAggregateRowShape({ ...metricRow, Attributes: {} })).toBe(false);
    expect(
      hasAggregateRowShape({ SpanName: "x", ResourceAttributes: {} })
    ).toBe(false);
    expect(
      hasAggregateRowShape({ MetricName: "m", "Exemplars.Value": [] })
    ).toBe(false);
    expect(hasAggregateRowShape(null)).toBe(false);
    // Scalar-only rows that still match a raw-signal guard are rejected, so a
    // raw result bound to an aggregate renderer surfaces the config error
    // rather than rendering silently.
    expect(
      hasAggregateRowShape({ TimeUnix: "1", MetricName: "m", Value: 1 })
    ).toBe(false);
    expect(
      hasAggregateRowShape({ Timestamp: "1", Body: "hi", SeverityText: "INFO" })
    ).toBe(false);
    expect(
      hasAggregateRowShape({
        Timestamp: "1",
        SpanId: "s",
        TraceId: "t",
        SpanName: "x",
        Duration: 5,
        StatusCode: "Ok",
      })
    ).toBe(false);
  });

  // An aggregate may group by a column the raw guards key on. Verified against
  // a live backend: `kq.metrics("Gauge").aggregate().dimension("TimeUnix")`
  // returns `{ TimeUnix: "1786017799669000000", n: 101 }`, which the bare
  // TimeUnix check would misread as a raw metric row and send to the error path.
  it("hasAggregateRowShape accepts aggregates grouped by raw-signal columns", () => {
    expect(
      hasAggregateRowShape({ TimeUnix: "1786017799669000000", n: 101 })
    ).toBe(true);
    // Log/trace-flavoured dimensions likewise: no raw Timestamp, so no veto.
    expect(hasAggregateRowShape({ Body: "job failed", n: 3 })).toBe(true);
    expect(hasAggregateRowShape({ SpanId: "0033932b485499f8", n: 1 })).toBe(
      true
    );
    expect(hasAggregateRowShape({ StatusCode: "Error", Duration: 12 })).toBe(
      true
    );
    // A real raw metric row still carries its value/identity columns and is
    // still rejected — each companion key alone is enough to veto.
    for (const companion of [
      { Value: 1 },
      { MetricName: "m" },
      { MetricType: "Gauge" },
      { StartTimeUnix: "1" },
    ]) {
      expect(
        hasAggregateRowShape({ TimeUnix: "1786017799669000000", ...companion })
      ).toBe(false);
    }
  });
});

// narrowAggregateRows is the inverse of narrowQueryRows: it forwards
// aggregate-shaped rows and surfaces an explicit error when a *raw* result is
// bound to an aggregate renderer by mistake.
describe("narrowAggregateRows", () => {
  it("forwards aggregate rows with no error", () => {
    const res = { data: [{ SpanName: "trpc.uploadLogo", avg_duration: 2090 }] };
    const out = narrowAggregateRows(res);
    expect(out.rows).toHaveLength(1);
    expect(out.error).toBeUndefined();
  });

  it("surfaces an error when a raw metric result reaches an aggregate renderer", () => {
    const res = {
      data: [{ TimeUnix: "1", Value: 1, Attributes: { a: "b" } }],
    };
    const out = narrowAggregateRows(res);
    expect(out.rows).toEqual([]);
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error?.message).toContain('mode: "aggregate"');
  });

  it("errors on a scalar-only raw result with no object-valued fields", () => {
    // A raw metric row whose attribute columns are absent is all-scalar, but
    // still matches the raw metric guard — it must not slip through as aggregate.
    const out = narrowAggregateRows({
      data: [{ TimeUnix: "1", MetricName: "m", Value: 1 }],
    });
    expect(out.rows).toEqual([]);
    expect(out.error).toBeInstanceOf(Error);
  });

  it("does NOT error on empty or null responses", () => {
    expect(narrowAggregateRows({ data: [] }).error).toBeUndefined();
    expect(narrowAggregateRows(null).error).toBeUndefined();
    expect(narrowAggregateRows({ data: undefined }).error).toBeUndefined();
  });
});
