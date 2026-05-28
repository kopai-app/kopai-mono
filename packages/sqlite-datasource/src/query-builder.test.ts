import { describe, it, expect } from "vitest";
import type { kopaiQuery } from "@kopai/core";
import { buildKopaiSql, normalizeCellValue } from "./query-builder.js";

// ---------------------------------------------------------------------------
// Filter compilation tests via the public buildKopaiSql entry point.
// We use a TraceRawQuery scaffold and vary only the filters array. SQL uses
// SQLite positional parameters (`?`); params is a flat array bound left-to-
// right, so the time-window pair lands at indices 0/1 before any filter
// params.
//
// Mirrors packages/clickhouse-datasource/src/query-kopai.test.ts so both
// backends prove they compile the same KopaiQuery tree.
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

describe("compileFilter (sqlite)", () => {
  it("emits string-equality SQL for a string-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "eq", value: "hello" }])
    );
    expect(sql).toContain(`"SpanName" = ?`);
    expect(params).toContain("hello");
  });

  it("emits numeric-comparison SQL for a number-valued eq leaf", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "Duration", op: "eq", value: 42 }])
    );
    expect(sql).toContain(`"Duration" = ?`);
    expect(params).toContain(42);
  });

  it("serializes booleans to 0/1 for eq on attribute refs", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([
        {
          column: { container: "SpanAttributes", key: "feature.enabled" },
          op: "eq",
          value: true,
        },
      ])
    );
    expect(sql).toContain(`json_extract("SpanAttributes", ?) = ?`);
    expect(params).toContain(`$."feature.enabled"`);
    expect(params).toContain(1);
  });

  it("emits AND group for {and:[...]} logical", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        {
          and: [
            { column: "SpanName", op: "eq", value: "a" },
            { column: "Duration", op: "gt", value: 10 },
          ],
        },
      ])
    );
    expect(sql).toContain(`("SpanName" = ? AND "Duration" > ?)`);
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
    expect(sql).toContain(`("SpanName" = ? OR "SpanName" = ?)`);
  });

  it("wraps a single-element AND/OR in its own paren group", () => {
    // Schema requires min(1) for and/or arrays; a single-element group is
    // valid input. The emission must still wrap it in parens so the SQL
    // matches the multi-child shape — otherwise a downstream rewriter that
    // adds siblings would suddenly change associativity.
    const andOne = buildKopaiSql(
      baseTraceRaw([{ and: [{ column: "SpanName", op: "eq", value: "x" }] }])
    );
    expect(andOne.sql).toContain(`("SpanName" = ?)`);

    const orOne = buildKopaiSql(
      baseTraceRaw([{ or: [{ column: "SpanName", op: "eq", value: "x" }] }])
    );
    expect(orOne.sql).toContain(`("SpanName" = ?)`);
  });

  it("emits IN with positional placeholders for in/notIn", () => {
    const inResult = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "in", values: ["x", "y", "z"] }])
    );
    expect(inResult.sql).toContain(`"SpanName" IN (?, ?, ?)`);
    expect(inResult.params).toEqual(expect.arrayContaining(["x", "y", "z"]));

    const notInResult = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "notIn", values: ["x"] }])
    );
    expect(notInResult.sql).toContain(`"SpanName" NOT IN (?)`);
  });

  it("emits LIKE ESCAPE '\\' for contains and escapes wildcards", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "contains", value: "50%_bar" }])
    );
    expect(sql).toContain(`"SpanName" LIKE ? ESCAPE '\\'`);
    // % and _ in the needle must be escaped so they don't act as wildcards.
    expect(params).toContain(`%50\\%\\_bar%`);
  });

  it("emits NOT LIKE for notContains", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "notContains", value: "abc" }])
    );
    expect(sql).toContain(`"SpanName" NOT LIKE ? ESCAPE '\\'`);
    expect(params).toContain(`%abc%`);
  });

  it("emits prefix LIKE for startsWith", () => {
    const { params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "startsWith", value: "abc" }])
    );
    expect(params).toContain(`abc%`);
  });

  it("emits suffix LIKE for endsWith", () => {
    const { params } = buildKopaiSql(
      baseTraceRaw([{ column: "SpanName", op: "endsWith", value: "abc" }])
    );
    expect(params).toContain(`%abc`);
  });

  it("emits comparator SQL for gt/gte/lt/lte", () => {
    expect(
      buildKopaiSql(baseTraceRaw([{ column: "Duration", op: "gt", value: 10 }]))
        .sql
    ).toContain(`"Duration" > ?`);
    expect(
      buildKopaiSql(
        baseTraceRaw([{ column: "Duration", op: "gte", value: 10 }])
      ).sql
    ).toContain(`"Duration" >= ?`);
    expect(
      buildKopaiSql(baseTraceRaw([{ column: "Duration", op: "lt", value: 10 }]))
        .sql
    ).toContain(`"Duration" < ?`);
    expect(
      buildKopaiSql(
        baseTraceRaw([{ column: "Duration", op: "lte", value: 10 }])
      ).sql
    ).toContain(`"Duration" <= ?`);
  });

  it("treats empty string as null for isNull / isNotNull (parity with CH empty())", () => {
    // ClickHouse uses empty()/notEmpty(), which treat a missing attribute
    // (Map default "") and an empty value identically. SQLite mirrors that so
    // the same query returns the same rows on both backends.
    expect(
      buildKopaiSql(baseTraceRaw([{ column: "SpanName", op: "isNull" }])).sql
    ).toContain(`("SpanName" IS NULL OR "SpanName" = '')`);
    expect(
      buildKopaiSql(baseTraceRaw([{ column: "SpanName", op: "isNotNull" }])).sql
    ).toContain(`("SpanName" IS NOT NULL AND "SpanName" <> '')`);
  });

  it("emits json_extract for non-semconv attribute refs", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceRaw([
        {
          column: { container: "SpanAttributes", key: "http.route" },
          op: "eq",
          value: "/users",
        },
      ])
    );
    expect(sql).toContain(`json_extract("SpanAttributes", ?) = ?`);
    expect(params).toContain(`$."http.route"`);
    expect(params).toContain("/users");
  });
});

