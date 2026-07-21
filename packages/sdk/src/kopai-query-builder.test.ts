import { describe, it, expect, expectTypeOf } from "vitest";
import { kopaiQuery } from "@kopai/core";
import { kq, KopaiQueryBuildError } from "./kopai-query-builder.js";

function assertBuildError(err: unknown): asserts err is KopaiQueryBuildError {
  if (!(err instanceof KopaiQueryBuildError)) {
    throw new Error(
      `expected KopaiQueryBuildError, got ${err === undefined ? "undefined" : String(err)}`
    );
  }
}

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
    // build() now additively brands the return with a type-only `__aggRow`
    // phantom; the query body is otherwise unchanged, so the built
    // value is still assignable to TraceAggregateQuery and stripping the
    // phantom recovers exact equality.
    expectTypeOf(q).toExtend<kopaiQuery.TraceAggregateQuery>();
    expectTypeOf<
      Omit<typeof q, "__aggRow">
    >().toEqualTypeOf<kopaiQuery.TraceAggregateQuery>();
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
    expectTypeOf(q).toExtend<kopaiQuery.LogAggregateQuery>();
    expectTypeOf<
      Omit<typeof q, "__aggRow">
    >().toEqualTypeOf<kopaiQuery.LogAggregateQuery>();
  });

  it("logs.raw -> LogRawQuery", () => {
    const q = kq.logs.raw().dimension("Body").timeRelative("1h").build();
    expectTypeOf(q).toEqualTypeOf<kopaiQuery.LogRawQuery>();
  });

  it("metrics.aggregate -> MetricAggregateQuery", () => {
    const q = kq
      .metrics("Gauge")
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expectTypeOf(q).toExtend<kopaiQuery.MetricAggregateQuery>();
    expectTypeOf<
      Omit<typeof q, "__aggRow">
    >().toEqualTypeOf<kopaiQuery.MetricAggregateQuery>();
  });

  it("metrics.aggregate auto-emits the MetricType pin so build() succeeds without a manual .where", () => {
    // kq.metrics(type) makes the MetricType pin a builder
    // argument — the pin filter is auto-emitted, so no manual
    // .where(eq("MetricType", …)) is required for build()/validateKopaiQuery.
    const q = kq
      .metrics("Gauge")
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q.filters).toEqual([
      { column: "MetricType", op: "eq", value: "Gauge" },
    ]);
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics.raw -> MetricRawQuery", () => {
    const q = kq
      .metrics("Gauge")
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
  it("rejects missing timeDimension; build is available without dimensions", () => {
    if (false as boolean) {
      const b2 = kq.traces.raw().dimension("SpanId");
      // @ts-expect-error missing timeDimension
      b2.build();

      const b3 = kq.traces.raw();
      // @ts-expect-error missing timeDimension
      b3.build();

      // build is available without .dimension() once timeDimension is set
      const b4 = kq.traces.raw().timeRelative("1h");
      b4.build();
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
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error errorRate trace-only
        .measure((m) => m.errorRate("er"));
      kq.metrics("Gauge")
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
      kq.metrics("Gauge").aggregate().dimension("SpanKind");
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
      kq.metrics("Gauge")
        .aggregate()
        .where((f) =>
          // @ts-expect-error SpanKind is traces-only
          f.eq("SpanKind", "Server")
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
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error LogAttributes is logs-only
        .dimension({ container: "LogAttributes", key: "k" });
    }
    expect(true).toBe(true);
  });
});

// ============================================================
// Literal-union overloads for enum-valued columns
// ============================================================
describe("enum column literal-union overloads", () => {
  it("rejects wrong-cased / bogus enum values; accepts correct ones", () => {
    if (false as boolean) {
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error wrong casing — StatusCode is "Error" not "ERROR"
        f.eq("StatusCode", "ERROR")
      );
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error wrong casing inside in()
        f.in("StatusCode", ["ERROR"])
      );
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error wrong casing — SpanKind is "Server" not "SERVER"
        f.eq("SpanKind", "SERVER")
      );
      kq.metrics("Gauge")
        .aggregate()
        .where((f) =>
          // @ts-expect-error MetricType is "Gauge" not "gauge"
          f.eq("MetricType", "gauge")
        );
    }
    kq.traces.aggregate().where((f) => f.eq("StatusCode", "Error"));
    kq.traces.aggregate().where((f) => f.in("StatusCode", ["Ok", "Error"]));
    kq.traces.aggregate().where((f) => f.eq("SpanKind", "Server")); // real SPAN_KIND value
    kq.metrics("Gauge")
      .aggregate()
      .where((f) => f.eq("MetricType", "Gauge"));
    expect(true).toBe(true);
  });

  it("non-enum columns keep the wide value surface", () => {
    kq.traces.aggregate().where((f) => f.eq("SpanName", "anything"));
    kq.traces.aggregate().where((f) => f.eq("Duration", 123));
    expect(true).toBe(true);
  });

  it("a string-typed value is rejected for an enum column (type)", () => {
    if (false as boolean) {
      const code: string = "Error";
      kq.traces.aggregate().where((f) =>
        // @ts-expect-error a wide `string` is not a StatusCodeValue
        f.eq("StatusCode", code)
      );
    }
    expect(true).toBe(true);
  });
});

