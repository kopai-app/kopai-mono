import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  // Shared AST
  columnRefNodeSchema,
  exprNodeSchema,
  aggCallNodeSchema,
  orderBySchema,
  timeRangeSchema,
  // Traces
  tracesColumnNameSchema,
  tracesAggFnSchema,
  tracesKopaiQuerySchema,
  type TracesKopaiQuery,
  // Logs
  logsColumnNameSchema,
  logsAggFnSchema,
  logsKopaiQuerySchema,
  type LogsKopaiQuery,
  // Metrics
  metricsTypeSchema,
  metricsAggFnSchema,
  metricsKopaiQuerySchema,
  gaugeColumnNameSchema,
  sumColumnNameSchema,
  histogramColumnNameSchema,
  exponentialHistogramColumnNameSchema,
  summaryColumnNameSchema,
  type MetricsKopaiQuery,
} from "../index.js";

/**
 * Walk a Zod schema and collect every leaf field's description. Fails the
 * test on any leaf that is missing a `.describe()` string.
 */
function collectMissingDescriptions(
  schema: unknown,
  path: string[] = [],
  seen: Set<unknown> = new Set(),
  inheritedDescription = false
): string[] {
  const missing: string[] = [];
  if (schema == null || typeof schema !== "object") return missing;
  if (seen.has(schema)) return missing;
  seen.add(schema);

  const s = schema as {
    description?: string;
    shape?: Record<string, unknown>;
    options?: unknown[];
    _zod?: { def?: Record<string, unknown> };
  };

  const def = s._zod?.def as
    | {
        type?: string;
        innerType?: unknown;
        element?: unknown;
        valueType?: unknown;
        keyType?: unknown;
        options?: unknown[];
        shape?: Record<string, unknown>;
        getter?: () => unknown;
      }
    | undefined;
  const type = def?.type;

  // Wrapper types whose description should propagate to the inner leaf.
  const WRAPPER = new Set([
    "optional",
    "nullable",
    "default",
    "catch",
    "readonly",
    "nonoptional",
  ]);
  // Purely structural types that don't need a description themselves
  // because the parent context covers them.
  const STRUCTURAL = new Set([
    "object",
    "union",
    "discriminatedUnion",
    "intersection",
    "array",
    "tuple",
    "record",
    "map",
    "set",
    "pipe",
    "lazy",
    "branded",
    "nan",
    "promise",
    ...WRAPPER,
  ]);

  const hasDescription =
    inheritedDescription ||
    (typeof s.description === "string" && s.description.trim() !== "");

  if (type && !STRUCTURAL.has(type)) {
    // Leaf — must carry a non-empty description (own or inherited).
    if (!hasDescription) {
      missing.push(path.join(".") || "<root>");
    }
  }

  // Recurse. For wrapper types, propagate description downward so a
  // `z.number().optional().describe('…')` counts the inner number as
  // documented.
  const childInherited = WRAPPER.has(type ?? "") ? hasDescription : false;

  if (s.shape) {
    for (const [k, child] of Object.entries(s.shape)) {
      missing.push(
        ...collectMissingDescriptions(child, [...path, k], seen, false)
      );
    }
  }
  if (def?.shape) {
    for (const [k, child] of Object.entries(def.shape)) {
      missing.push(
        ...collectMissingDescriptions(child, [...path, k], seen, false)
      );
    }
  }
  if (def?.innerType) {
    missing.push(
      ...collectMissingDescriptions(def.innerType, path, seen, childInherited)
    );
  }
  if (def?.element) {
    missing.push(
      ...collectMissingDescriptions(def.element, [...path, "[]"], seen, false)
    );
  }
  if (def?.valueType) {
    missing.push(
      ...collectMissingDescriptions(
        def.valueType,
        [...path, "<v>"],
        seen,
        false
      )
    );
  }
  if (Array.isArray(def?.options)) {
    for (const [i, opt] of def!.options!.entries()) {
      missing.push(
        ...collectMissingDescriptions(opt, [...path, `|${i}`], seen, false)
      );
    }
  }
  if (Array.isArray(s.options)) {
    for (const [i, opt] of s.options.entries()) {
      missing.push(
        ...collectMissingDescriptions(opt, [...path, `|${i}`], seen, false)
      );
    }
  }

  return missing;
}

