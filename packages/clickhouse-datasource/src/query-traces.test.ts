import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildTraceSummariesQuery, buildTracesQuery } from "./query-traces.js";
import { buildLogsQuery } from "./query-logs.js";

// 2027-01-15 08:00:00 UTC; the default window starts 24 hours earlier.
const NOW = new Date("2027-01-15T08:00:00.000Z");
const DAY_AGO = "2027-01-14 08:00:00.000000000";

describe("default time window (KOP-216)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds trace summaries with no time range to the last 24 hours", () => {
    const { query, params } = buildTraceSummariesQuery({});
    expect(query).toContain("Timestamp >= {tsMin:DateTime64(9)}");
    expect(params.tsMin).toBe(DAY_AGO);
  });

  it("bounds trace summaries with only timestampMax to the 24 hours before it", () => {
    const max = String(BigInt(Date.parse("2027-01-10T00:00:00Z")) * 1_000_000n);
    const { params } = buildTraceSummariesQuery({ timestampMax: max });
    expect(params.tsMin).toBe("2027-01-09 00:00:00.000000000");
    expect(params.tsMax).toBe("2027-01-10 00:00:00.000000000");
  });

  it("keeps an explicit timestampMin on trace summaries", () => {
    const { params } = buildTraceSummariesQuery({ timestampMin: "0" });
    expect(params.tsMin).toBe("1970-01-01 00:00:00.000000000");
  });

  it("bounds span search with no time range to the last 24 hours", () => {
    const { query, params } = buildTracesQuery({});
    expect(query).toContain("Timestamp >= {tsMin:DateTime64(9)}");
    expect(params.tsMin).toBe(DAY_AGO);
  });

  it("leaves a span lookup by traceId unbounded", () => {
    const { query, params } = buildTracesQuery({ traceId: "abc" });
    expect(query).not.toContain("{tsMin:DateTime64(9)}");
    expect(params.tsMin).toBeUndefined();
  });

  it("bounds log search with no time range to the last 24 hours", () => {
    const { query, params } = buildLogsQuery({});
    expect(query).toContain("{tsMin:DateTime64(9)}");
    expect(params.tsMin).toBe(DAY_AGO);
  });

  it("leaves a log lookup by traceId unbounded", () => {
    const { query, params } = buildLogsQuery({ traceId: "abc" });
    expect(query).not.toContain("{tsMin:DateTime64(9)}");
    expect(params.tsMin).toBeUndefined();
  });
});

describe("buildTraceSummariesQuery span subquery", () => {
  it("adds no TraceId subquery when the only condition is the time range", () => {
    const { query } = buildTraceSummariesQuery({
      timestampMin: "1",
      timestampMax: "2",
    });
    expect(query).not.toContain("TraceId IN");
  });

  it("restricts to matching traces, within the time range, when a span filter is set", () => {
    const { query } = buildTraceSummariesQuery({
      serviceName: "api",
      timestampMin: "1",
    });
    expect(query).toContain(
      "TraceId IN (SELECT DISTINCT TraceId FROM otel_traces WHERE ServiceName = {serviceName:String} AND Timestamp >= {tsMin:DateTime64(9)})"
    );
  });
});

describe("buildTraceSummariesQuery", () => {
  it("does not use dateDiff with nanosecond unit", () => {
    const { query } = buildTraceSummariesQuery({});
    expect(query).not.toContain("dateDiff('nanosecond'");
  });

  it("does not use dateDiff with nanosecond unit when duration filters are set", () => {
    const { query } = buildTraceSummariesQuery({
      durationMin: "1000000",
      durationMax: "5000000000",
    });
    expect(query).not.toContain("dateDiff('nanosecond'");
  });

  it("computes durationNs in the SELECT clause", () => {
    const { query } = buildTraceSummariesQuery({});
    expect(query).toContain("durationNs");
  });

  it("applies durationMin as HAVING condition", () => {
    const { query, params } = buildTraceSummariesQuery({
      durationMin: "1000000",
    });
    expect(query).toContain("HAVING");
    expect(query).toContain("{durMin:UInt64}");
    expect(params.durMin).toBe("1000000");
  });

  it("applies durationMax as HAVING condition", () => {
    const { query, params } = buildTraceSummariesQuery({
      durationMax: "5000000000",
    });
    expect(query).toContain("HAVING");
    expect(query).toContain("{durMax:UInt64}");
    expect(params.durMax).toBe("5000000000");
  });
});
