import { describe, it, expect } from "vitest";
import { kopaiQueryCompiler, type kopaiQuery } from "@kopai/core";
import { buildKopaiSql } from "./query-kopai.js";

// ---------------------------------------------------------------------------
// Filter compilation tests via the public buildKopaiSql entry point.
// We use a TraceRawQuery scaffold and vary only the filters array.
// compileTimeRange consumes params `tsLo_0` and `tsHi_1`, so filter params
// start at index 2 — assertions use regex patterns to avoid coupling.
// ---------------------------------------------------------------------------

function baseTraceRaw(
  filters: kopaiQuery.TraceRawQuery["filters"]
): kopaiQuery.TraceRawQuery {
  return {
    signal: "traces",
    mode: "raw",
    timeDimension: {
      type: "absolute",
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-02T00:00:00.000Z",
    },
    filters,
  };
}

describe("compileFilter (clickhouse)", () => {
  it("emits string-equality SQL for a string-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "eq", value: "hello" }])
    );
    expect(sql).toMatch(/`SpanName` = \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("hello");
  });

  it("emits numeric-comparison SQL for a number-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "eq", value: 42 }])
    );
    expect(sql).toMatch(/`Duration` = \{n_\d+:Float64\}/);
    expect(Object.values(params)).toContain(42);
  });

  it("emits boolean-as-string SQL for a boolean-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([
        {
          column: { container: "SpanAttributes", key: "feature.enabled" },
          op: "eq",
          value: true,
        },
      ])
    );
    expect(sql).toMatch(
      /SpanAttributes\['feature\.enabled'\] = \{b_\d+:String\}/
    );
    expect(Object.values(params)).toContain("true");
  });

  it("emits AND group for {and:[...]} logical", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        {
          and: [
            { column: "SpanName", op: "eq", value: "a" },
            { column: "service.name", op: "eq", value: "b" },
          ],
        },
      ])
    );
    expect(sql).toMatch(
      /\(`SpanName` = \{s_\d+:String\} AND `ServiceName` = \{s_\d+:String\}\)/
    );
  });

  it("emits OR group for {or:[...]} logical", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        {
          or: [
            { column: "SpanName", op: "eq", value: "a" },
            { column: "SpanName", op: "eq", value: "b" },
          ],
        },
      ])
    );
    expect(sql).toMatch(
      /\(`SpanName` = \{s_\d+:String\} OR `SpanName` = \{s_\d+:String\}\)/
    );
  });

  it("emits IN SQL with String element type for string-valued in", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "service.name", op: "in", values: ["x", "y"] }])
    );
    expect(sql).toMatch(/`ServiceName` IN \{sin_\d+:Array\(String\)\}/);
    expect(Object.values(params)).toContainEqual(["x", "y"]);
  });

  it("emits IN SQL with Float64 element type for number-valued in", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "in", values: [1, 2] }])
    );
    expect(sql).toMatch(/`Duration` IN \{nin_\d+:Array\(Float64\)\}/);
    expect(Object.values(params)).toContainEqual([1, 2]);
  });

  it("emits NOT IN for notIn op", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        { column: "service.name", op: "notIn", values: ["x", "y"] },
      ])
    );
    expect(sql).toMatch(/`ServiceName` NOT IN \{sin_\d+:Array\(String\)\}/);
  });

  it("emits ILIKE for contains", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "contains", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc%");
  });

  it("emits NOT ILIKE for notContains", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "notContains", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` NOT ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc%");
  });

  it("emits prefix ILIKE for startsWith", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "startsWith", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("abc%");
  });

  it("emits suffix ILIKE for endsWith", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "endsWith", value: "abc" }])
    );
    expect(sql).toMatch(/`SpanName` ILIKE \{s_\d+:String\}/);
    expect(Object.values(params)).toContain("%abc");
  });

  it("emits comparator SQL for gt/gte/lt/lte", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "gt", value: 10 }])
    );
    expect(sql).toMatch(/`Duration` > \{n_\d+:Float64\}/);
    expect(Object.values(params)).toContain(10);
  });

  it("emits empty()/notEmpty() for isNull / isNotNull", () => {
    const { sql: nullSql } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "isNull" }])
    );
    expect(nullSql).toContain("empty(`SpanName`)");
    const { sql: notNullSql } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "isNotNull" }])
    );
    expect(notNullSql).toContain("notEmpty(`SpanName`)");
  });
});

// ---------------------------------------------------------------------------
// Cross-backend AND/OR matrix test.
// Same nested shape as packages/sqlite-datasource/src/query-builder.test.ts
// — keep both in sync so a parenthesization regression on either backend is
// caught.
//
// Shape:  AND[ OR[ leaf, leaf ], OR[ leaf, leaf, leaf ], leaf ]
// Mixes:  eq (string), gt (number), contains, isNull, in, attr-ref eq
// ---------------------------------------------------------------------------

describe("compileFilter (clickhouse) — nested AND/OR matrix", () => {
  const matrixFilter: kopaiQuery.TraceRawQuery["filters"] = [
    {
      and: [
        {
          or: [
            { column: "SpanName", op: "eq", value: "checkout" },
            { column: "SpanName", op: "contains", value: "pay" },
          ],
        },
        {
          or: [
            { column: "Duration", op: "gt", value: 1000 },
            {
              column: { container: "SpanAttributes", key: "http.status_code" },
              op: "eq",
              value: 500,
            },
            { column: "StatusMessage", op: "isNull" },
          ],
        },
        {
          column: "TraceId",
          op: "in",
          values: ["t1", "t2"],
        },
      ],
    },
  ];

  it("preserves AND-of-ORs parenthesization across nested mixed-op leaves", () => {
    const { sql } = buildKopaiSql(baseTraceRaw(matrixFilter));

    // Outer AND group + two inner OR groups + a flat IN leaf. Asserted with
    // regexes so the param names (which include a monotonic counter) don't
    // couple the test to numbering.
    expect(sql).toMatch(
      /\(\(`SpanName` = \{s_\d+:String\} OR `SpanName` ILIKE \{s_\d+:String\}\) AND \(`Duration` > \{n_\d+:Float64\} OR toFloat64OrNull\(SpanAttributes\['http\.status_code'\]\) = \{n_\d+:Float64\} OR empty\(`StatusMessage`\)\) AND `TraceId` IN \{sin_\d+:Array\(String\)\}\)/
    );
  });

  it("binds one parameter per leaf value", () => {
    const { params } = buildKopaiSql(baseTraceRaw(matrixFilter));
    const values = Object.values(params);
    expect(values).toContain("checkout");
    expect(values).toContain("%pay%");
    expect(values).toContain(1000);
    // Number-valued eq on an attribute ref still binds as Float64 (the
    // value-typed leaf, not the storage-typed cell).
    expect(values).toContain(500);
    expect(values).toContainEqual(["t1", "t2"]);
  });
});

// ---------------------------------------------------------------------------
// Aggregate-mode test scaffolding
// ---------------------------------------------------------------------------

function baseTraceAggregate(
  overrides: Partial<kopaiQuery.TraceAggregateQuery> = {}
): kopaiQuery.TraceAggregateQuery {
  return {
    signal: "traces",
    mode: "aggregate",
    measures: [{ op: "COUNT", as: "c" }],
    timeDimension: {
      type: "absolute",
      startTime: "2024-01-01T00:00:00.000Z",
      endTime: "2024-01-02T00:00:00.000Z",
    },
    output: { type: "summary" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Single-element AND/OR groups
// ---------------------------------------------------------------------------

describe("compileFilter (clickhouse) — single-element AND/OR groups", () => {
  it("wraps a single-element AND in its own paren group", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([{ and: [{ column: "SpanName", op: "eq", value: "x" }] }])
    );
    expect(sql).toMatch(/\(`SpanName` = \{s_\d+:String\}\)/);
  });

  it("wraps a single-element OR in its own paren group", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([{ or: [{ column: "SpanName", op: "eq", value: "x" }] }])
    );
    expect(sql).toMatch(/\(`SpanName` = \{s_\d+:String\}\)/);
  });
});

// ---------------------------------------------------------------------------
// Attribute refs across query slots
// (P1 gap: previously only tested inside filters)
// ---------------------------------------------------------------------------

describe("attribute refs across query slots (clickhouse)", () => {
  it("compiles attr-ref dimensions to Map() lookup + dotted alias", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        dimensions: [{ container: "SpanAttributes", key: "http.route" }],
      })
    );
    expect(sql).toContain(
      "SpanAttributes['http.route'] AS `SpanAttributes.http.route`"
    );
    expect(sql).toContain("GROUP BY SpanAttributes['http.route']");
  });

  it("compiles attr-ref COUNT_DISTINCT to uniq(Map())", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        measures: [
          {
            op: "COUNT_DISTINCT",
            column: { container: "SpanAttributes", key: "user.id" },
            as: "distinct_users",
          },
        ],
      })
    );
    expect(sql).toContain(
      "uniq(SpanAttributes['user.id']) AS `distinct_users`"
    );
  });

  it("compiles attr-ref SUM measure with numeric cast", () => {
    // Attribute-Map values are strings; the backend wraps in toFloat64OrNull
    // for numeric aggregations.
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        measures: [
          {
            op: "SUM",
            column: { container: "SpanAttributes", key: "bytes.sent" },
            as: "total_bytes",
          },
        ],
      })
    );
    expect(sql).toContain(
      "sum(toFloat64OrNull(SpanAttributes['bytes.sent'])) AS `total_bytes`"
    );
  });

  it("compiles attr-ref orderBy column in aggregate mode", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        dimensions: [{ container: "SpanAttributes", key: "http.route" }],
        orderBy: [
          {
            type: "dimension",
            column: { container: "SpanAttributes", key: "http.route" },
            direction: "desc",
          },
        ],
      })
    );
    expect(sql).toContain("ORDER BY SpanAttributes['http.route'] DESC");
  });

  it("compiles attr-ref orderBy column in raw mode", () => {
    const { sql } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
      },
      orderBy: [
        {
          type: "dimension",
          column: { container: "SpanAttributes", key: "request.id" },
          direction: "asc",
        },
      ],
    });
    expect(sql).toContain("ORDER BY SpanAttributes['request.id'] ASC");
  });
});

// ---------------------------------------------------------------------------
// Percentile measure ops (P50 – P999)
// (P1 gap: previously only P50/P95/P999 spot-checked)
// ---------------------------------------------------------------------------

describe("percentile measures (clickhouse)", () => {
  const quantiles: ReadonlyArray<[kopaiQuery.NumericOp, string]> = [
    ["P50", "0.5"],
    ["P75", "0.75"],
    ["P90", "0.9"],
    ["P95", "0.95"],
    ["P99", "0.99"],
    ["P999", "0.999"],
  ];

  it.each(quantiles)("compiles %s to quantile(%s)(col)", (op, q) => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        measures: [{ op, column: "Duration", as: "p" }],
      })
    );
    expect(sql).toContain(`quantile(${q})(\`Duration\`) AS \`p\``);
  });
});

