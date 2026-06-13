import { describe, it, expectTypeOf } from "vitest";
import { traces, logs, metrics } from "../index.js";
import type { ColumnRef } from "../columns.js";

// Attribute value type matching denormalized-signals-zod.ts AttributeValue.
type AttributeValue =
  | string
  | number
  | boolean
  | AttributeValue[]
  | { [key: string]: AttributeValue };

describe("traces columns", () => {
  it("exposes typed column refs for every traces column", () => {
    expectTypeOf(traces.spanId).toEqualTypeOf<
      ColumnRef<"spanId", string, "string">
    >();
    expectTypeOf(traces.timestamp).toEqualTypeOf<
      ColumnRef<"timestamp", string, "numericString">
    >();
    expectTypeOf(traces.traceId).toEqualTypeOf<
      ColumnRef<"traceId", string, "string">
    >();
    expectTypeOf(traces.duration).toEqualTypeOf<
      ColumnRef<"duration", string | undefined, "numericString">
    >();
    expectTypeOf(traces.eventsAttributes).toEqualTypeOf<
      ColumnRef<
        "eventsAttributes",
        Array<Record<string, AttributeValue>> | undefined,
        "array"
      >
    >();
    expectTypeOf(traces.eventsName).toEqualTypeOf<
      ColumnRef<"eventsName", string[] | undefined, "array">
    >();
    expectTypeOf(traces.eventsTimestamp).toEqualTypeOf<
      ColumnRef<"eventsTimestamp", string[] | undefined, "array">
    >();
    expectTypeOf(traces.linksAttributes).toEqualTypeOf<
      ColumnRef<
        "linksAttributes",
        Array<Record<string, AttributeValue>> | undefined,
        "array"
      >
    >();
    expectTypeOf(traces.linksSpanId).toEqualTypeOf<
      ColumnRef<"linksSpanId", string[] | undefined, "array">
    >();
    expectTypeOf(traces.linksTraceId).toEqualTypeOf<
      ColumnRef<"linksTraceId", string[] | undefined, "array">
    >();
    expectTypeOf(traces.linksTraceState).toEqualTypeOf<
      ColumnRef<"linksTraceState", string[] | undefined, "array">
    >();
    expectTypeOf(traces.parentSpanId).toEqualTypeOf<
      ColumnRef<"parentSpanId", string | undefined, "string">
    >();
    expectTypeOf(traces.resourceAttributes).toMatchTypeOf<
      ColumnRef<
        "resourceAttributes",
        Record<string, AttributeValue> | undefined,
        "map"
      >
    >();
    expectTypeOf(traces.scopeName).toEqualTypeOf<
      ColumnRef<"scopeName", string | undefined, "string">
    >();
    expectTypeOf(traces.scopeVersion).toEqualTypeOf<
      ColumnRef<"scopeVersion", string | undefined, "string">
    >();
    expectTypeOf(traces.serviceName).toEqualTypeOf<
      ColumnRef<"serviceName", string | undefined, "string">
    >();
    expectTypeOf(traces.spanAttributes).toMatchTypeOf<
      ColumnRef<
        "spanAttributes",
        Record<string, AttributeValue> | undefined,
        "map"
      >
    >();
    expectTypeOf(traces.spanKind).toEqualTypeOf<
      ColumnRef<"spanKind", string | undefined, "string">
    >();
    expectTypeOf(traces.spanName).toEqualTypeOf<
      ColumnRef<"spanName", string | undefined, "string">
    >();
    expectTypeOf(traces.statusCode).toEqualTypeOf<
      ColumnRef<"statusCode", string | undefined, "string">
    >();
    expectTypeOf(traces.statusMessage).toEqualTypeOf<
      ColumnRef<"statusMessage", string | undefined, "string">
    >();
    expectTypeOf(traces.traceState).toEqualTypeOf<
      ColumnRef<"traceState", string | undefined, "string">
    >();
  });

  it("supports attribute-map indexing as string columns", () => {
    // noUncheckedIndexedAccess adds `| undefined`; both halves still
    // structurally match the expected ColumnRef.
    expectTypeOf(traces.spanAttributes["http.route"]).toEqualTypeOf<
      ColumnRef<`spanAttributes.${string}`, string, "string"> | undefined
    >();
    expectTypeOf(traces.resourceAttributes["service.name"]).toEqualTypeOf<
      ColumnRef<`resourceAttributes.${string}`, string, "string"> | undefined
    >();
  });

  it("rejects unknown columns and indexing non-map columns", () => {
    // @ts-expect-error - unknown column
    void traces.bogus;
    // @ts-expect-error - indexing a non-map column
    void traces.spanName["x"];
  });
});

