/// <reference types="vitest/globals" />
import { KopaiQuery } from "./kopai-query.js";

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

  it("3. gt rejects a string value with a path-precise error", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({ column: "Duration", op: "gt", value: "5" })
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    // KopaiQuery is a top-level z.union — leaf issues are nested inside
    // `errors`. Flatten and look for any issue at path ending in "value"
    // with "number" in the message — proof the discriminator wired
    // through to the leaf and produced a typed error.
    const matching = collectIssues(r.error.issues).find(
      (i) => lastPath(i) === "value" && /number/i.test(i.message)
    );
    expect(matching).toBeDefined();
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

  it("5b. in accepts a non-empty values array of string|number", () => {
    const r = KopaiQuery.safeParse(
      tracesAggWithFilter({
        column: "SpanName",
        op: "in",
        values: ["a", 1, "b"],
      })
    );
    expect(r.success).toBe(true);
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
