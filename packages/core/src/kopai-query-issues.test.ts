/// <reference types="vitest/globals" />
import { parseKopaiQuery } from "./kopai-query-compiler.js";

const td = { type: "relative" as const, lookback: "1h" };

function issuesFor(query: unknown): { path: string; message: string }[] {
  const result = parseKopaiQuery(query);
  if (result.ok) throw new Error("expected the query to be rejected");
  return result.issues;
}

const aggregate = (extra: Record<string, unknown> = {}) => ({
  signal: "traces",
  mode: "aggregate",
  measures: [{ op: "COUNT", as: "c" }],
  timeDimension: td,
  output: { type: "summary" },
  ...extra,
});

describe("union issues name the field, not the union", () => {
  it("reaches into a measure and names the column", () => {
    const issues = issuesFor(
      aggregate({ measures: [{ op: "AVG", column: "NoSuchColumn", as: "x" }] })
    );
    expect(issues.map((i) => i.path)).toEqual(["measures.0.column"]);
    expect(issues[0]?.message).toContain("NoSuchColumn");
  });

  it("names a bad dimension rather than reporting the array element", () => {
    const issues = issuesFor(aggregate({ dimensions: ["NoSuchColumn"] }));
    expect(issues.map((i) => i.path)).toEqual(["dimensions.0"]);
    expect(issues[0]?.message).not.toBe("Invalid input");
  });

  it("descends through the self-referential filter schema", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "notAnOperator", value: "x" }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.op"]);
  });
});

describe("near misses are suggested", () => {
  // The two mistakes that cost real time while this package was being built.
  it('suggests "service.name" for "ServiceName"', () => {
    const issues = issuesFor(aggregate({ dimensions: ["ServiceName"] }));
    expect(issues[0]?.message).toContain('Did you mean "service.name"?');
  });

  it('suggests "COUNT" for a lower-cased "count"', () => {
    const issues = issuesFor(
      aggregate({ measures: [{ op: "count", as: "c" }] })
    );
    expect(issues.map((i) => i.path)).toEqual(["measures.0.op"]);
    expect(issues[0]?.message).toContain('Did you mean "COUNT"?');
  });

  it("says nothing about a near miss when there is none", () => {
    const issues = issuesFor(aggregate({ dimensions: ["NoSuchColumn"] }));
    expect(issues[0]?.message).not.toContain("Did you mean");
  });
});

describe("what a union accepts", () => {
  it("lists every variant's operator, not one variant's slice", () => {
    const issues = issuesFor(
      aggregate({ measures: [{ op: "MEDIAN", column: "Duration", as: "x" }] })
    );
    expect(issues.map((i) => i.path)).toEqual(["measures.0.op"]);
    // COUNT lives on a different variant from the numeric operators; a caller
    // told only about one of the two would be misled about what exists.
    expect(issues[0]?.message).toContain("COUNT");
    expect(issues[0]?.message).toContain("AVG");
  });

  it("samples a long enum rather than printing all 132 columns", () => {
    const issues = issuesFor(aggregate({ dimensions: ["NoSuchColumn"] }));
    const message = issues[0]?.message ?? "";
    expect(message).toMatch(/and \d+ others/);
    expect(message.length).toBeLessThan(400);
  });

  it("points at the attribute-reference escape hatch for an unknown column", () => {
    const issues = issuesFor(aggregate({ dimensions: ["NoSuchColumn"] }));
    expect(issues[0]?.message).toContain("{ container, key }");
  });
});

describe("issues that were already clear are left alone", () => {
  it.each([
    [
      "a bad lookback",
      {
        signal: "traces",
        mode: "raw",
        timeDimension: { type: "relative", lookback: "1 hour" },
      },
      "timeDimension.lookback",
      /positive integer/,
    ],
    [
      "a limit above the schema cap",
      { signal: "traces", mode: "raw", timeDimension: td, limit: 999999 },
      "limit",
      /Too big/,
    ],
    [
      "a missing time dimension",
      { signal: "traces", mode: "raw" },
      "timeDimension",
      /expected object/,
    ],
  ])("passes %s through unchanged", (_label, query, path, pattern) => {
    const issues = issuesFor(query);
    expect(issues.map((i) => i.path)).toEqual([path]);
    expect(issues[0]?.message).toMatch(pattern as RegExp);
  });
});

describe("acceptance is unchanged", () => {
  // The explainer rewrites message text and issue paths. It must never change
  // what parses.
  it("still accepts a valid query of each mode", () => {
    expect(parseKopaiQuery(aggregate()).ok).toBe(true);
    expect(
      parseKopaiQuery({ signal: "traces", mode: "raw", timeDimension: td }).ok
    ).toBe(true);
  });
});
