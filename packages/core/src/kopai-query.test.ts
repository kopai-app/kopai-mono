/// <reference types="vitest/globals" />
import { expectTypeOf } from "vitest";
import {
  KopaiQuery,
  assertColumnPartition,
  durationStringToNanos,
  isDurationString,
} from "./kopai-query.js";
import type {
  AggregateResultFor,
  KopaiAggregateRow,
  KopaiQueryResult,
  TraceAggregateQuery,
  TraceRawQuery,
} from "./kopai-query.js";

// Helper: minimal valid TimeDimension used across cases.
const tdRelative = { type: "relative" as const, lookback: "1h" };

// Helper: Zod v4 nests union-branch errors under `errors`. Flatten so
// tests can hunt for path-precise leaf issues across all branches.
type Issue = {
  path: PropertyKey[];
  message: string;
  errors?: Issue[][];
};
function isIssue(v: unknown): v is Issue {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { path?: unknown; message?: unknown };
  return Array.isArray(o.path) && typeof o.message === "string";
}
function collectIssues(issues: readonly unknown[]): Issue[] {
  const out: Issue[] = [];
  const walk = (list: readonly unknown[]) => {
    for (const raw of list) {
      if (!isIssue(raw)) continue;
      out.push(raw);
      if (raw.errors) for (const branch of raw.errors) walk(branch);
    }
  };
  walk(issues);
  return out;
}
function lastPath(i: Issue): PropertyKey | undefined {
  return i.path[i.path.length - 1];
}

// Helper: minimal valid aggregate-mode skeleton for traces, parametrised by
// the filter under test. Keeps each case to a single filter so we can
// assert error paths precisely.
const tracesAggWithFilter = (filter: unknown) => ({
  signal: "traces" as const,
  mode: "aggregate" as const,
  measures: [{ op: "COUNT" as const, as: "n" }],
  timeDimension: tdRelative,
  output: { type: "summary" as const },
  filters: [filter],
});