describe("logs columns", () => {
  it("exposes typed column refs for every logs column", () => {
    expectTypeOf(logs.timestamp).toEqualTypeOf<
      ColumnRef<"timestamp", string, "numericString">
    >();
    expectTypeOf(logs.body).toEqualTypeOf<
      ColumnRef<"body", string | undefined, "string">
    >();
    expectTypeOf(logs.eventName).toEqualTypeOf<
      ColumnRef<"eventName", string | undefined, "string">
    >();
    expectTypeOf(logs.logAttributes).toMatchTypeOf<
      ColumnRef<
        "logAttributes",
        Record<string, AttributeValue> | undefined,
        "map"
      >
    >();
    expectTypeOf(logs.resourceAttributes).toMatchTypeOf<
      ColumnRef<
        "resourceAttributes",
        Record<string, AttributeValue> | undefined,
        "map"
      >
    >();
    expectTypeOf(logs.resourceSchemaUrl).toEqualTypeOf<
      ColumnRef<"resourceSchemaUrl", string | undefined, "string">
    >();
    expectTypeOf(logs.scopeAttributes).toMatchTypeOf<
      ColumnRef<
        "scopeAttributes",
        Record<string, AttributeValue> | undefined,
        "map"
      >
    >();
    expectTypeOf(logs.scopeName).toEqualTypeOf<
      ColumnRef<"scopeName", string | undefined, "string">
    >();
    expectTypeOf(logs.scopeSchemaUrl).toEqualTypeOf<
      ColumnRef<"scopeSchemaUrl", string | undefined, "string">
    >();
    expectTypeOf(logs.scopeVersion).toEqualTypeOf<
      ColumnRef<"scopeVersion", string | undefined, "string">
    >();
    expectTypeOf(logs.serviceName).toEqualTypeOf<
      ColumnRef<"serviceName", string | undefined, "string">
    >();
    expectTypeOf(logs.severityNumber).toEqualTypeOf<
      ColumnRef<"severityNumber", number | undefined, "number">
    >();
    expectTypeOf(logs.severityText).toEqualTypeOf<
      ColumnRef<"severityText", string | undefined, "string">
    >();
    expectTypeOf(logs.spanId).toEqualTypeOf<
      ColumnRef<"spanId", string | undefined, "string">
    >();
    expectTypeOf(logs.traceFlags).toEqualTypeOf<
      ColumnRef<"traceFlags", number | undefined, "number">
    >();
    expectTypeOf(logs.traceId).toEqualTypeOf<
      ColumnRef<"traceId", string | undefined, "string">
    >();
  });

  it("supports attribute-map indexing on logs", () => {
    expectTypeOf(logs.logAttributes["log.level"]).toEqualTypeOf<
      ColumnRef<`logAttributes.${string}`, string, "string"> | undefined
    >();
  });
});

