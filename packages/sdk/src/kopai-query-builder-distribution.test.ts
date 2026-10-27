// Distribution and counter measures on the SDK builder (KOP-70, spec 7):
// methods limited by MetricType, row typing of every generated key, and no
// automatic IsMonotonic pin.
import { describe, it, expect, expectTypeOf } from "vitest";
import { kopaiQuery } from "@kopai/core";
import { kq, KopaiQueryBuildError } from "./kopai-query-builder.js";

type RowOf<Q extends { output: { type: string } }> =
  kopaiQuery.AggregateResultFor<Q>["data"][number];

describe("histogram measures", () => {
  const q = kq
    .metrics("Histogram")
    .aggregate()
    .measure((m) => m.histogramQuantile(0.95, "p95"))
    .measure((m) => m.histogramAvg("avg"))
    .measure((m) => m.rate("Count", "rps"))
    .measure((m) => m.increase("Sum", "total"))
    .measure((m) => m.count("n"))
    .dimension("MetricName")
    .timeRelative("1h")
    .summary()
    .build();

  it("emits the wire ops", () => {
    expect(q.measures).toEqual([
      { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" },
      { op: "HISTOGRAM_AVG", as: "avg" },
      { op: "RATE", column: "Count", as: "rps" },
      { op: "INCREASE", column: "Sum", as: "total" },
      { op: "COUNT", as: "n" },
    ]);
    expect(kopaiQuery.KopaiQuery.parse(q)).toEqual(q);
  });

  it("types every generated key", () => {
    type Row = RowOf<typeof q>;
    expectTypeOf<Row["p95"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["p95_low"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["p95_high"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["p95_coarsened"]>().toEqualTypeOf<0 | 1>();
    expectTypeOf<Row["p95_error"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["avg"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["avg_error"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Row["rps"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["total"]>().toEqualTypeOf<number | null>();
    // Existing ops keep their type.
    expectTypeOf<Row["n"]>().toEqualTypeOf<number>();
    expectTypeOf<Row["MetricName"]>().toEqualTypeOf<string | number | null>();
  });

  it("reads Count or Sum only", () => {
    if (false as boolean) {
      kq.metrics("Histogram")
        .aggregate()
        // @ts-expect-error INCREASE on Histogram reads Count or Sum
        .measure((m) => m.increase("BucketCounts", "x"));
    }
    expect(true).toBe(true);
  });
});

describe("summary and counter measures", () => {
  it("types SUMMARY_QUANTILE as number | null", () => {
    const q = kq
      .metrics("Summary")
      .aggregate()
      .measure((m) => m.summaryQuantile(0.99, "p99"))
      .timeRelative("1h")
      .timeSeries("5m")
      .build();
    expect(q.measures).toEqual([
      { op: "SUMMARY_QUANTILE", quantile: 0.99, as: "p99" },
    ]);
    type Row = RowOf<typeof q>;
    expectTypeOf<Row["p99"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Row["bucket_start"]>().toEqualTypeOf<string>();
  });

  it("builds a Sum counter rate with the IsMonotonic pin", () => {
    const q = kq
      .metrics("Sum")
      .aggregate()
      .where((f) => f.eq("IsMonotonic", true))
      .measure((m) => m.rate("Value", "rps"))
      .timeRelative("1h")
      .summary()
      .build();
    expect(q.measures).toEqual([{ op: "RATE", column: "Value", as: "rps" }]);
  });

  it("never adds the IsMonotonic pin itself", () => {
    const build = () =>
      kq
        .metrics("Sum")
        .aggregate()
        .measure((m) => m.increase("Value", "inc"))
        .timeRelative("1h")
        .summary()
        .build();
    expect(build).toThrow(KopaiQueryBuildError);
    expect(build).toThrow(/IsMonotonic/);
  });
});

describe("methods are limited by MetricType", () => {
  it("offers each op only where it applies (compile errors)", () => {
    if (false as boolean) {
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error histogram ops are Histogram-only
        .measure((m) => m.histogramQuantile(0.95, "p"));
      kq.metrics("Summary")
        .aggregate()
        // @ts-expect-error histogramAvg is Histogram-only
        .measure((m) => m.histogramAvg("a"));
      kq.metrics("Histogram")
        .aggregate()
        // @ts-expect-error summaryQuantile is Summary-only
        .measure((m) => m.summaryQuantile(0.5, "p"));
      kq.metrics("Gauge")
        .aggregate()
        // @ts-expect-error counters are Sum/Histogram only
        .measure((m) => m.rate("Value", "r"));
      kq.metrics("ExponentialHistogram")
        .aggregate()
        // @ts-expect-error not supported on ExponentialHistogram
        .measure((m) => m.increase("Count", "i"));
      kq.metrics("Sum")
        .aggregate()
        // @ts-expect-error a Sum counter reads Value
        .measure((m) => m.increase("Count", "i"));
      kq.traces
        .aggregate()
        // @ts-expect-error metrics only
        .measure((m) => m.rate("Duration", "r"));
    }
    expect(true).toBe(true);
  });
});