// ---------------------------------------------------------------------------
// Cross-backend AND/OR matrix test.
// Same nested shape as packages/clickhouse-datasource/src/query-kopai.test.ts
// — keep both in sync so a parenthesization regression on either backend is
// caught.
//
// Shape:  AND[ OR[ leaf, leaf ], OR[ leaf, leaf, leaf ], leaf ]
// Mixes:  eq (string), gt (number), contains, isNull, in, attr-ref eq
// ---------------------------------------------------------------------------

describe("compileFilter (sqlite) — nested AND/OR matrix", () => {
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

    // Outer AND group wraps the three children; each OR child is its own
    // paren group. Asserted as a literal substring so a regression in
    // parenthesization or join-order fails loudly.
    const expected =
      `(("SpanName" = ? OR "SpanName" LIKE ? ESCAPE '\\') ` +
      `AND ("Duration" > ? OR CAST(json_extract("SpanAttributes", ?) AS REAL) = ? OR ("StatusMessage" IS NULL OR "StatusMessage" = '')) ` +
      `AND "TraceId" IN (?, ?))`;
    expect(sql).toContain(expected);
  });

  it("emits one parameter slot per leaf value in left-to-right order", () => {
    const { params } = buildKopaiSql(baseTraceRaw(matrixFilter));
    // Two time bounds + 1 (SpanName eq) + 1 (SpanName LIKE) + 1 (Duration gt)
    //   + 2 (json_extract path + 500) + 0 (IS NULL) + 2 (IN list) + limit
    //   = 10 params total.
    expect(params).toHaveLength(10);

    expect(params).toContain("checkout");
    expect(params).toContain("%pay%");
    expect(params).toContain(1000);
    expect(params).toContain(`$."http.status_code"`);
    expect(params).toContain(500);
    expect(params).toContain("t1");
    expect(params).toContain("t2");
  });
});

// ---------------------------------------------------------------------------
// Attribute refs in dimensions / measures / orderBy
// (P1 gap: previously only tested inside filters)
// ---------------------------------------------------------------------------