// ---------------------------------------------------------------------------
// HAVING — all 6 comparator ops
// (P1 gap: previously only gt tested via integration tests)
// ---------------------------------------------------------------------------

describe("HAVING clause (clickhouse)", () => {
  const havingOps: ReadonlyArray<[kopaiQuery.HavingExpr["op"], string]> = [
    ["eq", "="],
    ["neq", "<>"],
    ["gt", ">"],
    ["gte", ">="],
    ["lt", "<"],
    ["lte", "<="],
  ];

  it.each(havingOps)(
    "emits HAVING %s as %s for measure aliases",
    (op, sqlOp) => {
      const { sql } = buildKopaiSql(
        baseTraceAggregate({ havings: [{ measure: "c", op, value: 10 }] })
      );
      expect(sql).toMatch(
        new RegExp(`HAVING \`c\` ${escapeRegex(sqlOp)} \\{hv_\\d+:Float64\\}`)
      );
    }
  );

  it("joins multiple HAVING clauses with AND", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        havings: [
          { measure: "c", op: "gt", value: 1 },
          { measure: "c", op: "lt", value: 100 },
        ],
      })
    );
    expect(sql).toMatch(
      /HAVING `c` > \{hv_\d+:Float64\} AND `c` < \{hv_\d+:Float64\}/
    );
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("buildKopaiSql raw mode without dimensions", () => {
  it("builds a TraceRawQuery with no dimensions field", () => {
    const { sql } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: { type: "relative", lookback: "1h" },
    });
    // Selects the full TRACE_RAW_SELECT list — sanity check a few cols.
    expect(sql).toContain("FROM otel_traces");
    expect(sql).toContain("Timestamp");
    expect(sql).toContain("SpanId");
    expect(sql).toContain("SpanAttributes");
  });
});

