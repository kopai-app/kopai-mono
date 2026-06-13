import { describe, it, expect } from "vitest";
import {
  tracesKopaiQuerySchema,
  logsKopaiQuerySchema,
  metricsKopaiQuerySchema,
} from "@kopai/core";
import { traces, logs, metrics } from "../index.js";
import { tracesAgg, logsAgg, metricsAgg } from "../aggs.js";
import {
  and,
  eq,
  gt,
  in_,
  isNotNull,
  like,
  not,
  notIn,
  or,
} from "../operators.js";

describe("traces .toQuery wire shape", () => {
  it("scalar select w/ where, orderBy, limit, timeRange, cursor", () => {
    const q = traces
      .select({
        id: traces.traceId,
        name: traces.spanName,
        route: traces.spanAttributes["http.route"]!,
      })
      .where(and(eq(traces.spanName, "GET /"), gt(traces.duration, "1000")))
      .orderBy({ col: traces.timestamp, dir: "desc" })
      .limit(50)
      .timeRange("100", "200")
      .cursor("abc")
      .toQuery();
    expect(q).toEqual({
      signal: "traces",
      select: {
        id: { kind: "col", name: "traceId" },
        name: { kind: "col", name: "spanName" },
        route: { kind: "attr", map: "spanAttributes", key: "http.route" },
      },
      where: {
        kind: "and",
        exprs: [
          {
            kind: "eq",
            col: { kind: "col", name: "spanName" },
            value: "GET /",
          },
          {
            kind: "gt",
            col: { kind: "col", name: "duration" },
            value: "1000",
          },
        ],
      },
      orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "desc" }],
      limit: 50,
      timeRange: { start: "100", end: "200" },
      cursor: "abc",
    });
    const parsed = tracesKopaiQuerySchema.parse(JSON.parse(JSON.stringify(q)));
    expect(parsed.signal).toBe("traces");
  });

  it("aggregated traces with groupBy", () => {
    const q = traces
      .select({
        svc: traces.serviceName,
        p99: tracesAgg.p99(traces.duration),
        cnt: tracesAgg.count(),
        top: tracesAgg.topN(traces.spanName, 5),
      })
      .groupBy(traces.serviceName)
      .toQuery();
    expect(q).toEqual({
      signal: "traces",
      select: {
        svc: { kind: "col", name: "serviceName" },
        p99: {
          kind: "agg",
          fn: "p99",
          col: { kind: "col", name: "duration" },
        },
        cnt: { kind: "agg", fn: "count" },
        top: {
          kind: "agg",
          fn: "topN",
          col: { kind: "col", name: "spanName" },
          args: { n: 5 },
        },
      },
      groupBy: [{ kind: "col", name: "serviceName" }],
    });
    expect(() => tracesKopaiQuerySchema.parse(q)).not.toThrow();
  });

  it("complex where: or / not / in / notIn / isNotNull / like", () => {
    const q = traces
      .select({ id: traces.traceId })
      .where(
        or(
          in_(traces.spanName, ["GET", "POST"]),
          notIn(traces.statusCode, ["OK"]),
          isNotNull(traces.parentSpanId),
          not(like(traces.spanName, "internal.%"))
        )
      )
      .toQuery();
    expect(q.where).toEqual({
      kind: "or",
      exprs: [
        {
          kind: "in",
          col: { kind: "col", name: "spanName" },
          values: ["GET", "POST"],
        },
        {
          kind: "notIn",
          col: { kind: "col", name: "statusCode" },
          values: ["OK"],
        },
        {
          kind: "isNotNull",
          col: { kind: "col", name: "parentSpanId" },
        },
        {
          kind: "not",
          expr: {
            kind: "like",
            col: { kind: "col", name: "spanName" },
            value: "internal.%",
          },
        },
      ],
    });
    expect(() => tracesKopaiQuerySchema.parse(q)).not.toThrow();
  });

  it("cursor + agg select is rejected by the zod refine", () => {
    // The builder type-guard prevents .cursor() on aggregated builders;
    // we manually splice a cursor onto an aggregated query to verify
    // the zod superRefine catches it on the wire.
    const q = traces
      .select({ p: tracesAgg.p99(traces.duration) })
      .toQuery() as unknown as Record<string, unknown>;
    q.cursor = "x";
    const result = tracesKopaiQuerySchema.safeParse(q);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("cursor"))
      ).toBe(true);
    }
  });
});

describe("logs .toQuery wire shape", () => {
  it("scalar + agg", () => {
    const q = logs
      .select({
        sev: logs.severityNumber,
        n: logsAgg.count(),
      })
      .groupBy(logs.severityNumber)
      .toQuery();
    expect(q).toEqual({
      signal: "logs",
      select: {
        sev: { kind: "col", name: "severityNumber" },
        n: { kind: "agg", fn: "count" },
      },
      groupBy: [{ kind: "col", name: "severityNumber" }],
    });
    expect(() => logsKopaiQuerySchema.parse(q)).not.toThrow();
  });
});

describe("metrics .toQuery wire shape", () => {
  it("metrics.gauge w/ rate window", () => {
    const q = metrics.gauge
      .select({ r: metricsAgg.rateAvg(metrics.gauge.value, "1000000000") })
      .toQuery();
    expect(q).toEqual({
      signal: "metrics",
      metricType: "gauge",
      select: {
        r: {
          kind: "agg",
          fn: "rateAvg",
          col: { kind: "col", name: "value" },
          args: { windowNs: "1000000000" },
        },
      },
    });
    expect(() => metricsKopaiQuerySchema.parse(q)).not.toThrow();
  });

  it("metrics.histogram heatmap", () => {
    const q = metrics.histogram
      .select({ h: metricsAgg.heatmap(metrics.histogram.sum) })
      .toQuery();
    expect(q).toEqual({
      signal: "metrics",
      metricType: "histogram",
      select: {
        h: {
          kind: "agg",
          fn: "heatmap",
          col: { kind: "col", name: "sum" },
        },
      },
    });
    expect(() => metricsKopaiQuerySchema.parse(q)).not.toThrow();
  });

  it("metrics.summary roundtrip via JSON", () => {
    const q = metrics.summary.select({ c: metrics.summary.count }).toQuery();
    const round = JSON.parse(JSON.stringify(q));
    expect(() => metricsKopaiQuerySchema.parse(round)).not.toThrow();
  });
});