describe("KopaiQuery schema — FilterExpr op-discriminated leaves", () => {
  it("1. parses a new-shape eq leaf (no kind tag)", () => {
    const q = tracesAggWithFilter({
      column: "SpanName",
      op: "eq",
      value: "GET /",
    });
    const r = KopaiQuery.safeParse(q);
    expect(r.success).toBe(true);
  });

  it("2. eq/neq accept string, number, and boolean values", () => {
    for (const value of ["x", 42, true] as const) {
      const r = KopaiQuery.safeParse(
        tracesAggWithFilter({ column: "SpanName", op: "eq", value })
      );
      expect(r.success).toBe(true);

      const r2 = KopaiQuery.safeParse(
        tracesAggWithFilter({ column: "SpanName", op: "neq", value })
      );
      expect(r2.success).toBe(true);
    }
  });

  it("3. gt rejects a non-duration string value with a path-precise error", () => {
    // The gt/gte/lt/lte value is `number | DurationString`, so a
    // bare "5" (no unit) fails BOTH branches. Flattened issues then carry the
    // "value" path on the union node and the "expected number" message on the
    // nested number branch. Assert both signals are present.
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "Duration", op: "gt", value: "5" })
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const issues = collectIssues(r.error.issues);
    // The leaf union for `value` is reported at path ending in "value".
    expect(issues.some((i) => lastPath(i) === "value")).toBe(true);
    // The number branch rejected the string — proof the typed comparison
    // value wired through to the leaf.
    expect(issues.some((i) => /expected number/i.test(i.message))).toBe(true);
  });

  it("4. contains rejects a number value at filters[0].value", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "Body", op: "contains", value: 5 })
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const matching = collectIssues(r.error.issues).find(
      (i) => lastPath(i) === "value" && /string/i.test(i.message)
    );
    expect(matching).toBeDefined();
  });

  it("5. in requires non-empty values array", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "SpanName", op: "in", values: [] })
    );
    expect(r.success).toBe(false);
  });

  it("5b. in accepts a non-empty homogeneous string values array", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        column: "SpanName",
        op: "in",
        values: ["a", "b"],
      })
    );
    expect(r.success).toBe(true);
  });

  it("5c. in accepts a non-empty homogeneous number values array", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        column: "Duration",
        op: "in",
        values: [1, 2, 3],
      })
    );
    expect(r.success).toBe(true);
  });

  it("5d. in rejects a mixed string+number values array (M2)", () => {
    // Mixed arrays bound to ClickHouse as a single typed Array() param fail
    // at execution (500) and behave differently on SQLite — reject upfront.
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        column: "SpanName",
        op: "in",
        values: ["a", 1, "b"],
      })
    );
    expect(r.success).toBe(false);
  });

  it("6. isNull / isNotNull accept no value field", () => {
    const r1 = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "ParentSpanId", op: "isNull" })
    );
    expect(r1.success).toBe(true);

    const r2 = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "ParentSpanId", op: "isNotNull" })
    );
    expect(r2.success).toBe(true);
  });

  it("7. logical and/or shapes parse recursively", () => {
    const leafA = {
      column: "SpanName" as const,
      op: "eq" as const,
      value: "a",
    };
    const leafB = {
      column: "SpanName" as const,
      op: "eq" as const,
      value: "b",
    };
    const leafC = { column: "Duration" as const, op: "gt" as const, value: 10 };
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        and: [{ or: [leafA, leafB] }, leafC],
      })
    );
    expect(r.success).toBe(true);
  });

  it("8. old kind-tagged shape no longer carries the kind field", () => {
    // Zod v4 z.object defaults to strip — extra `kind` is silently dropped.
    // Confirm the parsed result is the new shape (no `kind`), so any old
    // caller payload still round-trips but loses the dead discriminator.
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        kind: "string",
        column: "SpanName",
        op: "eq",
        value: "x",
      })
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Round-trip through JSON to drop the strict KopaiQuery typing and
    // probe for a `kind` field that should no longer be present on the
    // parsed leaf. Avoids casting and exercises the actual on-the-wire
    // shape.
    const parsed: unknown = JSON.parse(JSON.stringify(r.data));
    expect(parsed).toMatchObject({
      filters: [{ column: "SpanName", op: "eq", value: "x" }],
    });
    expect(parsed).not.toHaveProperty(["filters", 0, "kind"]);
  });

  it("8b. mismatched old kind (kind:'string' with op:'in') is rejected because values is missing", () => {
    // Stripping `kind` exposes the leaf as `{ column, op:'in', value:'x' }`
    // which fails the `in/notIn` shape that requires `values`.
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        kind: "string",
        column: "SpanName",
        op: "in",
        value: "x",
      })
    );
    expect(r.success).toBe(false);
  });
});

describe("KopaiQuery schema — TimeDimension.compareOffset removed", () => {
  it("9a. relative compareOffset is stripped (not present on parsed query)", () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: { type: "relative", lookback: "2h", compareOffset: "7d" },
      output: { type: "summary" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    // JSON round-trip removes the strict KopaiQuery union typing so we
    // can probe for a field that should no longer exist after parsing.
    const parsed: unknown = JSON.parse(JSON.stringify(r.data));
    expect(parsed).not.toHaveProperty(["timeDimension", "compareOffset"]);
  });

  it("9b. absolute compareOffset is stripped", () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T01:00:00.000Z",
        compareOffset: "1d",
      },
      output: { type: "summary" },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const parsed: unknown = JSON.parse(JSON.stringify(r.data));
    expect(parsed).not.toHaveProperty(["timeDimension", "compareOffset"]);
  });
});

describe("KopaiQuery schema — raw mode dimensions optional", () => {
  it("10a. raw traces parses without dimensions", () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const parsed: unknown = JSON.parse(JSON.stringify(r.data));
    expect(parsed).not.toHaveProperty("dimensions");
  });

  it("10b. raw logs parses without dimensions", () => {
    const r = KopaiQuery.safeParse({
      signal: "logs",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(r.success).toBe(true);
  });

  it("10c. raw metrics parses without dimensions", () => {
    const r = KopaiQuery.safeParse({
      signal: "metrics",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(r.success).toBe(true);
  });

  it("10d. raw traces still parses with explicit dimensions array", () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanId", "SpanName"],
      timeDimension: tdRelative,
    });
    expect(r.success).toBe(true);
  });
});

