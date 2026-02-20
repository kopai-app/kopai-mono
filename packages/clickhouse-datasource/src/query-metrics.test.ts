import { describe, it, expect } from "vitest";
import { buildDiscoverMetricsQueries } from "./query-metrics.js";

describe("buildDiscoverMetricsQueries", () => {
  it("does not produce double arrayJoin in attributesQuery", () => {
    const { attributesQuery } = buildDiscoverMetricsQueries();

    // Should use ARRAY JOIN clause, not nested arrayJoin() calls
    const lines = attributesQuery.split("\n");
    for (const line of lines) {
      const count = (line.match(/arrayJoin\(/g) || []).length;
      expect(
        count,
        `double arrayJoin on line: ${line.trim()}`
      ).toBeLessThanOrEqual(1);
    }
  });

  it("uses ARRAY JOIN clause for attribute expansion", () => {
    const { attributesQuery } = buildDiscoverMetricsQueries();
    expect(attributesQuery).toContain("ARRAY JOIN mapKeys(");
  });
});
