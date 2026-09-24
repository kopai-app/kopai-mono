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

  // The leaf and the `and`/`or` wrappers are siblings in the same union, and a
  // wrapper rejects any leaf with a single "expected array" issue. Counting
  // issues alone therefore hands a two-mistake leaf to the wrapper, and the
  // caller is told to add an `and` array they never meant to write.
  it("keeps a leaf filter with two mistakes out of the `and` wrapper", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "NoSuchColumn", op: "eq", value: {} }],
    });
    expect(issues.map((i) => i.path)).toEqual([
      "filters.0.column",
      "filters.0.value",
    ]);
    // Both paths used to carry a bare "Invalid input", which is the message
    // this module exists to replace — so the paths alone are not the contract.
    expect(issues[0]?.message).toContain("NoSuchColumn");
    expect(issues[1]?.message).toMatch(/expected string, received object/);
  });

  it("descends through the self-referential filter schema", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "notAnOperator", value: "x" }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.op"]);
    expect(issues[0]?.message).toMatch(/Expected one of "eq", "neq"/);
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

describe("a discriminator mismatch is explained, not passed through", () => {
  // zod reports these at the discriminator itself — `filters.0.op`, not
  // `filters.0` — so stopping at the union left the one field a caller is most
  // likely to get wrong with zod's own "Invalid discriminator value" text.
  it("suggests the operator a filter leaf was reaching for", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "EQ", value: "x" }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.op"]);
    expect(issues[0]?.message).toBe('Unknown value "EQ". Did you mean "eq"?');
  });

  it.each([
    [
      "orderBy.type",
      {
        orderBy: [{ type: "column", column: "SpanName", direction: "asc" }],
        dimensions: ["SpanName"],
      },
      "orderBy.0.type",
      /Unknown value "column"\. Expected one of "dimension", "measure"\./,
    ],
    [
      "an enum inside a member",
      {
        orderBy: [{ type: "dimension", column: "SpanName", direction: "ASC" }],
        dimensions: ["SpanName"],
      },
      "orderBy.0.direction",
      /Did you mean "asc"\?/,
    ],
    [
      "output.type",
      { output: { type: "TimeSeries", granularity: "5m" } },
      "output.type",
      /Did you mean "timeSeries"\?/,
    ],
  ])("explains %s", (_label, extra, path, pattern) => {
    const issues = issuesFor(aggregate(extra as Record<string, unknown>));
    expect(issues.map((i) => i.path)).toEqual([path]);
    expect(issues[0]?.message).toMatch(pattern as RegExp);
  });

  it("explains timeDimension.type", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "Relative", lookback: "1h" },
    });
    expect(issues.map((i) => i.path)).toEqual(["timeDimension.type"]);
    expect(issues[0]?.message).toMatch(/Did you mean "relative"\?/);
  });

  it("reaches a field two unions deep", () => {
    // `filters.0` is a union, its leaf set is another, and the container enum
    // sits inside an object below both.
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [
        { column: { container: "spanattributes", key: "x" }, op: "isNull" },
      ],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.column.container"]);
    expect(issues[0]?.message).toMatch(/Did you mean "SpanAttributes"\?/);
  });

  it("explains a leaf inside an and/or wrapper", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ and: [{ column: "SpanName", op: "EQ", value: "x" }] }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.and.0.op"]);
    expect(issues[0]?.message).toMatch(/Did you mean "eq"\?/);
  });
});

describe("the variant a suggestion identifies reports its other issues too", () => {
  it("reports the missing column alongside the operator", () => {
    // Answering only the `op` cost a round trip to discover the `column`.
    const issues = issuesFor(aggregate({ measures: [{ op: "avg", as: "c" }] }));
    expect(issues.map((i) => i.path)).toEqual([
      "measures.0.op",
      "measures.0.column",
    ]);
    expect(issues[0]?.message).toContain('Did you mean "AVG"?');
    expect(issues[1]?.message).toMatch(/^Required\./);
  });

  it("invents no requirement for a variant that has none", () => {
    // COUNT takes no column, so the corrected query is complete.
    const issues = issuesFor(
      aggregate({ measures: [{ op: "Count", as: "c" }] })
    );
    expect(issues.map((i) => i.path)).toEqual(["measures.0.op"]);
  });

  it("stays silent about siblings when no variant is identifiable", () => {
    // Nothing folds onto an accepted op, so which variant was meant is
    // unknown, and one member's requirements are not the others'.
    const issues = issuesFor(
      aggregate({ measures: [{ op: "cont", as: "c" }] })
    );
    expect(issues.map((i) => i.path)).toEqual(["measures.0.op"]);
    expect(issues[0]?.message).toMatch(/Expected op to be one of/);
  });
});

