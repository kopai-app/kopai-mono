/// <reference types="vitest/globals" />
import type { AnyFilterExpr } from "./kopai-query-compiler.js";
import {
  KopaiQueryValidationError,
  collectFilterColumns,
  compileTimeWindow,
  extractMetricType,
  findMetricTypePin,
  validateKopaiQuery,
} from "./kopai-query-compiler.js";
import type { KopaiQuery, TimeDimension } from "./kopai-query.js";

// Minimal valid relative window.
const tdRelative: TimeDimension = { type: "relative", lookback: "1h" };

// Test fixtures often need to feed deliberately-invalid shapes to the
// runtime validator (e.g. wrong column for a signal, missing required
// MetricType filter). The validator signature is `(q: KopaiQuery) =>`,
// so we widen via a single typed helper instead of repeating
// `as unknown as KopaiQuery` at every callsite.
function asTestQuery(o: object): KopaiQuery {
  return o as KopaiQuery;
}
function asTestFilters(o: readonly object[]): AnyFilterExpr[] {
  return o as AnyFilterExpr[];
}

describe("collectFilterColumns (via validateKopaiQuery sanity column scan)", () => {
  // The MetricType-on-non-metric-query check at L577 walks the filter
  // tree via collectFilterColumns. We use that path to confirm AND/OR
  // recursion.
  it("1. recurses through nested and/or to find every leaf column", () => {
    // If recursion is broken, the buried MetricType ref below would be
    // missed and validation would (incorrectly) pass.
    const q = asTestQuery({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
      filters: [
        {
          and: [
            { column: "SpanName", op: "eq", value: "x" },
            {
              or: [
                // "MetricType" is invalid on traces — validator must
                // surface it, which requires reaching this leaf.
                { column: "MetricType", op: "isNull" },
              ],
            },
          ],
        },
      ],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/MetricType/);
  });

  it("1b. directly: collectFilterColumns returns both nested leaves", () => {
    const filters = asTestFilters([
      {
        and: [
          { column: "SpanName", op: "eq", value: "x" },
          { or: [{ column: "TraceId", op: "isNull" }] },
        ],
      },
    ]);
    const cols = collectFilterColumns(filters);
    expect(cols).toContain("SpanName");
    expect(cols).toContain("TraceId");
  });
});

describe("findMetricTypePin (via extractMetricType + validator)", () => {
  // Build a minimal metric-aggregate skeleton parametrised by filters.
  const metricsAgg = (filters: unknown[]): KopaiQuery =>
    asTestQuery({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
      filters,
    });

  it("2. extracts a single MetricType from a top-level eq filter", () => {
    const q = metricsAgg([{ column: "MetricType", op: "eq", value: "Gauge" }]);
    expect(extractMetricType(q)).toBe("Gauge");
  });

  it("3. extracts a MetricType from op:in with a single-element values list", () => {
    const q = metricsAgg([
      { column: "MetricType", op: "in", values: ["Histogram"] },
    ]);
    expect(extractMetricType(q)).toBe("Histogram");
  });

  it("4. flags ambiguity when op:in has multiple MetricType values", () => {
    const q = metricsAgg([
      { column: "MetricType", op: "in", values: ["Gauge", "Sum"] },
    ]);
    expect(() => extractMetricType(q)).toThrow(/single MetricType/);
  });

  it("5. flags ambiguity when MetricType filter sits inside an OR branch", () => {
    const q = metricsAgg([
      {
        or: [
          { column: "MetricType", op: "eq", value: "Gauge" },
          { column: "MetricType", op: "eq", value: "Sum" },
        ],
      },
    ]);
    expect(() => extractMetricType(q)).toThrow(/OR/);
  });

  it("6. flags conflicting MetricType eq filters at top level", () => {
    const q = metricsAgg([
      { column: "MetricType", op: "eq", value: "Gauge" },
      { column: "MetricType", op: "eq", value: "Sum" },
    ]);
    expect(() => extractMetricType(q)).toThrow(/Conflicting/);
  });

  it("6b. direct findMetricTypePin probe: pinned for top-level eq", () => {
    const r = findMetricTypePin(
      asTestFilters([{ column: "MetricType", op: "eq", value: "Gauge" }]),
      true
    );
    expect(r.kind).toBe("pinned");
    if (r.kind === "pinned") expect(r.value).toBe("Gauge");
  });
});

describe("compileTimeWindow — compareOffset removed", () => {
  it("7. relative window produces only startNs/endNs (no compare fields)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const out = compileTimeWindow({ type: "relative", lookback: "1h" }, now);
    expect(typeof out.startNs).toBe("bigint");
    expect(typeof out.endNs).toBe("bigint");
    // Probe via Object.keys (no cast needed) — the compare* fields
    // should not exist on the runtime object at all.
    expect(Object.keys(out)).toEqual(["startNs", "endNs"]);
    expect(Object.keys(out)).not.toContain("compareStartNs");
    expect(Object.keys(out)).not.toContain("compareEndNs");
  });

  it("7b. zero-duration lookback rejected — would otherwise produce startNs == endNs", () => {
    // Defends against a query passing validation but reaching the
    // backend with an empty time window.
    expect(() =>
      compileTimeWindow({ type: "relative", lookback: "0s" })
    ).toThrow(KopaiQueryValidationError);
    expect(() =>
      compileTimeWindow({ type: "relative", lookback: "0h" })
    ).toThrow(KopaiQueryValidationError);
  });
});

