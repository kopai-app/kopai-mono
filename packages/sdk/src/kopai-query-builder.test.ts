import { describe, it, expect, expectTypeOf } from "vitest";
import { kopaiQuery } from "@kopai/core";
import { kq, KopaiQueryBuildError } from "./kopai-query-builder.js";

// ============================================================
// Sanity (type-test plumbing)
// ============================================================
describe("type-test plumbing sanity", () => {
  it("expectTypeOf is wired", () => {
    expectTypeOf<string>().toEqualTypeOf<string>();
    // @ts-expect-error number not assignable to string
    const _x: string = 42;
    void _x;
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: build return-type equality (6 cases)
// ============================================================
describe("build return-type equality", () => {
  it("traces.aggregate -> TraceAggregateQuery", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.TraceAggregateQuery>();
  });

  it("traces.raw -> TraceRawQuery", () => {
    const q = kq.traces.raw().dimension("SpanId").timeRelative("1h").build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.TraceRawQuery>();
  });

  it("logs.aggregate -> LogAggregateQuery", () => {
    const q = kq.logs
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.LogAggregateQuery>();
  });

  it("logs.raw -> LogRawQuery", () => {
    const q = kq.logs.raw().dimension("Body").timeRelative("1h").build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.LogRawQuery>();
  });

  it("metrics.aggregate -> MetricAggregateQuery", () => {
    const q = kq.metrics
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.MetricAggregateQuery>();
  });

  it("metrics.raw -> MetricRawQuery", () => {
    const q = kq.metrics
      .raw()
      .dimension("MetricName")
      .timeRelative("1h")
      .build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.MetricRawQuery>();
  });
});

// ============================================================
// Type-only: premature .build() rejection
//
// Negative-type cases live inside `if (false)` blocks so tsc still
// checks them but vitest never executes them. `expect(true)` keeps
// vitest happy that the test ran.
// ============================================================
describe("premature build rejection (aggregate)", () => {
  it("rejects every missing-required-field combination", () => {
    if (false as boolean) {
      const b1 = kq.traces.aggregate().timeRelative("1h").summary();
      // @ts-expect-error missing measure
      b1.build();

      const b2 = kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .summary();
      // @ts-expect-error missing timeDimension
      b2.build();

      const b3 = kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h");
      // @ts-expect-error missing output
      b3.build();

      const b4 = kq.traces.aggregate().measure((m) => m.count("c"));
      // @ts-expect-error missing timeDimension + output
      b4.build();

      const b5 = kq.traces.aggregate().timeRelative("1h");
      // @ts-expect-error missing measure + output
      b5.build();

      const b6 = kq.traces.aggregate().summary();
      // @ts-expect-error missing measure + timeDimension
      b6.build();

      const b7 = kq.traces.aggregate();
      // @ts-expect-error missing everything
      b7.build();
    }
    expect(true).toBe(true);
  });
});

describe("premature build rejection (raw)", () => {
  it("rejects every missing-required-field combination", () => {
    if (false as boolean) {
      const b1 = kq.traces.raw().timeRelative("1h");
      // @ts-expect-error missing dimensions
      b1.build();

      const b2 = kq.traces.raw().dimension("SpanId");
      // @ts-expect-error missing timeDimension
      b2.build();

      const b3 = kq.traces.raw();
      // @ts-expect-error missing dimensions + timeDimension
      b3.build();
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: cross-signal measure rejection
// ============================================================
describe("cross-signal measure rejection", () => {
  it("logs/metrics cannot use trace-only measures", () => {
    if (false as boolean) {
      kq.logs
        .aggregate()
        // @ts-expect-error errorRate trace-only
        .measure((m) => m.errorRate("er"));
      kq.logs
        .aggregate()
        // @ts-expect-error throughput trace-only
        .measure((m) => m.throughput("tp"));
      kq.metrics
        .aggregate()
        // @ts-expect-error errorRate trace-only
        .measure((m) => m.errorRate("er"));
      kq.metrics
        .aggregate()
        // @ts-expect-error throughput trace-only
        .measure((m) => m.throughput("tp"));
    }
    expect(true).toBe(true);
  });

  it("traces CAN use errorRate", () => {
    kq.traces.aggregate().measure((m) => m.errorRate("er"));
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: cursor exclusivity
// ============================================================
describe("cursor exclusivity", () => {
  it("raw exposes cursor / aggregate does not", () => {
    kq.traces.raw().cursor("abc");
    if (false as boolean) {
      // @ts-expect-error cursor not on aggregate
      kq.traces.aggregate().cursor("abc");
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: unknown column rejection
// ============================================================
describe("unknown column rejection", () => {
  it("rejects unknown / cross-signal columns", () => {
    if (false as boolean) {
      // @ts-expect-error not a known column
      kq.traces.aggregate().dimension("not_a_real_column");
      // @ts-expect-error MetricUnit is metrics-only
      kq.traces.aggregate().dimension("MetricUnit");
      // @ts-expect-error SpanKind is traces-only
      kq.metrics.aggregate().dimension("SpanKind");
    }
    expect(true).toBe(true);
  });

  it("accepts attr-ref object", () => {
    kq.traces
      .aggregate()
      .dimension({ container: "SpanAttributes", key: "foo.bar" });
    expect(true).toBe(true);
  });

  it("rejects cross-signal columns inside where()", () => {
    if (false as boolean) {
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error SeverityNumber is logs-only
        f.eq("SeverityNumber", 5)
      );
      kq.logs.aggregate().where((f) =>
        // @ts-expect-error Duration is traces-only
        f.gt("Duration", 100)
      );
      kq.metrics.aggregate().where((f) =>
        // @ts-expect-error SpanKind is traces-only
        f.eq("SpanKind", "SPAN_KIND_SERVER")
      );
    }
    expect(true).toBe(true);
  });

  it("rejects cross-signal attr container on attr()", () => {
    if (false as boolean) {
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error LogAttributes is logs-only
        f.attr("LogAttributes", "k").eq("v")
      );
      kq.logs.aggregate().where((f) =>
        // @ts-expect-error SpanAttributes is traces-only
        f.attr("SpanAttributes", "k").eq("v")
      );
      kq.metrics.aggregate().where((f) =>
        // @ts-expect-error SpanAttributes is traces-only
        f.attr("SpanAttributes", "k").eq("v")
      );
    }
    expect(true).toBe(true);
  });

  it("rejects cross-signal attr-ref via dimension()", () => {
    if (false as boolean) {
      // @ts-expect-error LogAttributes is logs-only
      kq.traces.aggregate().dimension({ container: "LogAttributes", key: "k" });
      // @ts-expect-error SpanAttributes is traces-only
      kq.logs.aggregate().dimension({ container: "SpanAttributes", key: "k" });
      kq.metrics
        .aggregate()
        // @ts-expect-error LogAttributes is logs-only
        .dimension({ container: "LogAttributes", key: "k" });
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Type-only: filter eq overload discriminant
// ============================================================
describe("filter eq overload discriminant", () => {
  it("string value -> kind:string", () => {
    kq.traces.aggregate().where((f) => {
      const r = f.eq("SpanName", "GET /");
      expectTypeOf(r.kind).toEqualTypeOf<"string">();
      return r;
    });
  });

  it("number value -> kind:number", () => {
    kq.traces.aggregate().where((f) => {
      const r = f.eq("Duration", 42);
      expectTypeOf(r.kind).toEqualTypeOf<"number">();
      return r;
    });
  });

  it("boolean value -> kind:boolean", () => {
    kq.metrics.aggregate().where((f) => {
      const r = f.eq("IsMonotonic", true);
      expectTypeOf(r.kind).toEqualTypeOf<"boolean">();
      return r;
    });
  });
});

// ============================================================
// Type-only: attr().eq/neq discriminant parity with f.eq/neq
// ============================================================
describe("attr().eq/neq discriminant", () => {
  it("attr().eq narrows kind by value type", () => {
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").eq("v");
      expectTypeOf(r.kind).toEqualTypeOf<"string">();
      return r;
    });
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").eq(1);
      expectTypeOf(r.kind).toEqualTypeOf<"number">();
      return r;
    });
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").eq(true);
      expectTypeOf(r.kind).toEqualTypeOf<"boolean">();
      return r;
    });
  });

  it("attr().neq narrows kind by value type", () => {
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").neq("v");
      expectTypeOf(r.kind).toEqualTypeOf<"string">();
      return r;
    });
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").neq(1);
      expectTypeOf(r.kind).toEqualTypeOf<"number">();
      return r;
    });
    kq.traces.aggregate().where((f) => {
      const r = f.attr("SpanAttributes", "k").neq(true);
      expectTypeOf(r.kind).toEqualTypeOf<"boolean">();
      return r;
    });
  });
});

// ============================================================
// Type-only: immutability — forked branches narrow independently
// ============================================================
describe("immutability type independence", () => {
  it("forks have independent narrowed types", () => {
    if (false as boolean) {
      const base = kq.traces.aggregate();
      const a = base.measure((m) => m.count("c"));
      const b = base.timeRelative("1h");
      // @ts-expect-error a missing time + output
      a.build();
      // @ts-expect-error b missing measures + output
      b.build();
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Runtime: happy paths (each variant minimum-valid)
// ============================================================
describe("runtime: happy paths — minimum-valid per variant", () => {
  it("traces.aggregate minimum-valid", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("traces.raw minimum-valid", () => {
    const q = kq.traces.raw().dimension("SpanId").timeRelative("1h").build();
    expect(q).toEqual({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId"],
      timeDimension: { type: "relative", lookback: "1h" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("logs.aggregate minimum-valid", () => {
    const q = kq.logs
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "logs",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("logs.raw minimum-valid", () => {
    const q = kq.logs.raw().dimension("Body").timeRelative("1h").build();
    expect(q).toEqual({
      signal: "logs",
      mode: "raw",
      dimensions: ["Body"],
      timeDimension: { type: "relative", lookback: "1h" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics.aggregate minimum-valid", () => {
    const q = kq.metrics
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics.raw minimum-valid", () => {
    const q = kq.metrics
      .raw()
      .dimension("MetricName")
      .timeRelative("1h")
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName"],
      timeDimension: { type: "relative", lookback: "1h" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: all-features aggregate per signal
// ============================================================
describe("runtime: all-features aggregate", () => {
  it("traces with everything", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("requests"))
      .measure((m) => m.errorRate("error_rate"))
      .measure((m) => m.p95("Duration", "p95_dur"))
      .dimension("service.name")
      .dimension({ container: "SpanAttributes", key: "custom.tag" })
      .where((f) => f.eq("SpanKind", "SPAN_KIND_SERVER"))
      .where((f) => f.gt("Duration", 100))
      .having("requests", "gt", 0)
      .orderByMeasure("p95_dur", "desc")
      .orderByDimension("service.name", "asc")
      .timeRelative("2h", "7d")
      .timeSeries("5m")
      .limit(100)
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "requests" },
        { op: "ERROR_RATE", as: "error_rate" },
        { op: "P95", column: "Duration", as: "p95_dur" },
      ],
      dimensions: [
        "service.name",
        { container: "SpanAttributes", key: "custom.tag" },
      ],
      filters: [
        {
          kind: "string",
          column: "SpanKind",
          op: "eq",
          value: "SPAN_KIND_SERVER",
        },
        { kind: "number", column: "Duration", op: "gt", value: 100 },
      ],
      havings: [{ measure: "requests", op: "gt", value: 0 }],
      orderBy: [
        { type: "measure", alias: "p95_dur", direction: "desc" },
        { type: "dimension", column: "service.name", direction: "asc" },
      ],
      timeDimension: {
        type: "relative",
        lookback: "2h",
        compareOffset: "7d",
      },
      output: { type: "timeSeries", granularity: "5m" },
      limit: 100,
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("logs with all features", () => {
    const q = kq.logs
      .aggregate()
      .measure((m) => m.count("c"))
      .dimension("log.level")
      .where((f) => f.contains("Body", "error"))
      .timeAbsolute("2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "logs",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      dimensions: ["log.level"],
      filters: [
        { kind: "string", column: "Body", op: "contains", value: "error" },
      ],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-02T00:00:00Z",
      },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics with all features", () => {
    const q = kq.metrics
      .aggregate()
      .measure((m) => m.avg("Value", "avg_v"))
      .dimension("MetricName")
      .where((f) => f.eq("MetricType", "Gauge"))
      .timeRelative("30m")
      .timeSeries("1m")
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "AVG", column: "Value", as: "avg_v" }],
      dimensions: ["MetricName"],
      filters: [
        { kind: "string", column: "MetricType", op: "eq", value: "Gauge" },
      ],
      timeDimension: { type: "relative", lookback: "30m" },
      output: { type: "timeSeries", granularity: "1m" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: raw with cursor + limit + orderBy
// ============================================================
describe("runtime: raw with cursor + limit + orderBy", () => {
  it("traces.raw paginated", () => {
    const q = kq.traces
      .raw()
      .dimension("SpanId")
      .dimension("Duration")
      .where((f) => f.gte("Duration", 1000))
      .orderByDimension("Duration", "desc")
      .timeRelative("1h")
      .limit(50)
      .cursor("opaque-token")
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId", "Duration"],
      filters: [{ kind: "number", column: "Duration", op: "gte", value: 1000 }],
      orderBy: [{ type: "dimension", column: "Duration", direction: "desc" }],
      timeDimension: { type: "relative", lookback: "1h" },
      limit: 50,
      cursor: "opaque-token",
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: filter coverage (each kind)
// ============================================================
describe("runtime: filter coverage", () => {
  it("string filter (eq)", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.eq("SpanName", "GET /"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        { kind: "string", column: "SpanName", op: "eq", value: "GET /" },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("stringIn filter", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.in("SpanKind", ["SPAN_KIND_SERVER", "SPAN_KIND_CLIENT"]))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          kind: "stringIn",
          column: "SpanKind",
          op: "in",
          values: ["SPAN_KIND_SERVER", "SPAN_KIND_CLIENT"],
        },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("number filter (gt)", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.gt("Duration", 500))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [{ kind: "number", column: "Duration", op: "gt", value: 500 }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("numberIn filter", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.in("Duration", [1, 2, 3]))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          kind: "numberIn",
          column: "Duration",
          op: "in",
          values: [1, 2, 3],
        },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("boolean filter", () => {
    const q = kq.metrics
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.eq("IsMonotonic", true))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        { kind: "boolean", column: "IsMonotonic", op: "eq", value: true },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("null filter", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.isNull("ParentSpanId"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [{ kind: "null", column: "ParentSpanId", op: "isNull" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("logical filter (3 levels deep)", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) =>
        f.and(
          f.or(
            f.and(f.eq("SpanKind", "SPAN_KIND_SERVER"), f.gt("Duration", 100)),
            f.eq("StatusCode", "STATUS_CODE_ERROR")
          ),
          f.isNotNull("TraceId")
        )
      )
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          kind: "logical",
          op: "and",
          filters: [
            {
              kind: "logical",
              op: "or",
              filters: [
                {
                  kind: "logical",
                  op: "and",
                  filters: [
                    {
                      kind: "string",
                      column: "SpanKind",
                      op: "eq",
                      value: "SPAN_KIND_SERVER",
                    },
                    {
                      kind: "number",
                      column: "Duration",
                      op: "gt",
                      value: 100,
                    },
                  ],
                },
                {
                  kind: "string",
                  column: "StatusCode",
                  op: "eq",
                  value: "STATUS_CODE_ERROR",
                },
              ],
            },
            { kind: "null", column: "TraceId", op: "isNotNull" },
          ],
        },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("attr-ref via explicit attr()", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.attr("SpanAttributes", "custom.flag").eq(true))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          kind: "boolean",
          column: { container: "SpanAttributes", key: "custom.flag" },
          op: "eq",
          value: true,
        },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: column auto-resolve
// ============================================================
describe("runtime: column auto-resolve", () => {
  it("structural string stays string", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .dimension("SpanId")
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      dimensions: ["SpanId"],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("semconv string stays string", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .dimension("service.name")
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      dimensions: ["service.name"],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("explicit attr-ref passes through", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .dimension({ container: "SpanAttributes", key: "anything" })
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      dimensions: [{ container: "SpanAttributes", key: "anything" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: measure coverage
// ============================================================
describe("runtime: measure ops per signal", () => {
  it("traces: count/countDistinct/avg/sum/min/max/percentiles/rate", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .measure((m) => m.countDistinct("SpanId", "u"))
      .measure((m) => m.sum("Duration", "s"))
      .measure((m) => m.avg("Duration", "a"))
      .measure((m) => m.min("Duration", "mn"))
      .measure((m) => m.max("Duration", "mx"))
      .measure((m) => m.p50("Duration", "p50"))
      .measure((m) => m.p75("Duration", "p75"))
      .measure((m) => m.p90("Duration", "p90"))
      .measure((m) => m.p95("Duration", "p95"))
      .measure((m) => m.p99("Duration", "p99"))
      .measure((m) => m.p999("Duration", "p999"))
      .measure((m) => m.rateAvg("Duration", "ra"))
      .measure((m) => m.rateSum("Duration", "rs"))
      .measure((m) => m.rateMax("Duration", "rm"))
      .measure((m) => m.errorRate("er"))
      .measure((m) => m.throughput("tp"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "c" },
        { op: "COUNT_DISTINCT", column: "SpanId", as: "u" },
        { op: "SUM", column: "Duration", as: "s" },
        { op: "AVG", column: "Duration", as: "a" },
        { op: "MIN", column: "Duration", as: "mn" },
        { op: "MAX", column: "Duration", as: "mx" },
        { op: "P50", column: "Duration", as: "p50" },
        { op: "P75", column: "Duration", as: "p75" },
        { op: "P90", column: "Duration", as: "p90" },
        { op: "P95", column: "Duration", as: "p95" },
        { op: "P99", column: "Duration", as: "p99" },
        { op: "P999", column: "Duration", as: "p999" },
        { op: "RATE_AVG", column: "Duration", as: "ra" },
        { op: "RATE_SUM", column: "Duration", as: "rs" },
        { op: "RATE_MAX", column: "Duration", as: "rm" },
        { op: "ERROR_RATE", as: "er" },
        { op: "THROUGHPUT", as: "tp" },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("logs: no errorRate/throughput", () => {
    const q = kq.logs
      .aggregate()
      .measure((m) => m.count("c"))
      .measure((m) => m.countDistinct("Body", "u"))
      .measure((m) => m.avg("SeverityNumber", "a"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "logs",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "c" },
        { op: "COUNT_DISTINCT", column: "Body", as: "u" },
        { op: "AVG", column: "SeverityNumber", as: "a" },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics: numeric ops", () => {
    const q = kq.metrics
      .aggregate()
      .measure((m) => m.count("c"))
      .measure((m) => m.sum("Value", "s"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "c" },
        { op: "SUM", column: "Value", as: "s" },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: time + output combos
// ============================================================
describe("runtime: time + output", () => {
  it("relative no compareOffset", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("relative with compareOffset", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h", "7d")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: {
        type: "relative",
        lookback: "1h",
        compareOffset: "7d",
      },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("absolute no compareOffset", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeAbsolute("2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-02T00:00:00Z",
      },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("absolute with compareOffset", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeAbsolute("2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", "7d")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00Z",
        endTime: "2024-01-02T00:00:00Z",
        compareOffset: "7d",
      },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("timeSeries with granularity", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .timeSeries("5m")
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "timeSeries", granularity: "5m" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: validation errors
// ============================================================
describe("runtime: validation errors", () => {
  it("invalid duration -> KopaiQueryBuildError with timeDimension.lookback path", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("bad_duration")
        .summary()
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    const e = err as KopaiQueryBuildError;
    expect(e.name).toBe("KopaiQueryBuildError");
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.issues.some((i) => i.path.includes("lookback"))).toBe(true);
    expect(e.message).toContain("Failed to build KopaiQuery");
    expect(e.message.split("\n").length).toBeGreaterThan(1);
  });

  it("invalid ISO -> path includes startTime", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeAbsolute("not-an-iso", "2024-01-02T00:00:00Z")
        .summary()
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(
      (err as KopaiQueryBuildError).issues.some((i) =>
        i.path.includes("startTime")
      )
    ).toBe(true);
  });

  it("invalid granularity -> path includes granularity", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h")
        .timeSeries("bad_granularity")
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(
      (err as KopaiQueryBuildError).issues.some((i) =>
        i.path.includes("granularity")
      )
    ).toBe(true);
  });

  it("empty .in([]) -> validation error on values", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .where((f) => f.in("SpanKind", [] as string[]))
        .timeRelative("1h")
        .summary()
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(
      (err as KopaiQueryBuildError).issues.some((i) =>
        i.path.includes("values")
      )
    ).toBe(true);
  });

  it("limit(0) -> validation error on limit", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h")
        .summary()
        .limit(0)
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(
      (err as KopaiQueryBuildError).issues.some((i) => i.path.includes("limit"))
    ).toBe(true);
  });

  it("limit(10001) -> validation error on limit", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h")
        .summary()
        .limit(10_001)
        .build();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(
      (err as KopaiQueryBuildError).issues.some((i) => i.path.includes("limit"))
    ).toBe(true);
  });

  it("limit(1) and limit(10000) build successfully", () => {
    expect(() =>
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h")
        .summary()
        .limit(1)
        .build()
    ).not.toThrow();
    expect(() =>
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("1h")
        .summary()
        .limit(10_000)
        .build()
    ).not.toThrow();
  });

  it("KopaiQueryBuildError shape", () => {
    let err: unknown;
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .timeRelative("xx")
        .summary()
        .build();
    } catch (e) {
      err = e;
    }
    const e = err as KopaiQueryBuildError;
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(KopaiQueryBuildError);
    expect(e.name).toBe("KopaiQueryBuildError");
    expect(Array.isArray(e.issues)).toBe(true);
    e.issues.forEach((i) => {
      expect(typeof i.path).toBe("string");
      expect(typeof i.message).toBe("string");
    });
  });
});

// ============================================================
// Runtime: immutability
// ============================================================
describe("runtime: immutability", () => {
  it("forks do not mutate base", () => {
    const base = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary();
    const q1 = base.limit(10).build();
    const q2 = base.limit(20).build();
    expect(q1).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
      limit: 10,
    });
    expect(kopaiQuery.KopaiQuery.parse(q1)).toEqual(q1);
    expect(q2).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
      limit: 20,
    });
    expect(kopaiQuery.KopaiQuery.parse(q2)).toEqual(q2);
    // base unaffected
    const qBase = base.build();
    expect(qBase).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(qBase)).toEqual(qBase);
  });

  it("multiple .where calls combine via top-level AND (array)", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.eq("SpanKind", "SPAN_KIND_SERVER"))
      .where((f) => f.gt("Duration", 100))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          kind: "string",
          column: "SpanKind",
          op: "eq",
          value: "SPAN_KIND_SERVER",
        },
        { kind: "number", column: "Duration", op: "gt", value: 100 },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("multiple .measure calls accumulate", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c1"))
      .measure((m) => m.count("c2"))
      .measure((m) => m.count("c3"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [
        { op: "COUNT", as: "c1" },
        { op: "COUNT", as: "c2" },
        { op: "COUNT", as: "c3" },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: round-trip parse
// ============================================================
describe("runtime: round-trip parse", () => {
  it("KopaiQuery.parse accepts every built query", () => {
    const cases: Array<{ q: unknown; expected: unknown }> = [
      {
        q: kq.traces
          .aggregate()
          .measure((m) => m.count("c"))
          .timeRelative("1h")
          .summary()
          .build(),
        expected: {
          signal: "traces",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "c" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        },
      },
      {
        q: kq.traces.raw().dimension("SpanId").timeRelative("1h").build(),
        expected: {
          signal: "traces",
          mode: "raw",
          dimensions: ["SpanId"],
          timeDimension: { type: "relative", lookback: "1h" },
        },
      },
      {
        q: kq.logs
          .aggregate()
          .measure((m) => m.count("c"))
          .timeRelative("1h")
          .summary()
          .build(),
        expected: {
          signal: "logs",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "c" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        },
      },
      {
        q: kq.logs.raw().dimension("Body").timeRelative("1h").build(),
        expected: {
          signal: "logs",
          mode: "raw",
          dimensions: ["Body"],
          timeDimension: { type: "relative", lookback: "1h" },
        },
      },
      {
        q: kq.metrics
          .aggregate()
          .measure((m) => m.count("c"))
          .timeRelative("1h")
          .summary()
          .build(),
        expected: {
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "c" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        },
      },
      {
        q: kq.metrics.raw().dimension("MetricName").timeRelative("1h").build(),
        expected: {
          signal: "metrics",
          mode: "raw",
          dimensions: ["MetricName"],
          timeDimension: { type: "relative", lookback: "1h" },
        },
      },
    ];
    for (const { q, expected } of cases) {
      expect(q).toEqual(expected);
      expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
    }
  });
});
