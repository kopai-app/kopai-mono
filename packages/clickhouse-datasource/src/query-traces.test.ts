import { describe, it, expect } from "vitest";
import { buildTraceSummariesQuery } from "./query-traces.js";

describe("buildTraceSummariesQuery", () => {
  it("does not use dateDiff with nanosecond unit", () => {
    const { query } = buildTraceSummariesQuery({});
    expect(query).not.toContain("dateDiff('nanosecond'");
  });

  it("does not use dateDiff with nanosecond unit when duration filters are set", () => {
    const { query } = buildTraceSummariesQuery({
      durationMin: "1000000",
      durationMax: "5000000000",
    });
    expect(query).not.toContain("dateDiff('nanosecond'");
  });

  it("computes durationNs in the SELECT clause", () => {
    const { query } = buildTraceSummariesQuery({});
    expect(query).toContain("durationNs");
  });

  it("applies durationMin as HAVING condition", () => {
    const { query, params } = buildTraceSummariesQuery({
      durationMin: "1000000",
    });
    expect(query).toContain("HAVING");
    expect(query).toContain("{durMin:UInt64}");
    expect(params.durMin).toBe("1000000");
  });

  it("applies durationMax as HAVING condition", () => {
    const { query, params } = buildTraceSummariesQuery({
      durationMax: "5000000000",
    });
    expect(query).toContain("HAVING");
    expect(query).toContain("{durMax:UInt64}");
    expect(params.durMax).toBe("5000000000");
  });
});
