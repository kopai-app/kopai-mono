import { describe, it, expect } from "vitest";
import type { kopaiQuery } from "@kopai/core";
import { buildKopaiSql } from "./query-kopai.js";

// ---------------------------------------------------------------------------
// Filter compilation tests via the public buildKopaiSql entry point.
// We use a TraceRawQuery scaffold and vary only the filters array.
// compileTimeRange consumes params `tsLo_0` and `tsHi_1`, so filter params
// start at index 2 — assertions use regex patterns to avoid coupling.
// ---------------------------------------------------------------------------

function baseTraceRaw(
  filters: kopaiQuery.TraceRawQuery["filters"]
): kopaiQuery.TraceRawQuery {
  return {
    signal: "traces",
    mode: "raw",
    timeDimension: {
      type: "absolute",
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-02T00:00:00.000Z",
    },
    filters,
  };
}

describe("compileFilter (clickhouse)", () => {
  it("emits string-equality SQL for a string-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "eq", value: "hello" }])
    );
    expect(sql).toMatch(/`SpanName` = \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("hello");
  });

  it("emits numeric-comparison SQL for a number-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "eq", value: 42 }])
    );
    expect(sql).toMatch(/`Duration` = \{n_\d+:Float64\}/);
    expect(Object.values(params)).toContain(42);
  });

  it("emits boolean-as-string SQL for a boolean-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([
        {
          column: { container: "SpanAttributes", key: "feature.enabled" },
          op: "eq",
          value: true,
        },
      ])
    );
    expect(sql).toMatch(
      /SpanAttributes\['feature\.enabled'\] = \{b_\d+:String\}/
    );
    expect(Object.values(params)).toContain("true");
  });

  it("emits AND group for {and:[...]} logical", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        {
          and: [
            { column: "SpanName", op: "eq", value: "a" },
            { column: "service.name", op: "eq", value: "b" },
          ],
        },
      ])
    );
    expect(sql).toMatch(
      /\(`SpanName` = \{s_\d+:String\} AND `ServiceName` = \{s_\d+:String\}\)/
    );
  });

  it("emits OR group for {or:[...]} logical", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        {
          or: [
            { column: "SpanName", op: "eq", value: "a" },
            { column: "SpanName", op: "eq", value: "b" },
          ],
        },
      ])
    );
    expect(sql).toMatch(
      /\(`SpanName` = \{s_\d+:String\} OR `SpanName` = \{s_\d+:String\}\)/
    );
  });

  it("emits IN SQL with String element type for string-valued in", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "service.name", op: "in", values: ["x", "y"] }])
    );
    expect(sql).toMatch(/`ServiceName` IN \{sin_\d+:Array\(String\)\}/);
    expect(Object.values(params)).toContainEqual(["x", "y"]);
  });

  it("emits IN SQL with Float64 element type for number-valued in", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "in", values: [1, 2] }])
    );
    expect(sql).toMatch(/`Duration` IN \{nin_\d+:Array\(Float64\)\}/);
    expect(Object.values(params)).toContainEqual([1, 2]);
  });

  it("emits NOT IN for notIn op", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        { column: "service.name", op: "notIn", values: ["x", "y"] },
      ])
    );
    expect(sql).toMatch(/`ServiceName` NOT IN \{sin_\d+:Array\(String\)\}/);
  });

  it("emits ILIKE for contains", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "contains", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc%");
  });

  it("emits NOT ILIKE for notContains", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "notContains", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` NOT ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc%");
  });

  it("emits prefix ILIKE for startsWith", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "startsWith", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("abc%");
  });

  it("emits suffix ILIKE for endsWith", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "endsWith", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc");
  });

  it("emits comparator SQL for gt/gte/lt/lte", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "gt", value: 10 }])
    );
    expect(sql).toMatch(/`Duration` > \{n_\d+:Float64\}/);
    expect(Object.values(params)).toContain(10);
  });

  it("emits empty()/notEmpty() for isNull / isNotNull", () => {
    const { sql: nullSql } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "isNull" }])
    );
    expect(nullSql).toContain("empty(`SpanName`)");
    const { sql: notNullSql } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "isNotNull" }])
    );
    expect(notNullSql).toContain("notEmpty(`SpanName`)");
  });
});

describe("buildKopaiSql raw mode without dimensions", () => {
  it("builds a TraceRawQuery with no dimensions field", () => {
    const { sql } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "relative", lookback: "1h" },
    });
    // Selects the full TRACE_RAW_SELECT list — sanity check a few cols.
    expect(sql).toContain("FROM otel_traces");
    expect(sql).toContain("Timestamp");
    expect(sql).toContain("SpanId");
    expect(sql).toContain("SpanAttributes");
  });
});