// ---------------------------------------------------------------------------
// Cursor parsing — errors must surface as KopaiQueryValidationError so the
// API error handler maps them to 400 (Invalid query) instead of 500
// (Internal server error). Mirrors the SQLite behaviour for parity.
// ---------------------------------------------------------------------------

describe("cursor parsing (clickhouse)", () => {
  const baseTimeDim: kopaiQuery.TraceRawQuery["timeDimension"] = {
    type: "absolute",
    startTime: "2024-01-01T00:00:00.000Z",
    endTime: "2024-01-02T00:00:00.000Z",
  };

  it("throws KopaiQueryValidationError when separator is missing", () => {
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: baseTimeDim,
        cursor: "no-separator-here",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("throws KopaiQueryValidationError when timestamp is non-numeric", () => {
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: baseTimeDim,
        cursor: "not-a-number:abc",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("accepts a well-formed cursor with the ':' separator", () => {
    const { sql, params } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: baseTimeDim,
      cursor: "1704067200000000000:span-abc",
    });
    expect(sql).toMatch(
      /Timestamp < \{curTs_\d+:DateTime64\(9\)\} OR \(Timestamp = \{curTs_\d+:DateTime64\(9\)\} AND SpanId < \{curId_\d+:String\}\)/
    );
    expect(Object.values(params)).toContain("span-abc");
  });

  // For logs and metrics the cursor id is bound as `{curHash:UInt64}` against
  // a `sipHash64(...)` predicate. Letting a non-numeric value through to the
  // server produces a CH parse error (500). Reject upfront with a 400.
  it("rejects logs cursor with a non-numeric id (must be UInt64)", () => {
    expect(() =>
      buildKopaiSql({
        signal: "logs",
        mode: "raw",
        timeDimension: baseTimeDim,
        cursor: "1704067200000000000:not-a-number",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("rejects metrics cursor with a non-numeric id (must be UInt64)", () => {
    expect(() =>
      buildKopaiSql({
        signal: "metrics",
        mode: "raw",
        timeDimension: baseTimeDim,
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        cursor: "1704067200000000000:not-a-number",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  // The cursor predicate is built against the time column (Timestamp/TimeUnix)
  // and the structural tiebreaker (SpanId / row hash). If the user-specified
  // primary sort is anything else, the predicate and the ORDER BY disagree and
  // pagination skips or repeats rows. Reject the combination explicitly.
  it("rejects cursor when primary orderBy is not the time column", () => {
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: baseTimeDim,
        orderBy: [{ type: "dimension", column: "Duration", direction: "desc" }],
        cursor: "1704067200000000000:span-abc",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("accepts cursor when primary orderBy IS the time column", () => {
    const { sql } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: baseTimeDim,
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      cursor: "1704067200000000000:span-abc",
    });
    expect(sql).toContain("Timestamp >");
  });

  it("rejects cursor id exceeding UInt64 max for non-trace signals", () => {
    // 2^64 — one above the UInt64 range. Without an explicit check the
    // numeric string passes through to CH and fails at execution.
    const beyondU64 = "18446744073709551616";
    expect(() =>
      buildKopaiSql({
        signal: "logs",
        mode: "raw",
        timeDimension: baseTimeDim,
        cursor: `1704067200000000000:${beyondU64}`,
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });
});

// ---------------------------------------------------------------------------
// MetricType placement — must be at top level (AND). Inside an OR the SQL
// builder cannot pick a per-type table, and would otherwise emit invalid SQL
// referencing a non-existent column on the chosen table. The compiler-level
// validator rejects this case as ambiguous; the SQL builder duplicates the
// check so direct callers (e.g. these tests) hit the same error class.
// ---------------------------------------------------------------------------

describe("metric type placement (clickhouse)", () => {
  it("rejects MetricType inside an OR branch with KopaiQueryValidationError", () => {
    expect(() =>
      buildKopaiSql({
        signal: "metrics",
        mode: "raw",
        timeDimension: { type: "relative", lookback: "1h" },
        filters: [
          {
            or: [
              { column: "MetricType", op: "eq", value: "Gauge" },
              { column: "MetricType", op: "eq", value: "Sum" },
            ],
          },
        ],
      } as unknown as kopaiQuery.KopaiQuery)
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("rejects raw-mode measure-typed orderBy with KopaiQueryValidationError", () => {
    // Defensive: the compiler-level validator also rejects this, but the
    // SQL builder must surface KopaiQueryValidationError (not plain Error)
    // so direct callers get a 400, not 500.
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: { type: "relative", lookback: "1h" },
        orderBy: [{ type: "measure", alias: "n", direction: "desc" }],
      } as unknown as kopaiQuery.KopaiQuery)
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("rejects MetricType nested deep inside an OR branch", () => {
    expect(() =>
      buildKopaiSql({
        signal: "metrics",
        mode: "raw",
        timeDimension: { type: "relative", lookback: "1h" },
        filters: [
          {
            or: [
              {
                and: [{ column: "MetricType", op: "eq", value: "Gauge" }],
              },
            ],
          },
        ],
      } as unknown as kopaiQuery.KopaiQuery)
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });
});