// The first argument type of the trace filter DSL — used for type-level
// assertions without constructing a full builder.
type TraceFilterDsl = Parameters<
  Parameters<ReturnType<typeof kq.traces.aggregate>["where"]>[0]
>[0];

// ============================================================
// MetricType as a builder argument
// ============================================================
describe("MetricType as a builder argument", () => {
  it("build() contains the auto-emitted MetricType pin and validates", () => {
    const q = kq
      .metrics("Gauge")
      .aggregate()
      .measure((m) => m.avg("Value", "v"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q.filters).toContainEqual({
      column: "MetricType",
      op: "eq",
      value: "Gauge",
    });
    // No manual MetricType .where was needed — validateKopaiQuery passes via
    // the round-trip parse below (build() already ran it without throwing).
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("Histogram exposes Count/Sum/Min/Max; build validates", () => {
    const q = kq
      .metrics("Histogram")
      .aggregate()
      .measure((m) => m.max("Max", "mx"))
      .measure((m) => m.min("Min", "mn"))
      .measure((m) => m.sum("Sum", "s"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q.filters).toContainEqual({
      column: "MetricType",
      op: "eq",
      value: "Histogram",
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("rejects a Histogram-only column on a Gauge builder (compile error)", () => {
    if (false as boolean) {
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error "Min" is Histogram-only; not on Gauge
        .measure((m) => m.min("Min", "mn"));
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error "Count" is not a Gauge value column
        .measure((m) => m.sum("Count", "c"));
    }
    // Inverse: "Value" is invalid on Histogram.
    if (false as boolean) {
      kq.metrics("Histogram")
        .aggregate()
        // @ts-expect-error "Value" is Gauge/Sum-only; not on Histogram
        .measure((m) => m.avg("Value", "v"));
    }
    expect(true).toBe(true);
  });

  it("Gauge accepts Value; Histogram accepts Count/Sum/Min/Max (positive)", () => {
    kq.metrics("Gauge")
      .aggregate()
      .measure((m) => m.avg("Value", "v"));
    kq.metrics("Histogram")
      .aggregate()
      .measure((m) => m.max("Max", "mx"));
    expect(true).toBe(true);
  });

  it("errorRate/throughput stay trace-only on metric builders (compile error)", () => {
    if (false as boolean) {
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error errorRate trace-only
        .measure((m) => m.errorRate("er"));
      kq.metrics("Sum")
        .aggregate()
        // @ts-expect-error throughput trace-only
        .measure((m) => m.throughput("tp"));
    }
    expect(true).toBe(true);
  });

  it("the auto-emitted SDK per-type column literals match core (no drift)", () => {
    // Source of truth: METRIC_STRUCTURAL_COLUMNS_BY_TYPE. The SDK narrows the
    // column surface using hand-written literal unions; assert each type's
    // structural value columns exist in the core set so drift fails CI.
    const byType = kopaiQuery.METRIC_STRUCTURAL_COLUMNS_BY_TYPE;
    expect(byType.Gauge.has("Value")).toBe(true);
    expect(byType.Sum.has("Value")).toBe(true);
    expect(byType.Sum.has("IsMonotonic")).toBe(true);
    for (const c of ["Count", "Sum", "Min", "Max"]) {
      expect(byType.Histogram.has(c)).toBe(true);
      expect(byType.ExponentialHistogram.has(c)).toBe(true);
    }
    expect(byType.Summary.has("Count")).toBe(true);
    expect(byType.Summary.has("Sum")).toBe(true);
    // Cross-type exclusions the SDK type narrowing relies on:
    expect(byType.Gauge.has("Min")).toBe(false);
    expect(byType.Gauge.has("Count")).toBe(false);
    expect(byType.Histogram.has("Value")).toBe(false);
    expect(byType.Summary.has("Min")).toBe(false);
  });
});

// ============================================================
// Duration filters accept human durations
// ============================================================
describe("Duration filters accept human durations", () => {
  it('gt("Duration","1s") compiles and the compiled value is 1_000_000_000', () => {
    const q = kq.traces
      .raw()
      .where((f) => f.gt("Duration", "1s"))
      .timeRelative("1h")
      .build();
    expect(q.filters).toEqual([
      { column: "Duration", op: "gt", value: 1_000_000_000 },
    ]);
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("a raw nanosecond number still works", () => {
    const q = kq.traces
      .raw()
      .where((f) => f.gte("Duration", 500))
      .timeRelative("1h")
      .build();
    expect(q.filters).toEqual([{ column: "Duration", op: "gte", value: 500 }]);
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("other duration units transform too (2h, 30m)", () => {
    const q = kq.traces
      .raw()
      .where((f) => f.lt("Duration", "2h"))
      .where((f) => f.gt("Duration", "30m"))
      .timeRelative("1d")
      .build();
    expect(q.filters).toEqual([
      { column: "Duration", op: "lt", value: 2 * 60 * 60 * 1_000_000_000 },
      { column: "Duration", op: "gt", value: 30 * 60 * 1_000_000_000 },
    ]);
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("a type-valid but runtime-invalid duration ('0s') is rejected at build (KopaiQueryBuildError)", () => {
    // The template-literal DurationString accepts "0s" (a number + unit), but
    // the runtime schema/regex rejects zero. durationStringToNanos passes it
    // through unchanged, so the numeric value schema surfaces a clear
    // KopaiQueryBuildError at build — the runtime backstop for the cases the
    // type can't express (zero, non-integer magnitudes, JS callers).
    let err: unknown;
    try {
      kq.traces
        .raw()
        .where((f) => f.gt("Duration", "0s"))
        .timeRelative("1h")
        .build();
    } catch (e) {
      err = e;
    }
    assertBuildError(err);
    expect(err.issues.some((i) => i.path.includes("filters"))).toBe(true);
  });

  it("accepts a number or a DurationString literal; rejects a wide/malformed string", () => {
    type GtValue = Parameters<TraceFilterDsl["gt"]>[1];
    // A number (ns) and a valid duration-string literal are accepted.
    expectTypeOf<number>().toExtend<GtValue>();
    expectTypeOf<"1s">().toExtend<GtValue>();
    expectTypeOf<"2h">().toExtend<GtValue>();
    // The template-literal DurationString rejects a wide `string` and
    // unit-less / wrong-unit literals at compile time (was loosely `string`).
    expectTypeOf<string>().not.toExtend<GtValue>();
    expectTypeOf<"5">().not.toExtend<GtValue>();
    expectTypeOf<"250ms">().not.toExtend<GtValue>();
  });

  it("rejects a non-duration value type for gt (type)", () => {
    if (false as boolean) {
      kq.traces.raw().where((f) =>
        // @ts-expect-error a boolean is not a DurationValue
        f.gt("Duration", true)
      );
    }
    expect(true).toBe(true);
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

  it("traces.raw without .dimension() omits the dimensions field", () => {
    const q = kq.traces.raw().timeRelative("1h").build();
    expect(q).toEqual({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "relative", lookback: "1h" },
    });
    expect(Object.keys(q)).not.toContain("dimensions");
    expect("dimensions" in q).toBe(false);
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
    // MetricType pin auto-emitted by kq.metrics("Gauge").
    const q = kq
      .metrics("Gauge")
      .aggregate()
      .measure((m) => m.count("c"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("metrics.raw minimum-valid", () => {
    const q = kq
      .metrics("Gauge")
      .raw()
      .dimension("MetricName")
      .timeRelative("1h")
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "raw",
      dimensions: ["MetricName"],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
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
      .where((f) => f.eq("SpanKind", "Server"))
      .where((f) => f.gt("Duration", 100))
      .having("requests", "gt", 0)
      .orderByMeasure("p95_dur", "desc")
      .orderByDimension("service.name", "asc")
      .timeRelative("2h")
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
          column: "SpanKind",
          op: "eq",
          value: "Server",
        },
        { column: "Duration", op: "gt", value: 100 },
      ],
      havings: [{ measure: "requests", op: "gt", value: 0 }],
      orderBy: [
        { type: "measure", alias: "p95_dur", direction: "desc" },
        { type: "dimension", column: "service.name", direction: "asc" },
      ],
      timeDimension: {
        type: "relative",
        lookback: "2h",
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
      filters: [{ column: "Body", op: "contains", value: "error" }],
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
    const q = kq
      .metrics("Gauge")
      .aggregate()
      .measure((m) => m.avg("Value", "avg_v"))
      .dimension("MetricName")
      .timeRelative("30m")
      .timeSeries("1m")
      .build();
    expect(q).toEqual({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "AVG", column: "Value", as: "avg_v" }],
      dimensions: ["MetricName"],
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
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
      filters: [{ column: "Duration", op: "gte", value: 1000 }],
      orderBy: [{ type: "dimension", column: "Duration", direction: "desc" }],
      timeDimension: { type: "relative", lookback: "1h" },
      limit: 50,
      cursor: "opaque-token",
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });
});

// ============================================================
// Runtime: filter coverage (each op)
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
      filters: [{ column: "SpanName", op: "eq", value: "GET /" }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("in filter (strings)", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) => f.in("SpanKind", ["Server", "Client"]))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q).toEqual({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      filters: [
        {
          column: "SpanKind",
          op: "in",
          values: ["Server", "Client"],
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
      filters: [{ column: "Duration", op: "gt", value: 500 }],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("in filter (numbers)", () => {
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
    // IsMonotonic exists only on the Sum metric type; kq.metrics("Sum")
    // pins it and exposes IsMonotonic in the column surface.
    const q = kq
      .metrics("Sum")
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
        { column: "MetricType", op: "eq", value: "Sum" },
        { column: "IsMonotonic", op: "eq", value: true },
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
      filters: [{ column: "ParentSpanId", op: "isNull" }],
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
            f.and(f.eq("SpanKind", "Server"), f.gt("Duration", 100)),
            f.eq("StatusCode", "Error")
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
          and: [
            {
              or: [
                {
                  and: [
                    {
                      column: "SpanKind",
                      op: "eq",
                      value: "Server",
                    },
                    {
                      column: "Duration",
                      op: "gt",
                      value: 100,
                    },
                  ],
                },
                {
                  column: "StatusCode",
                  op: "eq",
                  value: "Error",
                },
              ],
            },
            { column: "TraceId", op: "isNotNull" },
          ],
        },
      ],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "summary" },
    });
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("attr-ref via column literal", () => {
    const q = kq.traces
      .aggregate()
      .measure((m) => m.count("c"))
      .where((f) =>
        f.eq({ container: "SpanAttributes", key: "custom.flag" }, true)
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
    // Value exists on the Gauge metric type.
    const q = kq
      .metrics("Gauge")
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
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
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
  it("relative time", () => {
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

  it("absolute time", () => {
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
    assertBuildError(err);
    expect(err.name).toBe("KopaiQueryBuildError");
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.issues.some((i) => i.path.includes("lookback"))).toBe(true);
    expect(err.message).toContain("Failed to build KopaiQuery");
    expect(err.message.split("\n").length).toBeGreaterThan(1);
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
    assertBuildError(err);
    expect(err.issues.some((i) => i.path.includes("startTime"))).toBe(true);
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
    assertBuildError(err);
    expect(err.issues.some((i) => i.path.includes("granularity"))).toBe(true);
  });

  it("empty .in([]) -> validation error on values", () => {
    let err: unknown;
    // SpanName keeps the wide string[] overload (SpanKind would require the
    // SpanKindValue literal union). The empty-array rejection is what
    // is under test here, independent of column.
    const emptyValues: string[] = [];
    try {
      kq.traces
        .aggregate()
        .measure((m) => m.count("c"))
        .where((f) => f.in("SpanName", emptyValues))
        .timeRelative("1h")
        .summary()
        .build();
    } catch (e) {
      err = e;
    }
    assertBuildError(err);
    // The in/notIn `values` schema is a union of (string[] | number[]); an
    // empty array fails both branches, so Zod reports an invalid_union at the
    // filter node (filters.0) rather than at filters.0.values.
    expect(err.issues.some((i) => i.path.includes("filters"))).toBe(true);
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
    assertBuildError(err);
    expect(err.issues.some((i) => i.path.includes("limit"))).toBe(true);
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
    assertBuildError(err);
    expect(err.issues.some((i) => i.path.includes("limit"))).toBe(true);
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
    assertBuildError(err);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KopaiQueryBuildError);
    expect(err.name).toBe("KopaiQueryBuildError");
    expect(Array.isArray(err.issues)).toBe(true);
    err.issues.forEach((i) => {
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
      .where((f) => f.eq("SpanKind", "Server"))
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
          column: "SpanKind",
          op: "eq",
          value: "Server",
        },
        { column: "Duration", op: "gt", value: 100 },
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
        q: kq
          .metrics("Gauge")
          .aggregate()
          .measure((m) => m.count("c"))
          .timeRelative("1h")
          .summary()
          .build(),
        expected: {
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "c" }],
          filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
          timeDimension: { type: "relative", lookback: "1h" },
          output: { type: "summary" },
        },
      },
      {
        q: kq
          .metrics("Gauge")
          .raw()
          .dimension("MetricName")
          .timeRelative("1h")
          .build(),
        expected: {
          signal: "metrics",
          mode: "raw",
          dimensions: ["MetricName"],
          filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
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
