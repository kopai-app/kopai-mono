/// <reference types="vitest/globals" />
import type {
  TracesKopaiQuery,
  LogsKopaiQuery,
  MetricsKopaiQuery,
} from "@kopai/core";
import {
  translateTracesQuery,
  translateLogsQuery,
  translateMetricsQuery,
} from "./kopai-query-translator.js";
import {
  SqliteDatasourceBadRequestError,
  SqliteDatasourceNotImplementedError,
} from "./sqlite-datasource-error.js";

describe("kopai-query-translator", () => {
  describe("translateTracesQuery", () => {
    it("compiles a minimal scalar select to SELECT FROM otel_traces", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
      };
      const { compiled, isAgg, effectiveLimit } = translateTracesQuery(q);
      expect(compiled.sql).toContain('select "TraceId" as "id"');
      expect(compiled.sql).toContain('from "otel_traces"');
      expect(compiled.sql).toContain("limit ?");
      expect(compiled.parameters[compiled.parameters.length - 1]).toBe(101);
      expect(isAgg).toBe(false);
      expect(effectiveLimit).toBe(100);
    });

    it("maps every camelCase column to its PascalCase DB column", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          a: { kind: "col", name: "spanId" },
          b: { kind: "col", name: "timestamp" },
          c: { kind: "col", name: "duration" },
          d: { kind: "col", name: "spanName" },
          e: { kind: "col", name: "spanKind" },
          f: { kind: "col", name: "statusCode" },
          g: { kind: "col", name: "statusMessage" },
          h: { kind: "col", name: "serviceName" },
          i: { kind: "col", name: "scopeName" },
          j: { kind: "col", name: "scopeVersion" },
          k: { kind: "col", name: "parentSpanId" },
          l: { kind: "col", name: "traceState" },
          m: { kind: "col", name: "eventsName" },
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('"SpanId" as "a"');
      expect(compiled.sql).toContain('"Timestamp" as "b"');
      expect(compiled.sql).toContain('"Duration" as "c"');
      expect(compiled.sql).toContain('"SpanName" as "d"');
      expect(compiled.sql).toContain('"SpanKind" as "e"');
      expect(compiled.sql).toContain('"StatusCode" as "f"');
      expect(compiled.sql).toContain('"StatusMessage" as "g"');
      expect(compiled.sql).toContain('"ServiceName" as "h"');
      expect(compiled.sql).toContain('"ScopeName" as "i"');
      expect(compiled.sql).toContain('"ScopeVersion" as "j"');
      expect(compiled.sql).toContain('"ParentSpanId" as "k"');
      expect(compiled.sql).toContain('"TraceState" as "l"');
      expect(compiled.sql).toContain('"Events.Name" as "m"');
    });

    it("compiles an attribute-map select to json_extract", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          route: {
            kind: "attr",
            map: "spanAttributes",
            key: "http.route",
          },
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('json_extract("SpanAttributes", ?)');
      expect(compiled.parameters).toContain('$."http.route"');
    });

    it("compiles a simple eq WHERE", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "eq",
          col: { kind: "col", name: "serviceName" },
          value: "svc-a",
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toMatch(/where "ServiceName" = \?/);
      expect(compiled.parameters).toContain("svc-a");
    });

    it.each([
      ["ne", "!="],
      ["gt", ">"],
      ["gte", ">="],
      ["lt", "<"],
      ["lte", "<="],
      ["like", "like"],
    ] as const)("compiles %s to SQL operator %s", (kind, op) => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind,
          col: { kind: "col", name: "spanName" },
          value: "x",
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain(`"SpanName" ${op} ?`);
    });

    it("compiles in / notIn to SQL IN / NOT IN", () => {
      const q1: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "in",
          col: { kind: "col", name: "serviceName" },
          values: ["a", "b", "c"],
        },
      };
      const { compiled: c1 } = translateTracesQuery(q1);
      expect(c1.sql).toContain('"ServiceName" in (?, ?, ?)');
      expect(c1.parameters).toContain("a");
      expect(c1.parameters).toContain("b");
      expect(c1.parameters).toContain("c");

      const q2: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "notIn",
          col: { kind: "col", name: "serviceName" },
          values: ["a"],
        },
      };
      const { compiled: c2 } = translateTracesQuery(q2);
      expect(c2.sql).toContain('"ServiceName" not in (?)');
    });

    it("compiles isNull / isNotNull", () => {
      const q1: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "isNull",
          col: { kind: "col", name: "parentSpanId" },
        },
      };
      const { compiled: c1 } = translateTracesQuery(q1);
      expect(c1.sql).toContain('"ParentSpanId" is null');

      const q2: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "isNotNull",
          col: { kind: "col", name: "parentSpanId" },
        },
      };
      const { compiled: c2 } = translateTracesQuery(q2);
      expect(c2.sql).toContain('"ParentSpanId" is not null');
    });

    it("compiles AND / OR / NOT nesting", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "and",
          exprs: [
            {
              kind: "eq",
              col: { kind: "col", name: "serviceName" },
              value: "svc",
            },
            {
              kind: "or",
              exprs: [
                {
                  kind: "eq",
                  col: { kind: "col", name: "spanKind" },
                  value: "SPAN_KIND_SERVER",
                },
                {
                  kind: "not",
                  expr: {
                    kind: "eq",
                    col: { kind: "col", name: "statusCode" },
                    value: "STATUS_CODE_OK",
                  },
                },
              ],
            },
          ],
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('"ServiceName" = ?');
      expect(compiled.sql).toContain(" and ");
      expect(compiled.sql).toContain(" or ");
      expect(compiled.sql).toContain("not");
    });

    it("compiles WHERE on an attribute-map column to json_extract = ?", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        where: {
          kind: "eq",
          col: { kind: "attr", map: "spanAttributes", key: "http.route" },
          value: "/foo",
        },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('json_extract("SpanAttributes", ?) = ?');
      expect(compiled.parameters).toEqual(
        expect.arrayContaining(['$."http.route"', "/foo"])
      );
    });

    it("applies time range to Timestamp with BigInt params", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        timeRange: { start: "1000000000000000", end: "2000000000000000" },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('"Timestamp" >= ?');
      expect(compiled.sql).toContain('"Timestamp" <= ?');
      expect(compiled.parameters).toEqual(
        expect.arrayContaining([
          BigInt("1000000000000000"),
          BigInt("2000000000000000"),
        ])
      );
    });

    it("applies ORDER BY with a SpanId tiebreaker by default (DESC)", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain(
        'order by "Timestamp" desc, "SpanId" desc'
      );
    });

    it("applies user ORDER BY direction with SpanId tiebreaker (ASC)", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "asc" }],
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('order by "Timestamp" asc, "SpanId" asc');
    });

    it("applies cursor predicate (DESC: timestamp < or (= and spanId <))", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        cursor: "1500000000000000:span-x",
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('"Timestamp" <');
      expect(compiled.parameters).toContain(BigInt("1500000000000000"));
      expect(compiled.parameters).toContain("span-x");
    });

    it("applies cursor predicate (ASC: timestamp > or (= and spanId >))", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "asc" }],
        cursor: "1500000000000000:span-x",
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('"Timestamp" >');
    });

    it("throws BadRequest when cursor is missing ':' separator", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        cursor: "not-a-valid-cursor",
      };
      expect(() => translateTracesQuery(q)).toThrow(
        SqliteDatasourceBadRequestError
      );
    });

    it("throws BadRequest when cursor timestamp is non-numeric", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        cursor: "abc:span-x",
      };
      expect(() => translateTracesQuery(q)).toThrow(
        SqliteDatasourceBadRequestError
      );
    });

    it("throws BadRequest when rowid-tiebreaker cursor part is non-numeric (logs)", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: { ts: { kind: "col", name: "timestamp" } },
        cursor: "1500000000000000:not-a-number",
      };
      expect(() => translateLogsQuery(q)).toThrow(
        SqliteDatasourceBadRequestError
      );
    });

    it("compiles count() agg with no col", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { c: { kind: "agg", fn: "count" } },
      };
      const { compiled, isAgg } = translateTracesQuery(q);
      expect(compiled.sql).toContain('count(*) as "c"');
      expect(isAgg).toBe(true);
    });

    it("compiles countDistinct over a column", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          c: {
            kind: "agg",
            fn: "countDistinct",
            col: { kind: "col", name: "serviceName" },
          },
        },
      };
      const { compiled, isAgg } = translateTracesQuery(q);
      expect(compiled.sql).toContain('count(distinct "ServiceName") as "c"');
      expect(isAgg).toBe(true);
    });

    it.each([
      ["sum", "sum"],
      ["avg", "avg"],
      ["min", "min"],
      ["max", "max"],
    ] as const)("compiles %s agg over a column", (fn, sqlFn) => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          v: {
            kind: "agg",
            fn,
            col: { kind: "col", name: "duration" },
          },
        },
      };
      const { compiled, isAgg } = translateTracesQuery(q);
      expect(compiled.sql).toContain(`${sqlFn}("Duration") as "v"`);
      expect(isAgg).toBe(true);
    });

    it("compiles groupBy", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          svc: { kind: "col", name: "serviceName" },
          c: { kind: "agg", fn: "count" },
        },
        groupBy: [{ kind: "col", name: "serviceName" }],
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain('group by "ServiceName"');
    });

    it("compiles groupBy on attribute-map column with json_extract", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: {
          k: { kind: "attr", map: "spanAttributes", key: "http.route" },
          c: { kind: "agg", fn: "count" },
        },
        groupBy: [{ kind: "attr", map: "spanAttributes", key: "http.route" }],
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).toContain(
        'group by json_extract("SpanAttributes", ?)'
      );
    });

    it("does NOT produce ORDER BY tiebreaker for aggregated queries", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { c: { kind: "agg", fn: "count" } },
      };
      const { compiled } = translateTracesQuery(q);
      expect(compiled.sql).not.toContain('"SpanId"');
    });

    it.each(["topN", "p50", "p99", "p999", "heatmap", "rateAvg"] as const)(
      "throws SqliteDatasourceNotImplementedError for unsupported agg fn '%s'",
      (fn) => {
        const q: TracesKopaiQuery = {
          signal: "traces",
          select: {
            v: {
              kind: "agg",
              fn,
              col: { kind: "col", name: "duration" },
              args: fn === "topN" ? { n: 5 } : undefined,
            },
          },
        };
        expect(() => translateTracesQuery(q)).toThrow(
          SqliteDatasourceNotImplementedError
        );
      }
    );

    it("respects user-provided limit", () => {
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: { id: { kind: "col", name: "traceId" } },
        limit: 7,
      };
      const { compiled, effectiveLimit } = translateTracesQuery(q);
      expect(effectiveLimit).toBe(7);
      expect(compiled.parameters[compiled.parameters.length - 1]).toBe(8);
    });
  });

  describe("translateLogsQuery", () => {
    it("selects from otel_logs", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: { ts: { kind: "col", name: "timestamp" } },
      };
      const { compiled } = translateLogsQuery(q);
      expect(compiled.sql).toContain('from "otel_logs"');
      expect(compiled.sql).toContain('"Timestamp" as "ts"');
    });

    it("uses rowid as tiebreaker (DESC)", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: { ts: { kind: "col", name: "timestamp" } },
      };
      const { compiled } = translateLogsQuery(q);
      expect(compiled.sql).toMatch(/order by "Timestamp" desc, rowid desc/);
    });

    it("maps log-specific columns", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: {
          b: { kind: "col", name: "body" },
          s: { kind: "col", name: "severityText" },
          n: { kind: "col", name: "severityNumber" },
          e: { kind: "col", name: "eventName" },
        },
      };
      const { compiled } = translateLogsQuery(q);
      expect(compiled.sql).toContain('"Body" as "b"');
      expect(compiled.sql).toContain('"SeverityText" as "s"');
      expect(compiled.sql).toContain('"SeverityNumber" as "n"');
      expect(compiled.sql).toContain('"EventName" as "e"');
    });

    it("compiles like with %wildcards%", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: { b: { kind: "col", name: "body" } },
        where: {
          kind: "like",
          col: { kind: "col", name: "body" },
          value: "%error%",
        },
      };
      const { compiled } = translateLogsQuery(q);
      expect(compiled.sql).toContain('"Body" like ?');
      expect(compiled.parameters).toContain("%error%");
    });

    it("compiles count + groupBy for logs", () => {
      const q: LogsKopaiQuery = {
        signal: "logs",
        select: {
          svc: { kind: "col", name: "serviceName" },
          c: { kind: "agg", fn: "count" },
        },
        groupBy: [{ kind: "col", name: "serviceName" }],
      };
      const { compiled, isAgg } = translateLogsQuery(q);
      expect(compiled.sql).toContain('group by "ServiceName"');
      expect(compiled.sql).toContain('count(*) as "c"');
      expect(isAgg).toBe(true);
    });

    it.each(["topN", "p99"] as const)(
      "throws for unsupported agg '%s'",
      (fn) => {
        const q: LogsKopaiQuery = {
          signal: "logs",
          select: {
            v: {
              kind: "agg",
              fn: fn as "topN",
              col: { kind: "col", name: "severityNumber" },
              args: fn === "topN" ? { n: 5 } : undefined,
            },
          },
        };
        expect(() => translateLogsQuery(q)).toThrow(
          SqliteDatasourceNotImplementedError
        );
      }
    );
  });

  describe("translateMetricsQuery", () => {
    it.each([
      ["gauge", "otel_metrics_gauge"],
      ["sum", "otel_metrics_sum"],
      ["histogram", "otel_metrics_histogram"],
      ["exponentialHistogram", "otel_metrics_exponential_histogram"],
      ["summary", "otel_metrics_summary"],
    ] as const)(
      "dispatches metricType '%s' to table %s",
      (metricType, expectedTable) => {
        const q: MetricsKopaiQuery = {
          signal: "metrics",
          metricType,
          select: { t: { kind: "col", name: "timeUnix" } },
        };
        const { compiled } = translateMetricsQuery(q);
        expect(compiled.sql).toContain(`from "${expectedTable}"`);
      }
    );

    it("orders by TimeUnix with rowid tiebreaker", () => {
      const q: MetricsKopaiQuery = {
        signal: "metrics",
        metricType: "gauge",
        select: { t: { kind: "col", name: "timeUnix" } },
      };
      const { compiled } = translateMetricsQuery(q);
      expect(compiled.sql).toContain('order by "TimeUnix" desc, rowid desc');
    });

    it("maps gauge-specific columns", () => {
      const q: MetricsKopaiQuery = {
        signal: "metrics",
        metricType: "gauge",
        select: {
          v: { kind: "col", name: "value" },
          n: { kind: "col", name: "metricName" },
        },
      };
      const { compiled } = translateMetricsQuery(q);
      expect(compiled.sql).toContain('"Value" as "v"');
      expect(compiled.sql).toContain('"MetricName" as "n"');
    });

    it("applies time range to TimeUnix (not Timestamp)", () => {
      const q: MetricsKopaiQuery = {
        signal: "metrics",
        metricType: "gauge",
        select: { v: { kind: "col", name: "value" } },
        timeRange: { start: "1000000000000", end: "2000000000000" },
      };
      const { compiled } = translateMetricsQuery(q);
      expect(compiled.sql).toContain('"TimeUnix" >= ?');
      expect(compiled.sql).toContain('"TimeUnix" <= ?');
    });

    it("compiles sum agg over Value with groupBy on attribute", () => {
      const q: MetricsKopaiQuery = {
        signal: "metrics",
        metricType: "sum",
        select: {
          k: { kind: "attr", map: "attributes", key: "k" },
          s: {
            kind: "agg",
            fn: "sum",
            col: { kind: "col", name: "value" },
          },
        },
        groupBy: [{ kind: "attr", map: "attributes", key: "k" }],
      };
      const { compiled, isAgg } = translateMetricsQuery(q);
      expect(compiled.sql).toContain('sum("Value") as "s"');
      expect(compiled.sql).toContain('json_extract("Attributes", ?)');
      expect(isAgg).toBe(true);
    });

    it("throws when select uses a column outside the metricType's column set", () => {
      const q: MetricsKopaiQuery = {
        signal: "metrics",
        metricType: "gauge",
        // 'isMonotonic' belongs to sum metrics only — gauge should reject
        select: { v: { kind: "col", name: "isMonotonic" } as never },
      };
      expect(() => translateMetricsQuery(q)).toThrow(/isMonotonic/);
    });
  });
});