describe("kopai-query shared AST", () => {
  it("columnRefNodeSchema accepts a top-level column ref", () => {
    expect(columnRefNodeSchema.parse({ kind: "col", name: "spanId" })).toEqual({
      kind: "col",
      name: "spanId",
    });
  });

  it("columnRefNodeSchema accepts an attribute-map ref", () => {
    expect(
      columnRefNodeSchema.parse({
        kind: "attr",
        map: "spanAttributes",
        key: "http.route",
      })
    ).toEqual({ kind: "attr", map: "spanAttributes", key: "http.route" });
  });

  it("columnRefNodeSchema rejects an unknown attribute map", () => {
    const r = columnRefNodeSchema.safeParse({
      kind: "attr",
      map: "bogus",
      key: "x",
    });
    expect(r.success).toBe(false);
  });

  it("aggCallNodeSchema accepts count() with no col", () => {
    expect(aggCallNodeSchema.parse({ kind: "agg", fn: "count" })).toEqual({
      kind: "agg",
      fn: "count",
    });
  });

  it("aggCallNodeSchema accepts an agg with col + args", () => {
    expect(
      aggCallNodeSchema.parse({
        kind: "agg",
        fn: "p99",
        col: { kind: "col", name: "duration" },
        args: { n: 10 },
      })
    ).toBeTruthy();
  });

  it("exprNodeSchema parses a nested and/or/not tree", () => {
    const tree = {
      kind: "and",
      exprs: [
        { kind: "eq", col: { kind: "col", name: "serviceName" }, value: "api" },
        {
          kind: "or",
          exprs: [
            {
              kind: "gt",
              col: { kind: "col", name: "duration" },
              value: "1000",
            },
            { kind: "isNull", col: { kind: "col", name: "parentSpanId" } },
          ],
        },
        {
          kind: "not",
          expr: {
            kind: "in",
            col: { kind: "col", name: "statusCode" },
            values: ["ERROR", "UNSET"],
          },
        },
      ],
    };
    expect(exprNodeSchema.parse(tree)).toEqual(tree);
  });

  it("exprNodeSchema rejects an unknown operator kind", () => {
    const r = exprNodeSchema.safeParse({
      kind: "ZAP",
      col: { kind: "col", name: "x" },
      value: 1,
    });
    expect(r.success).toBe(false);
  });

  it("orderBySchema requires asc | desc", () => {
    expect(
      orderBySchema.parse({
        col: { kind: "col", name: "timestamp" },
        dir: "desc",
      })
    ).toBeTruthy();
    const r = orderBySchema.safeParse({
      col: { kind: "col", name: "timestamp" },
      dir: "sideways",
    });
    expect(r.success).toBe(false);
  });

  it("timeRangeSchema accepts nanosecond strings", () => {
    expect(
      timeRangeSchema.parse({
        start: "1700000000000000000",
        end: "1700000001000000000",
      })
    ).toBeTruthy();
  });
});

