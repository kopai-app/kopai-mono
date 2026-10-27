import { describe, expect, it } from "vitest";
import { GOLDEN_CASES, type GoldenCase } from "./golden-cases.js";
import { referenceAggregate, type RefRow } from "./reference-ops.js";

function expectRowsClose(actual: RefRow[], expected: RefRow[]): void {
  expect(actual.map((r) => Object.keys(r).sort())).toEqual(
    expected.map((r) => Object.keys(r).sort())
  );
  actual.forEach((row, i) => {
    for (const [key, want] of Object.entries(expected[i]!)) {
      const got = row[key];
      if (typeof want === "number" && typeof got === "number") {
        expect(got, `row ${i} ${key}`).toBeCloseTo(want, 9);
      } else {
        expect(got, `row ${i} ${key}`).toEqual(want);
      }
    }
  });
}

describe("reference implementation: golden cases (spec 9.1)", () => {
  it.each(GOLDEN_CASES.map((c): [string, GoldenCase] => [c.id, c]))(
    "%s",
    (_id, c) => {
      expectRowsClose(referenceAggregate(c.input), c.expected);
    }
  );
});
