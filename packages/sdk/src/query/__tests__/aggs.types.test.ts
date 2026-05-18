import { describe, it, expectTypeOf } from "vitest";
import { traces, logs, metrics } from "../index.js";
import { tracesAgg, logsAgg, metricsAgg } from "../aggs.js";
import type { AggExpr } from "../aggs.js";

describe("tracesAgg matrix", () => {
  it("count(): AggExpr<number>", () => {
    expectTypeOf(tracesAgg.count()).toEqualTypeOf<AggExpr<number>>();
  });

  it("countDistinct: any kind, returns AggExpr<number>", () => {
    expectTypeOf(tracesAgg.countDistinct(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.countDistinct(traces.timestamp)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.countDistinct(traces.spanName)).toEqualTypeOf<
      AggExpr<number>
    >();
    // @ts-expect-error - map kind rejected
    tracesAgg.countDistinct(traces.spanAttributes);
    // @ts-expect-error - array kind rejected
    tracesAgg.countDistinct(traces.eventsName);
  });

  it("sum/avg/p* require number/numericString kind", () => {
    expectTypeOf(tracesAgg.sum(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.avg(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.p50(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.p99(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(tracesAgg.p999(traces.duration)).toEqualTypeOf<
      AggExpr<number>
    >();
    // @ts-expect-error - string kind rejected
    tracesAgg.sum(traces.spanName);
    // @ts-expect-error - string kind rejected
    tracesAgg.avg(traces.spanName);
    // @ts-expect-error - string kind rejected
    tracesAgg.p99(traces.spanName);
    // @ts-expect-error - map kind rejected
    tracesAgg.sum(traces.spanAttributes);
    // @ts-expect-error - array kind rejected
    tracesAgg.sum(traces.eventsTimestamp);
  });

  it("min/max return ColTsType", () => {
    expectTypeOf(tracesAgg.min(traces.duration)).toEqualTypeOf<
      AggExpr<string | undefined>
    >();
    expectTypeOf(tracesAgg.max(traces.timestamp)).toEqualTypeOf<
      AggExpr<string>
    >();
    expectTypeOf(tracesAgg.min(traces.spanName)).toEqualTypeOf<
      AggExpr<string | undefined>
    >();
    // @ts-expect-error - map kind rejected
    tracesAgg.min(traces.spanAttributes);
    // @ts-expect-error - array kind rejected
    tracesAgg.max(traces.eventsName);
  });

  it("topN returns AggExpr<Array<{value, count}>>", () => {
    expectTypeOf(tracesAgg.topN(traces.spanName, 10)).toEqualTypeOf<
      AggExpr<Array<{ value: string | undefined; count: number }>>
    >();
    expectTypeOf(tracesAgg.topN(traces.duration, 5)).toEqualTypeOf<
      AggExpr<Array<{ value: string | undefined; count: number }>>
    >();
    // @ts-expect-error - map kind rejected
    tracesAgg.topN(traces.spanAttributes, 10);
    // @ts-expect-error - array kind rejected
    tracesAgg.topN(traces.eventsName, 10);
  });

  it("traces does not have heatmap/rate*", () => {
    // @ts-expect-error - missing fn
    void tracesAgg.heatmap;
    // @ts-expect-error - missing fn
    void tracesAgg.rateAvg;
    // @ts-expect-error - missing fn
    void tracesAgg.rateSum;
    // @ts-expect-error - missing fn
    void tracesAgg.rateMax;
  });
});

describe("logsAgg matrix", () => {
  it("count() / countDistinct / min / max / topN", () => {
    expectTypeOf(logsAgg.count()).toEqualTypeOf<AggExpr<number>>();
    expectTypeOf(logsAgg.countDistinct(logs.body)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(logsAgg.min(logs.severityNumber)).toEqualTypeOf<
      AggExpr<number | undefined>
    >();
    expectTypeOf(logsAgg.max(logs.timestamp)).toEqualTypeOf<AggExpr<string>>();
    expectTypeOf(logsAgg.topN(logs.body, 5)).toEqualTypeOf<
      AggExpr<Array<{ value: string | undefined; count: number }>>
    >();
    // @ts-expect-error - map kind rejected by countDistinct
    logsAgg.countDistinct(logs.logAttributes);
    // @ts-expect-error - map kind rejected by min
    logsAgg.min(logs.logAttributes);
    // @ts-expect-error - map kind rejected by topN
    logsAgg.topN(logs.logAttributes, 10);
  });

  it("logs does not have sum/avg/p*/heatmap/rate*", () => {
    // @ts-expect-error - missing fn
    void logsAgg.sum;
    // @ts-expect-error - missing fn
    void logsAgg.avg;
    // @ts-expect-error - missing fn
    void logsAgg.p99;
    // @ts-expect-error - missing fn
    void logsAgg.heatmap;
    // @ts-expect-error - missing fn
    void logsAgg.rateAvg;
  });
});

describe("metricsAgg matrix", () => {
  it("sum/avg/p* on numeric metric cols", () => {
    expectTypeOf(metricsAgg.sum(metrics.gauge.value)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(metricsAgg.avg(metrics.gauge.value)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(metricsAgg.p50(metrics.histogram.sum)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(metricsAgg.p999(metrics.gauge.value)).toEqualTypeOf<
      AggExpr<number>
    >();
    // @ts-expect-error - string kind rejected
    metricsAgg.sum(metrics.gauge.metricName);
    // @ts-expect-error - map kind rejected
    metricsAgg.avg(metrics.gauge.attributes);
  });

  it("min/max return ColTsType", () => {
    expectTypeOf(metricsAgg.min(metrics.gauge.value)).toEqualTypeOf<
      AggExpr<number>
    >();
    expectTypeOf(metricsAgg.max(metrics.gauge.timeUnix)).toEqualTypeOf<
      AggExpr<string>
    >();
    expectTypeOf(metricsAgg.min(metrics.gauge.metricName)).toEqualTypeOf<
      AggExpr<string | undefined>
    >();
    // @ts-expect-error - map kind rejected
    metricsAgg.min(metrics.gauge.attributes);
  });

  it("heatmap returns array<{bucket,count}>", () => {
    expectTypeOf(metricsAgg.heatmap(metrics.gauge.value)).toEqualTypeOf<
      AggExpr<Array<{ bucket: number; count: number }>>
    >();
    // @ts-expect-error - string kind rejected
    metricsAgg.heatmap(metrics.gauge.metricName);
  });

  it("rate* requires nanosecond JSON string window", () => {
    expectTypeOf(
      metricsAgg.rateAvg(metrics.gauge.value, "1000000000")
    ).toEqualTypeOf<AggExpr<number>>();
    expectTypeOf(
      metricsAgg.rateSum(metrics.gauge.value, "1000000000")
    ).toEqualTypeOf<AggExpr<number>>();
    expectTypeOf(
      metricsAgg.rateMax(metrics.gauge.value, "1000000000")
    ).toEqualTypeOf<AggExpr<number>>();
    // @ts-expect-error - number not allowed
    metricsAgg.rateAvg(metrics.gauge.value, 1_000_000_000);
    // @ts-expect-error - bigint not allowed
    metricsAgg.rateSum(metrics.gauge.value, 1n);
    // @ts-expect-error - string kind rejected
    metricsAgg.rateAvg(metrics.gauge.metricName, "1");
  });

  it("metrics has no count / countDistinct / topN", () => {
    // @ts-expect-error - missing fn
    void metricsAgg.count;
    // @ts-expect-error - missing fn
    void metricsAgg.countDistinct;
    // @ts-expect-error - missing fn
    void metricsAgg.topN;
  });
});

describe("signal-mismatched columns rejected by name union", () => {
  it("agg constrained to signal-specific column names", () => {
    // Name union for each signal acts as the brand. Columns shared by
    // name across signals (e.g. `timestamp`) are structurally equivalent
    // and intentionally interchangeable — see deviation note.
    // @ts-expect-error - traces column not allowed on logsAgg
    logsAgg.min(traces.spanName);
    // @ts-expect-error - traces column not allowed on metricsAgg
    metricsAgg.sum(traces.duration);
    // @ts-expect-error - logs column not allowed on metricsAgg
    metricsAgg.avg(logs.severityNumber);
    // @ts-expect-error - traces column not allowed on logsAgg topN
    logsAgg.topN(traces.spanName, 5);
  });
});