describe("DurationString — rejects zero at schema level", () => {
  // The compiler rejects "0s" but the schema regex was \d+, which also
  // accepted "0s"/"0h"/etc. — letting a schema-validated query reach the
  // compiler only to fail there. Tighten the schema so the two layers
  // agree on what counts as a valid duration.
  it('rejects lookback "0s" at schema parse', () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "relative", lookback: "0s" },
    });
    expect(r.success).toBe(false);
  });

  it('rejects granularity "0m" at schema parse', () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: tdRelative,
      output: { type: "timeSeries", granularity: "0m" },
    });
    expect(r.success).toBe(false);
  });

  it("still accepts positive durations", () => {
    const r = KopaiQuery.safeParse({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "relative", lookback: "1h" },
    });
    expect(r.success).toBe(true);
  });
});

describe("durationStringToNanos — human-duration normalization", () => {
  // The core schema keeps gt/gte/lt/lte values as numbers (JSON-Schema-safe);
  // the SDK builder uses this helper to normalize human durations to ns before
  // building. A non-duration string passes through so the numeric schema can
  // surface a clear error.
  it("converts each unit to nanoseconds", () => {
    expect(durationStringToNanos("1s")).toBe(1_000_000_000);
    expect(durationStringToNanos("30m")).toBe(30 * 60 * 1_000_000_000);
    expect(durationStringToNanos("2h")).toBe(2 * 60 * 60 * 1_000_000_000);
    expect(durationStringToNanos("7d")).toBe(7 * 24 * 60 * 60 * 1_000_000_000);
    expect(durationStringToNanos("1w")).toBe(7 * 24 * 60 * 60 * 1_000_000_000);
  });

  it("passes a non-duration string through unchanged", () => {
    expect(durationStringToNanos("nope")).toBe("nope");
    expect(durationStringToNanos("5")).toBe("5"); // no unit
  });

  it("isDurationString recognizes valid/invalid forms", () => {
    expect(isDurationString("1s")).toBe(true);
    expect(isDurationString("250ms")).toBe(false); // ms not supported
    expect(isDurationString("0s")).toBe(false);
    expect(isDurationString("abc")).toBe(false);
  });
});

describe("assertColumnPartition — drift detector XOR contract (L8)", () => {
  it("accepts a clean partition (every key in exactly one set)", () => {
    expect(() =>
      assertColumnPartition("t", ["A", "B", "C"], ["A", "B"], new Set(["C"]))
    ).not.toThrow();
  });

  it("throws when a schema key is in neither set (unaccounted)", () => {
    expect(() =>
      assertColumnPartition("t", ["A", "B", "C"], ["A"], new Set(["B"]))
    ).toThrow(/unaccounted/);
  });

  it("throws when STRUCTURAL has a key absent from the schema (stale)", () => {
    expect(() =>
      assertColumnPartition("t", ["A"], ["A", "Z"], new Set())
    ).toThrow(/stale/);
  });

  it("throws when a key is in BOTH structural and excluded (XOR violated)", () => {
    // "A" is listed as both structural and excluded — the documented XOR
    // forbids this, but the original implementation only caught the
    // 'neither' case.
    expect(() =>
      assertColumnPartition("t", ["A", "B"], ["A"], new Set(["A", "B"]))
    ).toThrow(/both|BOTH|XOR/);
  });
});

describe("KopaiQuery schema — sanity round-trip", () => {
  it("11. full aggregate query with every optional field round-trips", () => {
    const q = {
      signal: "traces" as const,
      mode: "aggregate" as const,
      measures: [
        { op: "COUNT" as const, as: "n" },
        { op: "P95" as const, column: "Duration", as: "p95" },
      ],
      dimensions: ["SpanName" as const],
      filters: [
        { column: "SpanName" as const, op: "eq" as const, value: "GET /" },
        {
          and: [
            { column: "Duration" as const, op: "gt" as const, value: 100 },
            { column: "Duration" as const, op: "lt" as const, value: 10_000 },
          ],
        },
      ],
      havings: [{ measure: "n", op: "gt" as const, value: 0 }],
      timeDimension: tdRelative,
      orderBy: [
        { type: "measure" as const, alias: "n", direction: "desc" as const },
      ],
      output: {
        type: "timeSeries" as const,
        granularity: "5m",
      },
      limit: 100,
    };
    const r = KopaiQuery.safeParse(q);
    expect(r.success).toBe(true);
  });
});