describe("validateKopaiQuery — raw mode dimensions optional", () => {
  it("8. raw trace query without dimensions and without orderBy is valid", () => {
    const q = asTestQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("9. raw trace query without dimensions but with structural orderBy is valid", () => {
    const q = asTestQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "desc" }],
    });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("10. raw query with explicit dimensions accepts orderBy column not in dimensions (projection is always full)", () => {
    const q = asTestQuery({
      signal: "traces",
      mode: "raw",
      dimensions: ["SpanName"],
      timeDimension: tdRelative,
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "desc" }],
    });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("10b. raw mode still rejects orderBy of type 'measure'", () => {
    const q = asTestQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
      orderBy: [{ type: "measure", alias: "c", direction: "desc" }],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/measure is not allowed/);
  });

  it("11. metric query missing MetricType filter — error mentions new shape, not kind:", () => {
    const q = asTestQuery({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
    });
    let caught: unknown;
    try {
      validateKopaiQuery(q);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KopaiQueryValidationError);
    if (!(caught instanceof Error)) throw new Error("expected an Error");
    expect(caught.message).toContain("column:'MetricType'");
    expect(caught.message).not.toContain("kind:");
  });
});

describe("extractMetricType — typed return", () => {
  it("12. returns a typed MetricType for a pinned metric query", () => {
    const q = asTestQuery({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
      filters: [{ column: "MetricType", op: "eq", value: "Sum" }],
    });
    expect(extractMetricType(q)).toBe("Sum");
  });
});