describe("attribute refs across query slots (sqlite)", () => {
  it("compiles attr-ref dimensions to json_extract in SELECT and GROUP BY", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceAggregate({
        dimensions: [{ container: "SpanAttributes", key: "http.route" }],
      })
    );
    expect(sql).toContain(`json_extract("SpanAttributes", ?) AS "dim_0"`);
    expect(sql).toContain(`GROUP BY json_extract("SpanAttributes", ?)`);
    // Both the SELECT and the GROUP BY bind the same path string.
    const matches = params.filter((p) => p === `$."http.route"`);
    expect(matches).toHaveLength(2);
  });

  it("compiles attr-ref COUNT_DISTINCT measure", () => {
    const { sql, params } = buildKopaiSql(
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
    // NULLIF drops both missing keys (json_extract -> NULL) and empty
    // values, matching ClickHouse's uniq(nullIf(...)) so distinct counts
    // agree across backends.
    expect(sql).toContain(
      `COUNT(DISTINCT NULLIF(json_extract("SpanAttributes", ?), '')) AS "distinct_users"`
    );
    expect(params).toContain(`$."user.id"`);
  });

  it("compiles attr-ref NumericOp measure (SUM)", () => {
    const { sql, params } = buildKopaiSql(
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
      `SUM(json_extract("SpanAttributes", ?)) AS "total_bytes"`
    );
    expect(params).toContain(`$."bytes.sent"`);
  });

  it("compiles attr-ref orderBy column", () => {
    const { sql, params } = buildKopaiSql(
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
    expect(sql).toContain(`ORDER BY json_extract("SpanAttributes", ?) DESC`);
    // path appears in SELECT + GROUP BY + ORDER BY → 3 binds.
    const matches = params.filter((p) => p === `$."http.route"`);
    expect(matches).toHaveLength(3);
  });

  it("compiles attr-ref orderBy in raw mode", () => {
    const { sql, params } = buildKopaiSql({
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
    expect(sql).toContain(`ORDER BY json_extract("SpanAttributes", ?) ASC`);
    expect(params).toContain(`$."request.id"`);
  });
});

// ---------------------------------------------------------------------------
// Aggregate-mode filter + HAVING coverage
// ---------------------------------------------------------------------------

describe("runAggregate filter compilation (sqlite)", () => {
  it("compiles nested AND/OR identically in aggregate mode", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        filters: [
          {
            and: [
              {
                or: [
                  { column: "SpanName", op: "eq", value: "a" },
                  { column: "SpanName", op: "eq", value: "b" },
                ],
              },
              { column: "Duration", op: "gt", value: 100 },
            ],
          },
        ],
      })
    );
    expect(sql).toContain(
      `(("SpanName" = ? OR "SpanName" = ?) AND "Duration" > ?)`
    );
  });

  it.each([
    ["eq", "="],
    ["neq", "<>"],
    ["gt", ">"],
    ["gte", ">="],
    ["lt", "<"],
    ["lte", "<="],
  ] as const)("emits HAVING %s as %s for measure aliases", (op, sqlOp) => {
    const { sql, params } = buildKopaiSql(
      baseTraceAggregate({
        havings: [{ measure: "c", op, value: 10 }],
      })
    );
    expect(sql).toContain(`HAVING "c" ${sqlOp} ?`);
    expect(params).toContain(10);
  });

  it("joins multiple HAVING clauses with AND", () => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        havings: [
          { measure: "c", op: "gt", value: 1 },
          { measure: "c", op: "lt", value: 100 },
        ],
      })
    );
    expect(sql).toContain(`HAVING "c" > ? AND "c" < ?`);
  });
});

// ---------------------------------------------------------------------------
// Measure ops — sqlite supports COUNT, ERROR_RATE (traces), THROUGHPUT
// (traces), COUNT_DISTINCT, and NumericOp (excluding percentiles, which
// throw). Verify each compiles or throws as documented.
// ---------------------------------------------------------------------------

describe("measure ops (sqlite)", () => {
  it("compiles COUNT to COUNT(*)", () => {
    const { sql } = buildKopaiSql(baseTraceAggregate());
    expect(sql).toContain(`COUNT(*) AS "c"`);
  });

  it("compiles ERROR_RATE to AVG(CASE …) and binds STATUS_CODE_ERROR as a param", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceAggregate({ measures: [{ op: "ERROR_RATE", as: "err" }] })
    );
    expect(sql).toContain(
      `AVG(CASE WHEN StatusCode = ? THEN 1.0 ELSE 0.0 END) AS "err"`
    );
    expect(params).toContain("STATUS_CODE_ERROR");
  });

  it("compiles THROUGHPUT to COUNT(*)/window for summary output", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceAggregate({ measures: [{ op: "THROUGHPUT", as: "tps" }] })
    );
    expect(sql).toContain(`(CAST(COUNT(*) AS REAL) / ?) AS "tps"`);
    // Window: 2024-01-01 → 2024-01-02 = 86400 seconds.
    expect(params).toContain(86400);
  });

  it.each(["SUM", "AVG", "MIN", "MAX"] as const)(
    "compiles %s to FN(col)",
    (op) => {
      const { sql } = buildKopaiSql(
        baseTraceAggregate({
          measures: [{ op, column: "Duration", as: "x" }],
        })
      );
      expect(sql).toContain(`${op}("Duration") AS "x"`);
    }
  );

  it.each([
    ["RATE_SUM", "SUM"],
    ["RATE_AVG", "AVG"],
    ["RATE_MAX", "MAX"],
  ] as const)("compiles %s to (%s(col) / window)", (op, fn) => {
    const { sql } = buildKopaiSql(
      baseTraceAggregate({
        measures: [{ op, column: "Duration", as: "r" }],
      })
    );
    expect(sql).toContain(`(${fn}("Duration") / ?) AS "r"`);
  });

  it.each(["P50", "P75", "P90", "P95", "P99", "P999"] as const)(
    "throws on percentile op %s (not yet supported on sqlite)",
    (op) => {
      expect(() =>
        buildKopaiSql(
          baseTraceAggregate({
            measures: [{ op, column: "Duration", as: "p" }],
          })
        )
      ).toThrow(/Percentile measures \(P50-P999\) are not yet supported/);
    }
  );
});