describe("metrics columns", () => {
  it("exposes typed column refs on metrics.gauge", () => {
    expectTypeOf(metrics.gauge.timeUnix).toEqualTypeOf<
      ColumnRef<"timeUnix", string, "numericString">
    >();
    expectTypeOf(metrics.gauge.startTimeUnix).toEqualTypeOf<
      ColumnRef<"startTimeUnix", string, "numericString">
    >();
    expectTypeOf(metrics.gauge.attributes).toMatchTypeOf<
      ColumnRef<"attributes", Record<string, AttributeValue> | undefined, "map">
    >();
    expectTypeOf(metrics.gauge.metricName).toEqualTypeOf<
      ColumnRef<"metricName", string | undefined, "string">
    >();
    expectTypeOf(metrics.gauge.value).toEqualTypeOf<
      ColumnRef<"value", number, "number">
    >();
    expectTypeOf(metrics.gauge.flags).toEqualTypeOf<
      ColumnRef<"flags", number | undefined, "number">
    >();
    expectTypeOf(metrics.gauge.metricType).toEqualTypeOf<
      ColumnRef<"metricType", string | undefined, "string">
    >();
  });

  it("exposes typed column refs on metrics.sum", () => {
    expectTypeOf(metrics.sum.value).toEqualTypeOf<
      ColumnRef<"value", number, "number">
    >();
    expectTypeOf(metrics.sum.aggregationTemporality).toEqualTypeOf<
      ColumnRef<"aggregationTemporality", string | undefined, "string">
    >();
    expectTypeOf(metrics.sum.isMonotonic).toEqualTypeOf<
      ColumnRef<"isMonotonic", number | undefined, "number">
    >();
  });

  it("exposes typed column refs on metrics.histogram", () => {
    expectTypeOf(metrics.histogram.count).toEqualTypeOf<
      ColumnRef<"count", number | undefined, "number">
    >();
    expectTypeOf(metrics.histogram.sum).toEqualTypeOf<
      ColumnRef<"sum", number | undefined, "number">
    >();
    expectTypeOf(metrics.histogram.min).toEqualTypeOf<
      ColumnRef<"min", number | null | undefined, "number">
    >();
    expectTypeOf(metrics.histogram.max).toEqualTypeOf<
      ColumnRef<"max", number | null | undefined, "number">
    >();
    expectTypeOf(metrics.histogram.bucketCounts).toEqualTypeOf<
      ColumnRef<"bucketCounts", number[] | undefined, "array">
    >();
    expectTypeOf(metrics.histogram.explicitBounds).toEqualTypeOf<
      ColumnRef<"explicitBounds", number[] | undefined, "array">
    >();
  });

  it("exposes typed column refs on metrics.exponentialHistogram", () => {
    expectTypeOf(metrics.exponentialHistogram.scale).toEqualTypeOf<
      ColumnRef<"scale", number | undefined, "number">
    >();
    expectTypeOf(metrics.exponentialHistogram.zeroCount).toEqualTypeOf<
      ColumnRef<"zeroCount", number | undefined, "number">
    >();
    expectTypeOf(
      metrics.exponentialHistogram.positiveBucketCounts
    ).toEqualTypeOf<
      ColumnRef<"positiveBucketCounts", number[] | undefined, "array">
    >();
    expectTypeOf(metrics.exponentialHistogram.positiveOffset).toEqualTypeOf<
      ColumnRef<"positiveOffset", number | undefined, "number">
    >();
    expectTypeOf(
      metrics.exponentialHistogram.negativeBucketCounts
    ).toEqualTypeOf<
      ColumnRef<"negativeBucketCounts", number[] | undefined, "array">
    >();
    expectTypeOf(metrics.exponentialHistogram.negativeOffset).toEqualTypeOf<
      ColumnRef<"negativeOffset", number | undefined, "number">
    >();
    expectTypeOf(metrics.exponentialHistogram.zeroThreshold).toEqualTypeOf<
      ColumnRef<"zeroThreshold", number | undefined, "number">
    >();
  });

  it("exposes typed column refs on metrics.summary", () => {
    expectTypeOf(metrics.summary.count).toEqualTypeOf<
      ColumnRef<"count", number | undefined, "number">
    >();
    expectTypeOf(metrics.summary.sum).toEqualTypeOf<
      ColumnRef<"sum", number | undefined, "number">
    >();
    expectTypeOf(metrics.summary.valueAtQuantilesQuantile).toEqualTypeOf<
      ColumnRef<"valueAtQuantilesQuantile", number[] | undefined, "array">
    >();
    expectTypeOf(metrics.summary.valueAtQuantilesValue).toEqualTypeOf<
      ColumnRef<"valueAtQuantilesValue", number[] | undefined, "array">
    >();
  });
});