// ============================================================
// KopaiQueryResult resolves the aggregate `output` union
// instead of collapsing to `never`.
// ============================================================
// A built aggregate query's `output` is the union
// `{type:"summary"} | {type:"timeSeries";…}`. The previous conditional
// discriminated on `output.type` literals *outside* the aggregate guard,
// so a union `output` matched neither branch and fell through to `never`.
// Now `Q extends { mode: "aggregate" }` is checked first, then the
// summary/timeSeries shapes are folded together via the (summary ∪ extra
// bucket_start) union — so `.data` is always usable.
describe("KopaiQueryResult — aggregate output union", () => {
  it("type-only: aggregate query resolves to an aggregate-row data shape (not never)", () => {
    // A whole TraceAggregateQuery has a union `output`. The result must
    // expose `.data` as an array of aggregate rows (possibly carrying the
    // extra timeSeries `bucket_start`), never `never`.
    type R = KopaiQueryResult<TraceAggregateQuery>;
    expectTypeOf<R>().toMatchTypeOf<{
      data: KopaiAggregateRow[];
    }>();
    // `.data` must be indexable — would error if R were `never`.
    expectTypeOf<R["data"]>().toMatchTypeOf<KopaiAggregateRow[]>();

    // summary-narrowed → plain aggregate rows.
    type Summary = TraceAggregateQuery & { output: { type: "summary" } };
    expectTypeOf<KopaiQueryResult<Summary>>().toEqualTypeOf<{
      data: KopaiAggregateRow[];
    }>();

    // timeSeries-narrowed → rows carry `bucket_start`.
    type TS = TraceAggregateQuery & { output: { type: "timeSeries" } };
    expectTypeOf<KopaiQueryResult<TS>>().toEqualTypeOf<{
      data: (KopaiAggregateRow & { bucket_start: string })[];
    }>();

    expect(true).toBe(true);
  });

  it("type-only: raw query keeps { data; nextCursor } (unchanged)", () => {
    type R = KopaiQueryResult<TraceRawQuery>;
    expectTypeOf<R>().toMatchTypeOf<{ nextCursor: string | null }>();
    expect(true).toBe(true);
  });
});

// ============================================================
// AggregateResultFor reads the SDK builder's `__aggRow`
// phantom so rows are fully typed (measure aliases → number,
// dimensions → string|number|null), with a KopaiAggregateRow fallback.
// ============================================================
describe("AggregateResultFor — `__aggRow` phantom row typing", () => {
  it("type-only: a branded summary query yields per-alias/dimension row types", () => {
    type Branded = {
      output: { type: "summary" };
      __aggRow?: { er: number; n: number } & {
        "service.name": string | number | null;
      };
    };
    type R = AggregateResultFor<Branded>;
    expectTypeOf<R>().toEqualTypeOf<{
      data: ({ er: number; n: number } & {
        "service.name": string | number | null;
      })[];
    }>();
    // Field-level: measure alias is exactly `number`.
    expectTypeOf<R["data"][number]["er"]>().toEqualTypeOf<number>();
    // Dimension stays wide.
    expectTypeOf<R["data"][number]["service.name"]>().toEqualTypeOf<
      string | number | null
    >();
    expect(true).toBe(true);
  });

  it("type-only: a branded timeSeries query adds bucket_start: string", () => {
    type Branded = {
      output: { type: "timeSeries" };
      __aggRow?: { v: number };
    };
    type R = AggregateResultFor<Branded>;
    expectTypeOf<R["data"][number]["v"]>().toEqualTypeOf<number>();
    expectTypeOf<R["data"][number]["bucket_start"]>().toEqualTypeOf<string>();
    expect(true).toBe(true);
  });

  it("type-only: an un-branded aggregate query falls back to KopaiAggregateRow", () => {
    // No `__aggRow` key → inference yields `unknown`, which the guard
    // rejects, so the row stays the wide KopaiAggregateRow (non-breaking).
    type Summary = TraceAggregateQuery & { output: { type: "summary" } };
    expectTypeOf<AggregateResultFor<Summary>>().toEqualTypeOf<{
      data: KopaiAggregateRow[];
    }>();
    type TS = TraceAggregateQuery & { output: { type: "timeSeries" } };
    expectTypeOf<AggregateResultFor<TS>>().toEqualTypeOf<{
      data: (KopaiAggregateRow & { bucket_start: string })[];
    }>();
    expect(true).toBe(true);
  });
});
