/// <reference types="vitest/globals" />
import { kopaiQueryCompiler, type datasource } from "@kopai/core";

import { LIMITS, MAX_RESULT_CHARACTERS } from "./limits.js";
import { runMetricsDiscoverTool, runQueryTool } from "./tools.js";

const td = { type: "relative" as const, lookback: "1h" as const };

const rawQuery = (extra: Record<string, unknown> = {}) => ({
  query: { signal: "traces", mode: "raw", timeDimension: td, ...extra },
});

const aggQuery = (extra: Record<string, unknown> = {}) => ({
  query: {
    signal: "traces",
    mode: "aggregate",
    measures: [{ op: "COUNT", as: "c" }],
    timeDimension: td,
    output: { type: "summary" },
    ...extra,
  },
});

/** A datasource whose `query` returns whatever the test hands it. */
function fakeDatasource(
  onQuery: (q: Record<string, unknown>) => unknown,
  onDiscover: () => unknown = () => ({ metrics: [] })
) {
  const calls: Record<string, unknown>[] = [];
  const ds = {
    query: async (q: Record<string, unknown>) => {
      calls.push(q);
      return onQuery(q);
    },
    discoverMetrics: async () => onDiscover(),
  } as unknown as datasource.ReadTelemetryDatasource;
  return { ds, calls };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ c: i }));