// ---------------------------------------------------------------------------
// Time-series output — granularity bucketing must appear in SELECT and
// GROUP BY, and the per-second denominator for rate-style measures must
// match the granularity, not the full window.
// ---------------------------------------------------------------------------

describe("time-series bucket emission (sqlite)", () => {
  it("buckets timestamps by (ts / bucketNs) * bucketNs", () => {
    const { sql, params } = buildKopaiSql(
      baseTraceAggregate({
        output: { type: "timeSeries", granularity: "1m" },
      })
    );
    expect(sql).toContain(`(Timestamp / ?) * ? AS "bucket_start_ns"`);
    expect(sql).toContain(`GROUP BY (Timestamp / ?) * ?`);
    // 60-second bucket → 60_000_000_000 ns. Appears 4× (SELECT pair +
    // GROUP BY pair).
    const matches = params.filter((p) => p === 60_000_000_000n);
    expect(matches).toHaveLength(4);
  });

  it("THROUGHPUT divides by bucket width, not full window, in time-series mode", () => {
    const { params } = buildKopaiSql(
      baseTraceAggregate({
        measures: [{ op: "THROUGHPUT", as: "tps" }],
        output: { type: "timeSeries", granularity: "5m" },
      })
    );
    // 5 minutes = 300 seconds. Full window is 86400 seconds; using that
    // would underreport throughput by ~288×.
    expect(params).toContain(300);
    expect(params).not.toContain(86400);
  });
});

// ---------------------------------------------------------------------------
// Sub-second / fractional window precision — regression for windowSeconds
// being computed via BigInt integer division (truncates). A 1.5-second
// window divided as `BigInt / 1e9` yields 1, skewing rates by 50%.
// ---------------------------------------------------------------------------

