import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  TracesKopaiQuery,
  LogsKopaiQuery,
  MetricsKopaiQuery,
} from "@kopai/core";
import { traces, logs, metrics } from "../index.js";
import { tracesAgg, logsAgg, metricsAgg } from "../aggs.js";
import { eq } from "../operators.js";

describe(".select shapes infer Row correctly", () => {
  it("(1) all scalar cols", () => {
    const q = traces
      .select({ id: traces.traceId, name: traces.spanName })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      id: string;
      name: string | undefined;
    }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<false>();
    expectTypeOf(q).toMatchTypeOf<TracesKopaiQuery>();
  });

  it("(2) pure agg", () => {
    const q = traces
      .select({ p: tracesAgg.p99(traces.duration), c: tracesAgg.count() })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ p: number; c: number }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
  });

  it("(3) mixed scalar + agg", () => {
    const q = traces
      .select({
        svc: traces.serviceName,
        n: tracesAgg.count(),
      })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      svc: string | undefined;
      n: number;
    }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
  });

  it("(4) attr-map indexed col selected", () => {
    // Attribute-map indexing yields `ColumnRef | undefined` under
    // noUncheckedIndexedAccess; deref with `!` at use-site.
    const route = traces.spanAttributes["http.route"]!;
    const q = traces.select({ route }).toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ route: string }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<false>();
  });

  it("(5) topN in select", () => {
    const q = traces
      .select({ x: tracesAgg.topN(traces.spanName, 10) })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      x: Array<{ value: string | undefined; count: number }>;
    }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
  });

  it("(6) min/max returns ColTsType", () => {
    const q = traces
      .select({
        mn: tracesAgg.min(traces.duration),
        mx: tracesAgg.max(traces.timestamp),
      })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      mn: string | undefined;
      mx: string;
    }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
  });
});

describe("logs builder", () => {
  it("works for logs", () => {
    const q = logs.select({ ts: logs.timestamp, body: logs.body }).toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      ts: string;
      body: string | undefined;
    }>();
    expectTypeOf(q).toMatchTypeOf<LogsKopaiQuery>();
  });
});

describe("metrics builders per type", () => {
  it("metrics.gauge", () => {
    const q = metrics.gauge.select({ v: metrics.gauge.value }).toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ v: number }>();
    expectTypeOf(q).toMatchTypeOf<MetricsKopaiQuery>();
  });
  it("metrics.histogram", () => {
    const q = metrics.histogram
      .select({ c: metrics.histogram.count })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ c: number | undefined }>();
  });
});

describe("invalid select values rejected", () => {
  it("non-ref/non-agg values rejected", () => {
    expect.assertions(0);
    // Guard with `if (false)` so the body is type-checked but never
    // executed at runtime (the calls would crash on bogus values).
    if ((1 as number) > 2) {
      // @ts-expect-error - raw string not a ColumnRef
      traces.select({ x: "spanName" });
      // @ts-expect-error - raw number not a ColumnRef
      traces.select({ x: 42 });
    }
  });
});

describe(".where accepts ExprNode only", () => {
  it("typed correctly", () => {
    const q = traces
      .select({ id: traces.traceId })
      .where(eq(traces.spanName, "x"))
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ id: string }>();
    if ((1 as number) > 2) {
      // @ts-expect-error - non-Expr rejected
      traces.select({ id: traces.traceId }).where(123);
      // @ts-expect-error - non-Expr rejected
      traces.select({ id: traces.traceId }).where("foo");
    }
  });
});

describe(".groupBy accepts ColumnRef[]", () => {
  it("typed correctly", () => {
    const q = traces
      .select({ svc: traces.serviceName, n: tracesAgg.count() })
      .groupBy(traces.serviceName)
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{
      svc: string | undefined;
      n: number;
    }>();
    if ((1 as number) > 2) {
      // @ts-expect-error - string not a ColumnRef
      traces.select({ id: traces.traceId }).groupBy("spanName");
      // @ts-expect-error - agg expr not a ColumnRef
      traces.select({ id: traces.traceId }).groupBy(tracesAgg.count());
    }
  });
});

describe(".orderBy validates col/dir", () => {
  it("typed correctly", () => {
    traces
      .select({ id: traces.traceId })
      .orderBy({ col: traces.traceId, dir: "asc" });
    if ((1 as number) > 2) {
      traces.select({ id: traces.traceId }).orderBy({
        col: traces.traceId,
        // @ts-expect-error - invalid dir
        dir: "up",
      });
      traces.select({ id: traces.traceId }).orderBy({
        // @ts-expect-error - col must be ColumnRef
        col: 42,
        dir: "asc",
      });
    }
  });
});

describe(".limit/.timeRange validate inputs", () => {
  it("typed correctly", () => {
    traces.select({ id: traces.traceId }).limit(100);
    traces.select({ id: traces.traceId }).timeRange("1", "2");
    // @ts-expect-error - string not number
    traces.select({ id: traces.traceId }).limit("100");
    // @ts-expect-error - number not string
    traces.select({ id: traces.traceId }).timeRange(1, 2);
  });
});

describe(".cursor is non-aggregated only", () => {
  it("cursor allowed when not aggregated", () => {
    const q = traces.select({ id: traces.traceId }).cursor("opaque").toQuery();
    expectTypeOf(q.__isAgg).toEqualTypeOf<false>();
  });
  it("cursor blocked when aggregated", () => {
    const b = traces.select({ p: tracesAgg.p99(traces.duration) });
    // @ts-expect-error - cursor unavailable on aggregated builder
    b.cursor("x");
  });
});

describe(".toQuery returns signal-specific wire query with phantoms", () => {
  it("traces", () => {
    const q = traces.select({ id: traces.traceId }).toQuery();
    expectTypeOf(q).toMatchTypeOf<
      TracesKopaiQuery & { __row: { id: string }; __isAgg: false }
    >();
  });
  it("logs", () => {
    const q = logs.select({ n: logsAgg.count() }).toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ n: number }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
    expectTypeOf(q).toMatchTypeOf<LogsKopaiQuery>();
  });
  it("metrics.gauge", () => {
    const q = metrics.gauge
      .select({ s: metricsAgg.sum(metrics.gauge.value) })
      .toQuery();
    expectTypeOf(q.__row).toEqualTypeOf<{ s: number }>();
    expectTypeOf(q.__isAgg).toEqualTypeOf<true>();
    expectTypeOf(q).toMatchTypeOf<MetricsKopaiQuery>();
  });
});
