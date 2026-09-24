/// <reference types="vitest/globals" />
import type { AnyFilterExpr } from "./kopai-query-compiler.js";
import {
  KopaiQueryValidationError,
  collectFilterColumns,
  compileTimeWindow,
  extractMetricType,
  findMetricTypePin,
  parseKopaiQuery,
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

describe("validateKopaiQuery — absolute window must run forwards", () => {
  const absolute = (startTime: string, endTime: string) =>
    asTestQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "absolute", startTime, endTime },
    });

  it("rejects a window whose bounds are reversed", () => {
    expect(() =>
      validateKopaiQuery(
        absolute("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      )
    ).toThrow(KopaiQueryValidationError);
  });

  it("says the bounds may be reversed rather than reporting no data", () => {
    // The whole point: an empty result is indistinguishable from "no
    // telemetry in that window", and the caller acts on the wrong one.
    expect(() =>
      validateKopaiQuery(
        absolute("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      )
    ).toThrow(/not before endTime|Swap the bounds/);
  });

  it("rejects equal bounds, because endTime is exclusive", () => {
    expect(() =>
      validateKopaiQuery(
        absolute("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      )
    ).toThrow(/matches nothing/);
  });

  it("accepts a forward window, to the millisecond", () => {
    expect(() =>
      validateKopaiQuery(
        absolute("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.001Z")
      )
    ).not.toThrow();
  });

  it("reports an unparseable datetime rather than passing it through", () => {
    // Reachable only by calling the validator directly — the schema's pattern
    // catches this first — but the gate is called directly by both datasources.
    expect(() =>
      validateKopaiQuery(absolute("not-a-date", "2026-01-01T00:00:00.000Z"))
    ).toThrow(/startTime "not-a-date"/);
  });

  it("is reached through parseKopaiQuery, which both surfaces share", () => {
    const r = parseKopaiQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2026-02-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]?.path).toBe("");
    expect(r.issues[0]?.message).toMatch(/endTime/);
  });
});

describe("parseKopaiQuery — branch dispatch, shared by the builder and the MCP tool", () => {
  it("parses a valid raw query and returns it", () => {
    const r = parseKopaiQuery({
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.signal).toBe("traces");
    expect(r.data.mode).toBe("raw");
  });

  it("parses a valid aggregate query and returns it", () => {
    const r = parseKopaiQuery({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "COUNT", as: "c" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
    });
    expect(r.ok).toBe(true);
  });

  it("returns issues rather than throwing — the whole point of the split", () => {
    expect(() =>
      parseKopaiQuery({ signal: "nope", mode: "raw" })
    ).not.toThrow();
  });

  it("reports an unknown signal on `signal`, listing the accepted values", () => {
    const r = parseKopaiQuery({ signal: "spans", mode: "raw" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.path).toBe("signal");
    expect(r.issues[0]?.message).toMatch(/traces.*logs.*metrics/);
  });

  it("reports an unknown mode on `mode`, listing the accepted values", () => {
    const r = parseKopaiQuery({ signal: "traces", mode: "rawish" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.path).toBe("mode");
    expect(r.issues[0]?.message).toMatch(/aggregate.*raw/);
  });

  it("reports both halves of the pair at once when neither selects a branch", () => {
    const r = parseKopaiQuery({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path).sort()).toEqual(["mode", "signal"]);
  });

  it("reports a non-object input against the query as a whole", () => {
    for (const input of [null, "traces", 42, [], undefined]) {
      const r = parseKopaiQuery(input);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]?.path).toBe("");
    }
  });

  it("names only the selected branch's fields — not all six branches", () => {
    // A trace aggregate whose measure column does not exist on traces. Parsed
    // against the whole union this reports every branch's failures at once;
    // against the one branch it names the offending field.
    const r = parseKopaiQuery({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "AVG", column: "NoSuchColumn", as: "x" }],
      timeDimension: tdRelative,
      output: { type: "summary" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Not just the offending branch — the offending field inside it, named.
    expect(r.issues.map((i) => i.path)).toEqual(["measures.0.column"]);
    expect(r.issues[0]?.message).toMatch(/NoSuchColumn/);
  });

  it("surfaces a cross-field compiler rejection as one issue at the root", () => {
    // Metric queries require a MetricType filter; the zod schema cannot
    // express that, so it comes back from validateKopaiQuery.
    const r = parseKopaiQuery({
      signal: "metrics",
      mode: "raw",
      timeDimension: tdRelative,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.path).toBe("");
    expect(r.issues[0]?.message).toMatch(/MetricType/);
  });

  it("agrees with validateKopaiQuery on a query the schema alone accepts", () => {
    const q = {
      signal: "traces",
      mode: "raw",
      timeDimension: tdRelative,
      orderBy: [{ type: "measure", alias: "c", direction: "desc" }],
    };
    // Same rejection, one throwing and one returning.
    expect(() => validateKopaiQuery(asTestQuery(q))).toThrow(
      /measure is not allowed/
    );
    const r = parseKopaiQuery(q);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]?.message).toMatch(/measure is not allowed/);
  });
});