describe("window-seconds precision (sqlite)", () => {
  it("preserves fractional seconds when computing the THROUGHPUT denominator", () => {
    const { params } = buildKopaiSql({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "THROUGHPUT", as: "tps" }],
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T00:00:01.500Z",
      },
      output: { type: "summary" },
    });
    expect(params).toContain(1.5);
    expect(params).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------
// Cursor pagination — keyset WHERE shape. Traces use SpanId as the
// tiebreaker; logs/metrics use rowid (integer). Cursor format is
// "<tsNs>|<id>".
// ---------------------------------------------------------------------------

describe("cursor pagination (sqlite)", () => {
  it("emits SpanId tiebreaker for trace cursor (default desc)", () => {
    const { sql, params } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
      },
      cursor: "1704067200000000000:span-abc",
    });
    expect(sql).toContain(`(Timestamp < ? OR (Timestamp = ? AND SpanId < ?))`);
    expect(params).toContain(1704067200000000000n);
    expect(params).toContain("span-abc");
  });

  it("flips comparators to > when orderBy direction is asc", () => {
    const { sql } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
      },
      orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      cursor: "1704067200000000000:span-abc",
    });
    expect(sql).toContain(`(Timestamp > ? OR (Timestamp = ? AND SpanId > ?))`);
  });

  it("uses rowid (integer) tiebreaker for logs", () => {
    const { sql, params } = buildKopaiSql({
      signal: "logs",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
      },
      cursor: "1704067200000000000:42",
    });
    expect(sql).toContain(`(Timestamp < ? OR (Timestamp = ? AND rowid < ?))`);
    expect(params).toContain(42);
  });

  it("rejects non-integer rowid in non-trace cursor", () => {
    expect(() =>
      buildKopaiSql({
        signal: "logs",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        cursor: "1704067200000000000:not-an-int",
      })
    ).toThrow(/Invalid cursor id/);
  });

  it("rejects cursor missing the separator", () => {
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        cursor: "no-separator-here",
      })
    ).toThrow(/Invalid cursor format/);
  });

  // Malformed timestamp must surface as KopaiQueryValidationError so the API
  // returns 400. Without the regex check, `BigInt("abc")` throws a raw
  // SyntaxError that escapes as a 500.
  // The cursor predicate is keyed off the time column + structural tiebreak
  // (SpanId / rowid). A user-specified non-time primary sort would make ORDER
  // BY and the cursor predicate disagree, breaking pagination. Reject early.
  it("rejects cursor when primary orderBy is not the time column", async () => {
    const { kopaiQueryCompiler } = await import("@kopai/core");
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        orderBy: [{ type: "dimension", column: "Duration", direction: "desc" }],
        cursor: "1704067200000000000:span-abc",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  // H1: a secondary sort key after the time column desyncs the keyset
  // predicate (which only resumes on time + tiebreaker), silently
  // skipping/repeating rows. Reject it even when the primary key is the time
  // column.
  it("rejects cursor when a secondary (non-time) sort key is present", async () => {
    const { kopaiQueryCompiler } = await import("@kopai/core");
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        orderBy: [
          { type: "dimension", column: "Timestamp", direction: "desc" },
          { type: "dimension", column: "Duration", direction: "desc" },
        ],
        cursor: "1704067200000000000:span-abc",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("rejects cursor with a non-numeric timestamp via KopaiQueryValidationError", async () => {
    const { kopaiQueryCompiler } = await import("@kopai/core");
    expect(() =>
      buildKopaiSql({
        signal: "traces",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        cursor: "not-a-number:span-abc",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  it("rejects cursor with a partially-numeric rowid for non-trace signals", async () => {
    // parseInt is lenient — "42xyz" parses as 42 and would silently page from
    // the wrong row. A regex match upfront keeps the contract strict.
    const { kopaiQueryCompiler } = await import("@kopai/core");
    expect(() =>
      buildKopaiSql({
        signal: "logs",
        mode: "raw",
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-02T00:00:00.000Z",
        },
        cursor: "1704067200000000000:42xyz",
      })
    ).toThrow(kopaiQueryCompiler.KopaiQueryValidationError);
  });

  // Both backends round-trip their own cursors, but the cursor field is part
  // of the public KopaiQuery contract — the format must be the same shape on
  // either side so a future shared integration test (or a caller debugging
  // cross-backend) doesn't trip over a backend-specific separator.
  it("accepts the canonical ':' separator (parity with clickhouse)", () => {
    const { sql, params } = buildKopaiSql({
      signal: "traces",
      mode: "raw",
      timeDimension: {
        type: "absolute",
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-02T00:00:00.000Z",
      },
      cursor: "1704067200000000000:span-abc",
    });
    expect(sql).toContain(`(Timestamp < ? OR (Timestamp = ? AND SpanId < ?))`);
    expect(params).toContain(1704067200000000000n);
    expect(params).toContain("span-abc");
  });
});

// ---------------------------------------------------------------------------
// normalizeCellValue — bigint precision. SQLite returns integer columns as
// bigint (via setReadBigInts). Number() silently rounds anything beyond the
// 53-bit safe range, which would drop precision on large aggregate results
// (huge COUNTs, SUMs of integer columns, etc.). KopaiAggregateRow already
// permits strings, so out-of-range values must round-trip as strings.
// ---------------------------------------------------------------------------

describe("normalizeCellValue", () => {
  it("preserves precision for bigints outside the safe integer range", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
    const out = normalizeCellValue(big);
    expect(typeof out).toBe("string");
    expect(out).toBe(big.toString());
  });

  it("preserves precision for negative bigints outside the safe range", () => {
    const big = BigInt(Number.MIN_SAFE_INTEGER) - 10n;
    const out = normalizeCellValue(big);
    expect(typeof out).toBe("string");
    expect(out).toBe(big.toString());
  });

  it("returns number for in-range bigints (keeps common counts numeric)", () => {
    expect(normalizeCellValue(3n)).toBe(3);
    expect(normalizeCellValue(0n)).toBe(0);
    expect(normalizeCellValue(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });
});

describe("empty logical group fallback (sqlite)", () => {
  // Zod enforces .min(1) on and/or arrays, so an empty group is unreachable
  // through the validated API. buildKopaiSql is called directly here, so cover
  // its defensive 1=1 fallback to guard against a regression (or a future
  // relaxation of the min(1) constraint).
  it("emits 1=1 for an empty and-group", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        { and: [] },
      ] as unknown as kopaiQuery.TraceRawQuery["filters"])
    );
    expect(sql).toContain("1=1");
  });

  it("emits 1=1 for an empty or-group", () => {
    const { sql } = buildKopaiSql(
      baseTraceRaw([
        { or: [] },
      ] as unknown as kopaiQuery.TraceRawQuery["filters"])
    );
    expect(sql).toContain("1=1");
  });
});