describe("validateKopaiQuery — metric column exists on pinned type (M4)", () => {
  const metricsAgg = (measures: unknown[], filters: unknown[]): KopaiQuery =>
    asTestQuery({
      signal: "metrics",
      mode: "aggregate",
      measures,
      timeDimension: tdRelative,
      output: { type: "summary" },
      filters,
    });

  it("13. rejects a structural column absent on the pinned MetricType", () => {
    // `Count` exists on Histogram/Summary, not on Gauge.
    const q = metricsAgg(
      [{ op: "SUM", column: "Count", as: "c" }],
      [{ column: "MetricType", op: "eq", value: "Gauge" }]
    );
    expect(() => validateKopaiQuery(q)).toThrow(/does not exist|Count/);
  });

  it("14. accepts a type-specific column on the matching MetricType", () => {
    const q = metricsAgg(
      [{ op: "SUM", column: "Count", as: "c" }],
      [{ column: "MetricType", op: "eq", value: "Histogram" }]
    );
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("15. accepts Value on Gauge", () => {
    const q = metricsAgg(
      [{ op: "AVG", column: "Value", as: "v" }],
      [{ column: "MetricType", op: "eq", value: "Gauge" }]
    );
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("16. rejects a dimension column absent on the pinned type", () => {
    const q = asTestQuery({
      signal: "metrics",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "n" }],
      dimensions: ["BucketCounts"], // Histogram-only
      timeDimension: tdRelative,
      output: { type: "summary" },
      filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/does not exist|BucketCounts/);
  });
});

describe("validateKopaiQuery — numeric op on non-numeric column (L1)", () => {
  const tracesRaw = (filters: unknown[]): KopaiQuery =>
    asTestQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
      filters,
    });

  it("17. rejects gt on a string structural column", () => {
    const q = tracesRaw([{ column: "SpanName", op: "gt", value: 5 }]);
    expect(() => validateKopaiQuery(q)).toThrow(/numeric|SpanName/);
  });

  it("18. rejects eq with a numeric value on a string column", () => {
    const q = tracesRaw([{ column: "SpanName", op: "eq", value: 42 }]);
    expect(() => validateKopaiQuery(q)).toThrow(/numeric|SpanName/);
  });

  it("19. rejects in with numeric values on a string column", () => {
    const q = tracesRaw([{ column: "SpanName", op: "in", values: [1, 2] }]);
    expect(() => validateKopaiQuery(q)).toThrow(/numeric|SpanName/);
  });

  it("20. allows gt on a numeric structural column (Duration)", () => {
    const q = tracesRaw([{ column: "Duration", op: "gt", value: 5 }]);
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("21. allows eq with a string value on a string column", () => {
    const q = tracesRaw([{ column: "SpanName", op: "eq", value: "GET /" }]);
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("22. allows a numeric op on an attribute ref (coerced at SQL layer)", () => {
    const q = tracesRaw([
      {
        column: { container: "SpanAttributes", key: "http.status" },
        op: "gt",
        value: 200,
      },
    ]);
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });
});

describe("validateKopaiQuery — aggregate cross-field references", () => {
  const agg = (over: object): KopaiQuery =>
    asTestQuery({
      signal: "traces",
      mode: "aggregate",
      timeDimension: tdRelative,
      output: { type: "summary" },
      measures: [{ op: "COUNT", as: "c" }],
      ...over,
    });

  it("23. rejects duplicate measure aliases", () => {
    const q = agg({
      measures: [
        { op: "COUNT", as: "c" },
        { op: "ERROR_RATE", as: "c" },
      ],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/[Dd]uplicate measure alias/);
  });

  it("24. rejects a HAVING that references an unknown measure alias", () => {
    const q = agg({
      havings: [{ measure: "missing", op: "gt", value: 1 }],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/having\.measure|missing/);
  });

  it("25. accepts a HAVING that references a declared alias", () => {
    const q = agg({ havings: [{ measure: "c", op: "gt", value: 1 }] });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("26. rejects an orderBy measure that references an unknown alias", () => {
    const q = agg({
      orderBy: [{ type: "measure", alias: "nope", direction: "desc" }],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/orderBy measure|nope/);
  });

  it("27. rejects an orderBy dimension absent from dimensions (aggregate mode)", () => {
    const q = agg({
      dimensions: ["SpanName"],
      orderBy: [{ type: "dimension", column: "SpanKind", direction: "asc" }],
    });
    expect(() => validateKopaiQuery(q)).toThrow(/must appear in dimensions/);
  });

  it("28. accepts an orderBy dimension that appears in dimensions", () => {
    const q = agg({
      dimensions: ["SpanName"],
      orderBy: [{ type: "dimension", column: "SpanName", direction: "asc" }],
    });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });

  it("29. accepts an orderBy measure that references a declared alias", () => {
    const q = agg({
      orderBy: [{ type: "measure", alias: "c", direction: "desc" }],
    });
    expect(() => validateKopaiQuery(q)).not.toThrow();
  });
});