describe("tracesKopaiQuerySchema", () => {
  it("accepts a valid scalar select", () => {
    const q: TracesKopaiQuery = {
      signal: "traces",
      select: {
        id: { kind: "col", name: "traceId" },
        name: { kind: "col", name: "spanName" },
        route: { kind: "attr", map: "spanAttributes", key: "http.route" },
      },
      where: {
        kind: "eq",
        col: { kind: "col", name: "serviceName" },
        value: "api",
      },
      orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "desc" }],
      limit: 50,
      timeRange: { start: "1700000000000000000", end: "1700000001000000000" },
      cursor: "abc",
    };
    expect(tracesKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("accepts a valid aggregated select", () => {
    const q: TracesKopaiQuery = {
      signal: "traces",
      select: {
        p: {
          kind: "agg",
          fn: "p99",
          col: { kind: "col", name: "duration" },
        },
        c: { kind: "agg", fn: "count" },
      },
      groupBy: [{ kind: "col", name: "serviceName" }],
    };
    expect(tracesKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("rejects an unknown column name", () => {
    const r = tracesKopaiQuerySchema.safeParse({
      signal: "traces",
      select: { x: { kind: "col", name: "bogus" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.length).toBeGreaterThan(0);
      expect(
        r.error.issues.some((i) => i.path.join(".").includes("select"))
      ).toBe(true);
    }
  });

  it("rejects an agg fn from a wrong signal", () => {
    const r = tracesKopaiQuerySchema.safeParse({
      signal: "traces",
      select: {
        h: {
          kind: "agg",
          fn: "heatmap",
          col: { kind: "col", name: "duration" },
        },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects missing required field `signal`", () => {
    const r = tracesKopaiQuerySchema.safeParse({
      select: { id: { kind: "col", name: "traceId" } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects cursor + agg in select", () => {
    const r = tracesKopaiQuerySchema.safeParse({
      signal: "traces",
      cursor: "abc",
      select: {
        p: {
          kind: "agg",
          fn: "p99",
          col: { kind: "col", name: "duration" },
        },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.length).toBeGreaterThan(0);
      expect(r.error.issues.some((i) => i.path.includes("cursor"))).toBe(true);
    }
  });

  it("tracesColumnNameSchema enumerates camelCased trace columns", () => {
    expect(tracesColumnNameSchema.parse("spanId")).toBe("spanId");
    expect(tracesColumnNameSchema.parse("traceId")).toBe("traceId");
    expect(tracesColumnNameSchema.parse("duration")).toBe("duration");
    expect(tracesColumnNameSchema.parse("eventsAttributes")).toBe(
      "eventsAttributes"
    );
    expect(tracesColumnNameSchema.parse("linksTraceState")).toBe(
      "linksTraceState"
    );
    expect(tracesColumnNameSchema.safeParse("SpanId").success).toBe(false);
  });

  it("tracesAggFnSchema includes topN but not heatmap/rate*", () => {
    expect(tracesAggFnSchema.parse("topN")).toBe("topN");
    expect(tracesAggFnSchema.safeParse("heatmap").success).toBe(false);
    expect(tracesAggFnSchema.safeParse("rateAvg").success).toBe(false);
  });
});

describe("logsKopaiQuerySchema", () => {
  it("accepts a valid logs query", () => {
    const q: LogsKopaiQuery = {
      signal: "logs",
      select: {
        body: { kind: "col", name: "body" },
        sev: { kind: "col", name: "severityText" },
      },
      where: {
        kind: "like",
        col: { kind: "col", name: "body" },
        value: "%error%",
      },
      limit: 100,
    };
    expect(logsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("logsAggFnSchema excludes avg/sum/p* but includes topN", () => {
    expect(logsAggFnSchema.parse("count")).toBe("count");
    expect(logsAggFnSchema.parse("topN")).toBe("topN");
    expect(logsAggFnSchema.safeParse("avg").success).toBe(false);
    expect(logsAggFnSchema.safeParse("sum").success).toBe(false);
    expect(logsAggFnSchema.safeParse("p99").success).toBe(false);
  });

  it("rejects an agg fn from a wrong signal (avg)", () => {
    const r = logsKopaiQuerySchema.safeParse({
      signal: "logs",
      select: {
        a: {
          kind: "agg",
          fn: "avg",
          col: { kind: "col", name: "severityNumber" },
        },
      },
    });
    expect(r.success).toBe(false);
  });

  it("logsColumnNameSchema accepts logs columns and rejects traces-only ones", () => {
    expect(logsColumnNameSchema.parse("body")).toBe("body");
    expect(logsColumnNameSchema.parse("severityNumber")).toBe("severityNumber");
    expect(logsColumnNameSchema.safeParse("duration").success).toBe(false);
  });

  it("rejects cursor + agg in select", () => {
    const r = logsKopaiQuerySchema.safeParse({
      signal: "logs",
      cursor: "x",
      select: {
        c: { kind: "agg", fn: "count" },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("cursor"))).toBe(true);
    }
  });
});

describe("metricsKopaiQuerySchema", () => {
  it("metricsTypeSchema enumerates 5 metric types", () => {
    for (const t of [
      "gauge",
      "sum",
      "histogram",
      "exponentialHistogram",
      "summary",
    ] as const) {
      expect(metricsTypeSchema.parse(t)).toBe(t);
    }
    expect(metricsTypeSchema.safeParse("Gauge").success).toBe(false);
  });

  it("metricsAggFnSchema excludes count/countDistinct, includes heatmap and rate*", () => {
    expect(metricsAggFnSchema.parse("heatmap")).toBe("heatmap");
    expect(metricsAggFnSchema.parse("rateAvg")).toBe("rateAvg");
    expect(metricsAggFnSchema.safeParse("count").success).toBe(false);
    expect(metricsAggFnSchema.safeParse("countDistinct").success).toBe(false);
  });

  it("accepts a gauge query", () => {
    const q: MetricsKopaiQuery = {
      signal: "metrics",
      metricType: "gauge",
      select: {
        v: { kind: "col", name: "value" },
        s: { kind: "agg", fn: "sum", col: { kind: "col", name: "value" } },
      },
    };
    expect(metricsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("accepts a sum query", () => {
    const q: MetricsKopaiQuery = {
      signal: "metrics",
      metricType: "sum",
      select: {
        v: { kind: "col", name: "value" },
        ag: { kind: "col", name: "aggregationTemporality" },
      },
    };
    expect(metricsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("accepts a histogram query", () => {
    const q: MetricsKopaiQuery = {
      signal: "metrics",
      metricType: "histogram",
      select: {
        c: { kind: "col", name: "count" },
        s: { kind: "col", name: "sum" },
        b: { kind: "col", name: "bucketCounts" },
      },
    };
    expect(metricsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("accepts an exponentialHistogram query", () => {
    const q: MetricsKopaiQuery = {
      signal: "metrics",
      metricType: "exponentialHistogram",
      select: {
        sc: { kind: "col", name: "scale" },
        zc: { kind: "col", name: "zeroCount" },
      },
    };
    expect(metricsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("accepts a summary query", () => {
    const q: MetricsKopaiQuery = {
      signal: "metrics",
      metricType: "summary",
      select: {
        c: { kind: "col", name: "count" },
        q: { kind: "col", name: "valueAtQuantilesQuantile" },
      },
    };
    expect(metricsKopaiQuerySchema.parse(q)).toBeTruthy();
  });

  it("rejects an unknown column for the given metric type", () => {
    const r = metricsKopaiQuerySchema.safeParse({
      signal: "metrics",
      metricType: "gauge",
      // `bucketCounts` belongs to histogram, not gauge.
      select: { b: { kind: "col", name: "bucketCounts" } },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects an agg fn from wrong signal (count is not in metrics)", () => {
    const r = metricsKopaiQuerySchema.safeParse({
      signal: "metrics",
      metricType: "gauge",
      select: { c: { kind: "agg", fn: "count" } },
    });
    expect(r.success).toBe(false);
  });

  it("rejects cursor + agg in select", () => {
    const r = metricsKopaiQuerySchema.safeParse({
      signal: "metrics",
      metricType: "gauge",
      cursor: "x",
      select: {
        s: { kind: "agg", fn: "sum", col: { kind: "col", name: "value" } },
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("cursor"))).toBe(true);
    }
  });

  it("per-metric-type column-name schemas accept expected columns", () => {
    expect(gaugeColumnNameSchema.parse("value")).toBe("value");
    expect(sumColumnNameSchema.parse("isMonotonic")).toBe("isMonotonic");
    expect(histogramColumnNameSchema.parse("bucketCounts")).toBe(
      "bucketCounts"
    );
    expect(
      exponentialHistogramColumnNameSchema.parse("positiveBucketCounts")
    ).toBe("positiveBucketCounts");
    expect(summaryColumnNameSchema.parse("valueAtQuantilesValue")).toBe(
      "valueAtQuantilesValue"
    );
  });
});

describe(".describe() coverage", () => {
  const schemas: Array<[string, z.ZodType]> = [
    ["columnRefNodeSchema", columnRefNodeSchema],
    ["aggCallNodeSchema", aggCallNodeSchema],
    ["exprNodeSchema", exprNodeSchema],
    ["orderBySchema", orderBySchema],
    ["timeRangeSchema", timeRangeSchema],
    ["tracesKopaiQuerySchema", tracesKopaiQuerySchema],
    ["logsKopaiQuerySchema", logsKopaiQuerySchema],
    ["metricsKopaiQuerySchema", metricsKopaiQuerySchema],
  ];

  for (const [name, schema] of schemas) {
    it(`every leaf field in ${name} has a non-empty .describe()`, () => {
      const missing = collectMissingDescriptions(schema);
      expect(missing, `Missing .describe() at: ${missing.join(", ")}`).toEqual(
        []
      );
    });
  }
});
