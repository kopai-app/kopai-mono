import { describe, it, expect } from "vitest";
import {
  aggregatedLogSchema,
  timeseriesMetricSchema,
} from "./denormalized-signals-zod.js";
import type {
  ReadLogsDatasource,
  ReadMetricsDatasource,
} from "./telemetry-datasource.js";

describe("aggregatedLogSchema", () => {
  it("accepts single-key group with numeric value", () => {
    const result = aggregatedLogSchema.safeParse({
      groups: { tool_name: "Bash" },
      value: 1240,
    });
    expect(result.success).toBe(true);
  });

  it("accepts multi-key group", () => {
    const result = aggregatedLogSchema.safeParse({
      groups: { tool_name: "Bash", decision: "accept" },
      value: 99,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty groups (total count)", () => {
    const result = aggregatedLogSchema.safeParse({
      groups: {},
      value: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing groups", () => {
    const result = aggregatedLogSchema.safeParse({ value: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing value", () => {
    const result = aggregatedLogSchema.safeParse({ groups: { x: "y" } });
    expect(result.success).toBe(false);
  });
});

describe("ReadLogsDatasource interface", () => {
  it("declares getAggregatedLogs", () => {
    // Compile-time check: this assignment fails to type-check if
    // getAggregatedLogs is missing from the interface.
    const sentinel = (ds: ReadLogsDatasource) => ds.getAggregatedLogs;
    expect(typeof sentinel).toBe("function");
  });
});

describe("timeseriesMetricSchema", () => {
  it("accepts single-key group with stringified bigint bucket", () => {
    const result = timeseriesMetricSchema.safeParse({
      groups: { model: "opus" },
      timeBucketNs: "1700000000000000000",
      value: 12.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty groups (total over time)", () => {
    const result = timeseriesMetricSchema.safeParse({
      groups: {},
      timeBucketNs: "1700000000000000000",
      value: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing timeBucketNs", () => {
    const result = timeseriesMetricSchema.safeParse({
      groups: { model: "opus" },
      value: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects numeric timeBucketNs (must be stringified bigint)", () => {
    const result = timeseriesMetricSchema.safeParse({
      groups: { model: "opus" },
      timeBucketNs: 1700000000000000000,
      value: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing value", () => {
    const result = timeseriesMetricSchema.safeParse({
      groups: { model: "opus" },
      timeBucketNs: "1700000000000000000",
    });
    expect(result.success).toBe(false);
  });
});

describe("ReadMetricsDatasource interface", () => {
  it("declares getMetricsTimeSeries", () => {
    // Compile-time check: this assignment fails to type-check if
    // getMetricsTimeSeries is missing from the interface.
    const sentinel = (ds: ReadMetricsDatasource) => ds.getMetricsTimeSeries;
    expect(typeof sentinel).toBe("function");
  });
});