function payloadOf(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("runQueryTool — input validation", () => {
  it("rejects a non-object input with one issue at `query`", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    for (const input of [null, "x", 3, []]) {
      const run = await runQueryTool(input, { readTelemetryDatasource: ds });
      expect(run.outcome).toBe("invalid_input");
      expect(payloadOf(run.result).issues).toEqual([
        { path: "query", message: "Expected a query object." },
      ]);
    }
  });

  it("reports a missing `mode` as one issue on `query.mode`", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const run = await runQueryTool(
      { query: { signal: "traces", timeDimension: td } },
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    const issues = payloadOf(run.result).issues as { path: string }[];
    expect(issues.map((i) => i.path)).toEqual(["query.mode"]);
  });

  it("names only the selected branch's fields, prefixed `query.`", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const run = await runQueryTool(
      aggQuery({ measures: [{ op: "AVG", column: "NoSuchColumn", as: "x" }] }),
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    const issues = payloadOf(run.result).issues as {
      path: string;
      message: string;
    }[];
    expect(issues.map((i) => i.path)).toEqual(["query.measures.0.column"]);
    expect(issues[0]?.message).toMatch(/NoSuchColumn/);
  });

  it("rejects a misspelled query field rather than running without it", async () => {
    // The failure this pins: `filter` was dropped, the query ran over the
    // whole window, and the tool answered `ok` with every row in it.
    const { ds, calls } = fakeDatasource(() => ({
      data: rows(5),
      nextCursor: null,
    }));
    const run = await runQueryTool(
      {
        query: {
          signal: "traces",
          mode: "raw",
          timeDimension: td,
          filter: [{ column: "StatusCode", op: "eq", value: "Error" }],
        },
      },
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    expect(calls).toHaveLength(0);
    const issues = payloadOf(run.result).issues as {
      path: string;
      message: string;
    }[];
    expect(issues.map((i) => i.path)).toEqual(["query.filter"]);
    expect(issues[0]?.message).toContain('Did you mean "filters"?');
  });

  it("rejects an inverted absolute window instead of answering `ok` with no rows", async () => {
    // Measured before the fix: the tool ran the query, got zero rows and
    // answered `ok`, which a caller reads as "no telemetry in that window".
    const { ds, calls } = fakeDatasource(() => ({
      data: [],
      nextCursor: null,
    }));
    const run = await runQueryTool(
      {
        query: {
          signal: "traces",
          mode: "raw",
          timeDimension: {
            type: "absolute",
            startTime: "2026-02-01T00:00:00.000Z",
            endTime: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    expect(calls).toHaveLength(0);
    const issues = payloadOf(run.result).issues as {
      path: string;
      message: string;
    }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("query");
    expect(issues[0]?.message).toMatch(/endTime/);
  });

  it("rejects an argument beside `query` instead of ignoring it", async () => {
    // `limit` written one level too high. The handler reads only `query`, and
    // the pass-through validator checks nothing, so this was silently dropped
    // and the query ran with the fallback limit.
    const { ds, calls } = fakeDatasource(() => ({
      data: rows(5),
      nextCursor: null,
    }));
    const run = await runQueryTool(
      { ...rawQuery(), limit: 500 },
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    expect(calls).toHaveLength(0);
    const issues = payloadOf(run.result).issues as {
      path: string;
      message: string;
    }[];
    expect(issues.map((i) => i.path)).toEqual(["limit"]);
    expect(issues[0]?.message).toContain("`query.limit`");
  });

  it("maps a cross-field compiler rejection to one issue at `query`", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    // Metric queries require a MetricType filter — a check the zod schema
    // cannot express, so it arrives from validateKopaiQuery at the root.
    const run = await runQueryTool(
      { query: { signal: "metrics", mode: "raw", timeDimension: td } },
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    const issues = payloadOf(run.result).issues as {
      path: string;
      message: string;
    }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("query");
    expect(issues[0]?.message).toMatch(/MetricType/);
  });
});

describe("runQueryTool — limits", () => {
  it("defaults to the raw fallback when no limit is given", async () => {
    const { ds, calls } = fakeDatasource(() => ({
      data: [],
      nextCursor: null,
    }));
    await runQueryTool(rawQuery(), { readTelemetryDatasource: ds });
    expect(calls[0]?.limit).toBe(LIMITS.raw.fallback);
  });

  it("defaults aggregate to its own fallback, probing one row over", async () => {
    const { ds, calls } = fakeDatasource(() => ({ data: [] }));
    await runQueryTool(aggQuery(), { readTelemetryDatasource: ds });
    expect(calls[0]?.limit).toBe(LIMITS.aggregate.fallback + 1);
  });

  it(`rejects a raw limit above ${LIMITS.raw.max} — not ${LIMITS.aggregate.max}`, async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const over = await runQueryTool(rawQuery({ limit: LIMITS.raw.max + 1 }), {
      readTelemetryDatasource: ds,
    });
    expect(over.outcome).toBe("invalid_input");
    const issues = payloadOf(over.result).issues as { path: string }[];
    expect(issues.map((i) => i.path)).toEqual(["query.limit"]);

    const at = await runQueryTool(rawQuery({ limit: LIMITS.raw.max }), {
      readTelemetryDatasource: ds,
    });
    expect(at.outcome).toBe("ok");
  });

  it(`rejects an aggregate limit above ${LIMITS.aggregate.max}`, async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const run = await runQueryTool(
      aggQuery({ limit: LIMITS.aggregate.max + 1 }),
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("invalid_input");
    expect(
      (payloadOf(run.result).issues as { path: string }[]).map((i) => i.path)
    ).toEqual(["query.limit"]);
  });

  it("never clamps — an over-cap limit is refused, not quietly lowered", async () => {
    const { ds, calls } = fakeDatasource(() => ({ data: [] }));
    await runQueryTool(rawQuery({ limit: 5000 }), {
      readTelemetryDatasource: ds,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("runQueryTool — aggregate overflow", () => {
  it("returns every row when the result fits", async () => {
    const { ds } = fakeDatasource(() => ({ data: rows(10) }));
    const run = await runQueryTool(aggQuery({ limit: 10 }), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("ok");
    expect((payloadOf(run.result).data as unknown[]).length).toBe(10);
    expect(payloadOf(run.result).truncated).toBeUndefined();
  });

  it("refuses an unordered overflow, with no rows and concrete remedies", async () => {
    const { ds } = fakeDatasource(() => ({ data: rows(11) }));
    const run = await runQueryTool(aggQuery({ limit: 10 }), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("result_too_large");
    const payload = payloadOf(run.result);
    expect(payload.error).toBe("result_too_large");
    expect(payload.data).toBeUndefined();
    expect((payload.remedies as string[]).length).toBeGreaterThan(0);
  });

  // The two causes of an overflow need opposite advice, and the query itself
  // says which one is in play.
  const remediesFor = async (extra: Record<string, unknown>) => {
    const { ds } = fakeDatasource(() => ({ data: rows(11) }));
    const run = await runQueryTool(aggQuery({ limit: 10, ...extra }), {
      readTelemetryDatasource: ds,
    });
    return (payloadOf(run.result).remedies as string[]) ?? [];
  };

  it("says nothing about granularity for a summary query, which has none", async () => {
    const remedies = await remediesFor({ dimensions: ["SpanName"] });
    expect(remedies.join(" ")).not.toMatch(/granularity/);
    expect(remedies[0]).toMatch(/Raise `limit`/);
    expect(remedies[1]).toMatch(/fewer dimensions/);
  });

  it("leads with granularity when the buckets alone exceed the cap", async () => {
    const remedies = await remediesFor({
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "timeSeries", granularity: "1s" },
    });
    // 3,601 buckets against a limit of 10: no amount of regrouping helps.
    // A relative window ends at the clock reading taken when the query runs,
    // so it lands on a boundary only by chance — the count carries the extra
    // bucket that an unaligned window touches.
    expect(remedies.find((r) => /granularity/.test(r))).toMatch(
      /3,601 buckets/
    );
    expect(remedies.join(" ")).not.toMatch(/fewer dimensions/);
  });

  // Both backends bucket on fixed boundaries — `(ts / g) * g` in SQLite,
  // `toStartOfInterval(ts, INTERVAL n SECOND)` in ClickHouse — so the count is
  // how many boundaries the half-open window touches, not how many whole
  // granularities fit inside it.
  it("counts the boundaries an unaligned window touches, not the whole spans", async () => {
    const remedies = await remediesFor({
      timeDimension: {
        type: "absolute",
        startTime: "2026-01-01T00:02:30.000Z",
        endTime: "2026-01-01T01:02:30.000Z",
      },
      output: { type: "timeSeries", granularity: "5m" },
    });
    // 00:00 through 01:00 inclusive: twelve whole 5m spans, thirteen buckets.
    expect(remedies.find((r) => /granularity/.test(r))).toMatch(/13 buckets/);
  });

  it("counts an aligned window exactly, without an edge bucket", async () => {
    const remedies = await remediesFor({
      timeDimension: {
        type: "absolute",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T01:00:00.000Z",
      },
      output: { type: "timeSeries", granularity: "5m" },
    });
    // The window ends exactly on a boundary, and `< end` excludes it.
    expect(remedies.find((r) => /granularity/.test(r))).toMatch(/12 buckets/);
  });

  it("treats a one-bucket time series as a time series, not a summary", async () => {
    // Classified from the bucket count, a 30-second window at `5m` came out as
    // a summary: the `output: {type: "summary"}` remedy — the one that always
    // works on a time series — was dropped, and the query was described as
    // having no granularity when it has one.
    const remedies = await remediesFor({
      dimensions: ["SpanName"],
      timeDimension: {
        type: "absolute",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:30.000Z",
      },
      output: { type: "timeSeries", granularity: "5m" },
    });
    expect(remedies.join(" ")).toMatch(/type: "summary"/);
    expect(remedies.join(" ")).toMatch(/fewer dimensions/);
    // Nothing for a coarser granularity to merge, so the line is left out
    // rather than reading "spans up to 1 buckets".
    expect(remedies.join(" ")).not.toMatch(/coarser `granularity`/);
  });

  it("offers a summary to an ungrouped time series as well", async () => {
    const remedies = await remediesFor({
      timeDimension: { type: "relative", lookback: "2h" },
      output: { type: "timeSeries", granularity: "1m" },
    });
    expect(remedies.join(" ")).toMatch(/type: "summary"/);
  });

  it("leads with grouping when the buckets fit and the groups do not", async () => {
    const remedies = await remediesFor({
      dimensions: ["SpanName"],
      timeDimension: { type: "relative", lookback: "1h" },
      output: { type: "timeSeries", granularity: "10m" },
    });
    const groupsAt = remedies.findIndex((r) => /fewer dimensions/.test(r));
    const granularityAt = remedies.findIndex((r) => /granularity/.test(r));
    expect(groupsAt).toBeGreaterThanOrEqual(0);
    expect(granularityAt).toBeGreaterThan(groupsAt);
  });

  // An ordering makes truncation well defined, and it is still refused: a page
  // cannot act on a remedy, so a partial result would be drawn as the whole
  // set. Refusing is what makes ADR-059's "never draw a partial chart" hold
  // without every page having to check a flag.
  it("refuses an ordered overflow too, rather than truncating", async () => {
    const { ds } = fakeDatasource(() => ({ data: rows(11) }));
    const run = await runQueryTool(
      aggQuery({
        limit: 10,
        orderBy: [{ type: "measure", alias: "c", direction: "desc" }],
      }),
      { readTelemetryDatasource: ds }
    );
    expect(run.outcome).toBe("result_too_large");
    const payload = payloadOf(run.result);
    expect(payload.data).toBeUndefined();
    expect(payload.truncated).toBeUndefined();
  });

  it("never suggests adding an `orderBy`, which would not help", async () => {
    const { ds } = fakeDatasource(() => ({ data: rows(11) }));
    const run = await runQueryTool(aggQuery({ limit: 10 }), {
      readTelemetryDatasource: ds,
    });
    expect((payloadOf(run.result).remedies as string[]).join(" ")).not.toMatch(
      /orderBy/
    );
  });

  it("offers a higher limit only when there is headroom below the cap", async () => {
    const { ds } = fakeDatasource(() => ({
      data: rows(LIMITS.aggregate.max + 1),
    }));

    const withRoom = await runQueryTool(aggQuery({ limit: 10 }), {
      readTelemetryDatasource: ds,
    });
    expect((payloadOf(withRoom.result).remedies as string[]).join(" ")).toMatch(
      /Raise `limit`/
    );

    const atCap = await runQueryTool(
      aggQuery({ limit: LIMITS.aggregate.max }),
      { readTelemetryDatasource: ds }
    );
    expect(
      (payloadOf(atCap.result).remedies as string[]).join(" ")
    ).not.toMatch(/Raise `limit`/);
  });
});

describe("runQueryTool — size ceiling", () => {
  it("refuses a result that serializes above the ceiling, returning no rows", async () => {
    const fat = { pad: "x".repeat(MAX_RESULT_CHARACTERS + 1) };
    const { ds } = fakeDatasource(() => ({ data: [fat] }));
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("result_too_large");
    const payload = payloadOf(run.result);
    expect(payload.data).toBeUndefined();
    expect((payload.remedies as string[]).length).toBeGreaterThan(0);
  });

  it("passes a result just under the ceiling through untouched", async () => {
    const snug = { pad: "x".repeat(MAX_RESULT_CHARACTERS - 100) };
    const { ds } = fakeDatasource(() => ({ data: [snug], nextCursor: null }));
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("ok");
    expect(payloadOf(run.result).data).toEqual([snug]);
  });
});

describe("runQueryTool — upstream errors", () => {
  it("maps a KopaiQueryValidationError to invalid_input with its message", async () => {
    const { ds } = fakeDatasource(() => {
      throw new kopaiQueryCompiler.KopaiQueryValidationError("bad column Foo");
    });
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("invalid_input");
    expect(payloadOf(run.result).message).toBe("bad column Foo");
  });

  it("maps an unrecognised error to upstream_error and leaks nothing", async () => {
    const { ds } = fakeDatasource(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.4:9000 clickhouse-prod");
    });
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
    });
    expect(run.outcome).toBe("upstream_error");
    const text = run.result.content[0]?.text ?? "";
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.4|clickhouse-prod/);
  });
});

describe("the result carries the payload in both channels", () => {
  it("does so on success", async () => {
    const { ds } = fakeDatasource(() => ({ data: rows(2), nextCursor: null }));
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
    });
    expect(run.result.structuredContent).toEqual({
      data: rows(2),
      nextCursor: null,
    });
    expect(JSON.parse(run.result.content[0]?.text ?? "")).toEqual(
      run.result.structuredContent
    );
  });

  it("does so on failure, where the agent has no structured fallback", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const run = await runQueryTool(
      { query: { signal: "nope" } },
      {
        readTelemetryDatasource: ds,
      }
    );
    expect(run.result.isError).toBe(true);
    expect(JSON.parse(run.result.content[0]?.text ?? "")).toEqual(
      run.result.structuredContent
    );
  });

  it("serializes the error code first, so the payload opens with it", async () => {
    const { ds } = fakeDatasource(() => ({ data: [] }));
    const run = await runQueryTool(
      { query: { signal: "nope" } },
      {
        readTelemetryDatasource: ds,
      }
    );
    expect(run.result.content[0]?.text.startsWith('{"error":')).toBe(true);
  });
});

describe("runMetricsDiscoverTool", () => {
  it("returns the discovery payload and counts the metrics", async () => {
    const discovery = {
      metrics: [
        {
          name: "http.server.duration",
          type: "Histogram",
          attributes: {},
          resourceAttributes: {},
        },
      ],
    };
    const { ds } = fakeDatasource(
      () => ({ data: [] }),
      () => discovery
    );
    const run = await runMetricsDiscoverTool({ readTelemetryDatasource: ds });
    expect(run.outcome).toBe("ok");
    expect(run.rowCount).toBe(1);
    expect(run.result.structuredContent).toEqual(discovery);
    expect(JSON.parse(run.result.content[0]?.text ?? "")).toEqual(discovery);
  });

  it("writes the cause to the log the caller never sees", async () => {
    // The caller is told only "The query could not be completed.", which is
    // all a model can act on. Until this, that was also all anyone got: a
    // datasource refusing connections left no line for whoever runs the
    // server, in a product whose purpose is making failures visible.
    const logged: { payload: unknown; message?: string }[] = [];
    const boom = new Error("connect ECONNREFUSED 127.0.0.1:8123");
    const { ds } = fakeDatasource(() => {
      throw boom;
    });
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
      logger: {
        error: (payload, message) => logged.push({ payload, message }),
      },
    });
    expect(run.outcome).toBe("upstream_error");
    expect(payloadOf(run.result).message).toBe(
      "The query could not be completed."
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.payload).toBe(boom);
  });

  it("does not log a validation error, which is reported back in full", async () => {
    // A backend rejecting a query the shared gate allowed — a percentile on
    // SQLite, say — reaches the same converter. It is the caller's mistake,
    // answered in the result; logging every one would bury the outages this
    // log exists for.
    const logged: unknown[] = [];
    const { ds } = fakeDatasource(() => {
      throw new kopaiQueryCompiler.KopaiQueryValidationError("bad column Foo");
    });
    const run = await runQueryTool(rawQuery(), {
      readTelemetryDatasource: ds,
      logger: { error: (payload) => logged.push(payload) },
    });
    expect(run.outcome).toBe("invalid_input");
    expect(payloadOf(run.result).message).toBe("bad column Foo");
    expect(logged).toEqual([]);
  });

  it("maps a failure to upstream_error", async () => {
    const { ds } = fakeDatasource(
      () => ({ data: [] }),
      () => {
        throw new Error("boom");
      }
    );
    const run = await runMetricsDiscoverTool({ readTelemetryDatasource: ds });
    expect(run.outcome).toBe("upstream_error");
  });

  /** A listing of `count` metrics, each with `keys` attribute keys of `values`. */
  const listing = (count: number, keys: number, values: number) => ({
    metrics: Array.from({ length: count }, (_, m) => ({
      name: `metric.number.${m}.with.a.reasonably.long.name`,
      type: "Gauge",
      unit: "1",
      description: "A metric that exists in this workspace.",
      attributes: {
        values: Object.fromEntries(
          Array.from({ length: keys }, (_, k) => [
            `attribute.key.${k}`,
            Array.from({ length: values }, (_, v) =>
              `value-${v}`.padEnd(40, "x")
            ),
          ])
        ),
      },
      resourceAttributes: { values: { "service.name": ["checkout"] } },
    })),
  });

  const discoverWith = async (result: unknown) => {
    const { ds } = fakeDatasource(
      () => ({ data: [] }),
      () => result
    );
    const run = await runMetricsDiscoverTool({ readTelemetryDatasource: ds });
    return { run, payload: payloadOf(run.result) };
  };

  // A caller cannot shrink this result — the tool takes no arguments — so
  // refusing it left them unable to learn a metric name, which the `query`
  // tool's description tells them to do first.
  it("drops attribute values rather than refusing an over-size listing", async () => {
    const { run, payload } = await discoverWith(listing(40, 20, 60));
    expect(run.outcome).toBe("ok");
    expect(run.rowCount).toBe(40);
    expect(payload.omitted).toBe("attributeValues");
    const first = (payload.metrics as Record<string, unknown>[])[0];
    expect(first?.name).toBe("metric.number.0.with.a.reasonably.long.name");
    expect(first?.attributeKeys).toHaveLength(20);
    expect(first).not.toHaveProperty("attributes");
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
      MAX_RESULT_CHARACTERS
    );
  });

  it("drops the attributes too when the keys alone do not fit", async () => {
    const { run, payload } = await discoverWith(listing(900, 30, 40));
    expect(run.outcome).toBe("ok");
    expect(payload.omitted).toBe("attributes");
    const first = (payload.metrics as Record<string, unknown>[])[0];
    expect(first).toEqual({
      name: "metric.number.0.with.a.reasonably.long.name",
      type: "Gauge",
      unit: "1",
      description: "A metric that exists in this workspace.",
    });
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(
      MAX_RESULT_CHARACTERS
    );
  });

  it("returns the listing untouched when it fits", async () => {
    const full = listing(5, 3, 4);
    const { run, payload } = await discoverWith(full);
    expect(run.outcome).toBe("ok");
    expect(payload).toEqual(full);
    expect(payload).not.toHaveProperty("omitted");
  });

  it("refuses only when the names alone overrun, and names real remedies", async () => {
    const { run, payload } = await discoverWith(listing(3000, 2, 2));
    expect(run.outcome).toBe("result_too_large");
    expect(payload.message).toMatch(/3,000 metrics/);
    // Every remedy must name something this tool's caller can actually do:
    // it takes no arguments, so no `limit`, window or `granularity`.
    const remedies = (payload.remedies as string[]).join(" ");
    expect(remedies).not.toMatch(/`limit`|granularity|time window/);
    expect(remedies).toMatch(/`query` tool/);
  });
});