describe("an unrecognized key is named and, where possible, corrected", () => {
  // The failure these replace: the key was dropped, the query ran without it,
  // and the caller was handed a result that looked like an answer.
  it("names a misspelled top-level key in the path and suggests the real one", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filter: [{ column: "StatusCode", op: "eq", value: "Error" }],
    });
    expect(issues).toEqual([
      {
        path: "filter",
        message: 'Unknown key "filter". Did you mean "filters"?',
      },
    ]);
  });

  it.each([
    ["a doubled letter", "limitt", "limit"],
    ["a dropped plural", "dimension", "dimensions"],
  ])("suggests the near miss for %s", (_label, sent, expected) => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      [sent]: sent === "limitt" ? 5 : ["SpanName"],
    });
    expect(issues.map((i) => i.path)).toEqual([sent]);
    expect(issues[0]?.message).toContain(`Did you mean "${expected}"?`);
  });

  it("reports one issue per unknown key rather than one for the object", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      limitt: 5,
      nonsense: 1,
    });
    expect(issues.map((i) => i.path)).toEqual(["limitt", "nonsense"]);
  });

  it("lists the accepted keys when nothing is close enough to name", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: td,
      output: { type: "timeSeries", granularity: "5m", tz: "UTC" },
    });
    expect(issues.map((i) => i.path)).toEqual(["output.tz"]);
    expect(issues[0]?.message).toContain('"type", "granularity"');
    expect(issues[0]?.message).not.toContain("Did you mean");
  });

  it("reaches a key nested inside a filter leaf", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "eq", valu: "x" }],
    });
    const unknown = issues.filter((i) => i.path === "filters.0.valu");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.message).toContain('Did you mean "value"?');
  });

  it("does not also report the key the caller never wrote as missing", () => {
    // `valu` makes `value` look missing; both describe one mistake, and the
    // half worth reporting is the key that was actually written.
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "eq", valu: "x" }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.valu"]);
  });

  it("still reports a problem with a key that was written", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "SpanName", op: "eq", value: {}, valu: "x" }],
    });
    expect(issues.map((i) => i.path).sort()).toEqual([
      "filters.0.valu",
      "filters.0.value",
    ]);
  });

  // Raised in review on PR #180: the candidate list was every member's keys
  // merged, so a key a sibling member declares was offered as a correction for
  // itself — `Unknown key "value". Did you mean "value"?` on an `in` filter.
  it.each([
    ["in", { column: "SpanName", op: "in", value: ["a"] }, "value", "values"],
    ["eq", { column: "SpanName", op: "eq", values: ["a"] }, "values", "value"],
    ["gt", { column: "Duration", op: "gt", values: [1] }, "values", "value"],
  ])(
    "suggests the key the chosen %s member declares, never the key itself",
    (_op, filter, sent, expected) => {
      const issues = issuesFor({
        signal: "traces",
        mode: "raw",
        timeDimension: td,
        filters: [filter],
      });
      expect(issues.map((i) => i.path)).toEqual([`filters.0.${sent}`]);
      expect(issues[0]?.message).toBe(
        `Unknown key "${sent}". Did you mean "${expected}"?`
      );
    }
  );

  it("offers no value key at all to an operator that takes none", () => {
    // isNull accepts neither `value` nor `values`, so suggesting either would
    // send the caller to write a key that is also refused.
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [{ column: "ParentSpanId", op: "isNull", value: "x" }],
    });
    expect(issues.map((i) => i.path)).toEqual(["filters.0.value"]);
    expect(issues[0]?.message).toBe(
      'Unknown key "value". Accepted keys here: "column", "op".'
    );
  });

  it("does not guess when the folded key matches nothing near", () => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      somethingElseEntirely: 1,
    });
    expect(issues[0]?.message).toContain(
      'Unknown key "somethingElseEntirely".'
    );
    expect(issues[0]?.message).not.toContain("Did you mean");
  });
});

describe("nesting does not exhaust the explanation", () => {
  const nest = (depth: number, leaf: unknown): unknown =>
    depth === 0
      ? leaf
      : { [depth % 2 ? "and" : "or"]: [nest(depth - 1, leaf)] };

  // Every wrapper level spends one unit of the recursion budget before any of
  // it reaches the leaf, so the budget was being spent on nesting rather than
  // on schema depth: four wrappers deep, the answer was "Invalid input".
  it.each([0, 1, 4, 7, 9])("explains a leaf %i wrappers deep", (depth) => {
    const issues = issuesFor({
      signal: "traces",
      mode: "raw",
      timeDimension: td,
      filters: [nest(depth, { column: "NoSuchColumn", op: "eq", value: 1 })],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("NoSuchColumn");
    expect(issues[0]?.message).not.toBe("Invalid input");
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
