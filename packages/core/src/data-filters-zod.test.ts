import { describe, it, expect } from "vitest";
import {
  logsDataFilterSchema,
  metricsDataFilterSchema,
} from "./data-filters-zod.js";

describe("logsDataFilterSchema", () => {
  it("accepts a basic filter without aggregate", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
    });
    expect(result.success).toBe(true);
  });

  it("accepts aggregate: 'count' alone", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "count",
    });
    expect(result.success).toBe(true);
  });

  it("accepts aggregate + groupBy", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects groupBy without aggregate", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      groupBy: ["tool_name"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/aggregate/);
    }
  });

  it("rejects empty groupBy with aggregate", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/non-empty/);
    }
  });

  it("rejects aggregate + cursor combination", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "count",
      cursor: "abc",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/cursor/);
    }
  });

  it("rejects non-'count' aggregate values", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "sum",
    });
    expect(result.success).toBe(false);
  });

  it("allows limit alongside aggregate", () => {
    const result = logsDataFilterSchema.safeParse({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
      limit: 50,
    });
    expect(result.success).toBe(true);
  });
});

describe("metricsDataFilterSchema timeBucket refinements", () => {
  it("accepts aggregate + groupBy without timeBucket (existing path)", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: ["model"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts aggregate + groupBy + timeBucket", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: ["model"],
      timeBucket: "1d",
    });
    expect(result.success).toBe(true);
  });

  it("rejects timeBucket without aggregate or groupBy", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      timeBucket: "1d",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/aggregate|groupBy/);
    }
  });

  it("rejects timeBucket without groupBy", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      timeBucket: "1d",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/groupBy/);
    }
  });

  it("rejects invalid timeBucket enum value", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: ["model"],
      timeBucket: "30s",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty groupBy with aggregate (no timeBucket)", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/non-empty/);
    }
  });

  it("rejects empty groupBy with aggregate + timeBucket", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: [],
      timeBucket: "1d",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/non-empty/);
    }
  });

  it("rejects timeBucket + cursor combination", () => {
    const result = metricsDataFilterSchema.safeParse({
      metricType: "Sum",
      metricName: "x",
      aggregate: "sum",
      groupBy: ["model"],
      timeBucket: "1d",
      cursor: "abc",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = JSON.stringify(result.error.issues);
      expect(flat).toMatch(/cursor/);
    }
  });
});
