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
    expect((payload.remedies as string[]).join(" ")).toMatch(/granularity/);
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
});
