/// <reference types="vitest/globals" />
/**
 * Parity tests: every meaningful scenario from `datasource-read.test.ts`
 * reproduced via the new `KopaiQuery` AST + `execute{Traces,Logs,Metrics}Query`
 * datasource methods. Proves the new API is at least as capable as the
 * existing `getTraces` / `getLogs` / `getMetrics` / `getAggregatedMetrics`
 * methods for every feature the AST schema supports.
 *
 * Schema-gap scenarios (discoverMetrics, getTraceSummaries) are recorded
 * as `it.todo` referencing the gap analysis in the plan.
 */
import { DatabaseSync } from "node:sqlite";
import type { TracesKopaiQuery, LogsKopaiQuery } from "@kopai/core";
import { OptimizedDatasource } from "./optimized-datasource.js";
import { createOptimizedDatasource } from "./optimized-datasource.js";
import { initializeDatabase } from "./initialize-database.js";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";
import {
  createInsertSpan,
  createInsertGauge,
  createInsertSum,
  createInsertHistogram,
  createInsertExpHistogram,
  createInsertSummary,
  createInsertLog,
} from "./__fixtures__/insert-helpers.js";

function assertDefined<T>(
  v: T | undefined | null,
  msg = "Expected defined"
): asserts v is T {
  if (v === undefined || v === null) throw new Error(msg);
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "bigint" || typeof v === "number") return String(v);
  throw new Error(`Expected string-coercible, got ${typeof v}`);
}

describe("KopaiQuery on sqlite — parity with datasource-read.test.ts", () => {
  describe("executeTracesQuery — getTraces parity", () => {
    let conn: DatabaseSync;
    let ds: OptimizedDatasource;
    let insertSpan: ReturnType<typeof createInsertSpan>;

    beforeEach(() => {
      conn = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(conn);
      insertSpan = createInsertSpan(ds);
    });
    afterEach(() => {
      conn.close();
    });

    const allTraceCols: TracesKopaiQuery["select"] = {
      SpanId: { kind: "col", name: "spanId" },
      TraceId: { kind: "col", name: "traceId" },
      Timestamp: { kind: "col", name: "timestamp" },
      Duration: { kind: "col", name: "duration" },
      SpanName: { kind: "col", name: "spanName" },
      SpanKind: { kind: "col", name: "spanKind" },
      StatusCode: { kind: "col", name: "statusCode" },
      ServiceName: { kind: "col", name: "serviceName" },
      ScopeName: { kind: "col", name: "scopeName" },
      SpanAttributes: { kind: "col", name: "spanAttributes" },
      ResourceAttributes: { kind: "col", name: "resourceAttributes" },
    };

    it("returns all spans, default limit 100, DESC order", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]?.SpanId).toBe("span2");
      expect(result.rows[1]?.SpanId).toBe("span1");
      expect(result.cursor).toBeNull();
    });

    it("filters by traceId", async () => {
      await insertSpan({
        traceId: "target-trace",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "other-trace",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "traceId" },
          value: "target-trace",
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.TraceId).toBe("target-trace");
    });

    it("filters by serviceName", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "target-service",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "other-service",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "serviceName" },
          value: "target-service",
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.ServiceName).toBe("target-service");
    });

    it("filters by spanName + spanKind + statusCode + scopeName (AND)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        spanName: "GET /api",
        spanKind: 2,
        statusCode: 1,
        scopeName: "http-scope",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        spanName: "POST /api",
        spanKind: 3,
        statusCode: 2,
        scopeName: "grpc-scope",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "and",
          exprs: [
            {
              kind: "eq",
              col: { kind: "col", name: "spanName" },
              value: "GET /api",
            },
            {
              kind: "eq",
              col: { kind: "col", name: "spanKind" },
              value: "SPAN_KIND_SERVER",
            },
            {
              kind: "eq",
              col: { kind: "col", name: "statusCode" },
              value: "STATUS_CODE_OK",
            },
            {
              kind: "eq",
              col: { kind: "col", name: "scopeName" },
              value: "http-scope",
            },
          ],
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.SpanName).toBe("GET /api");
    });

    it("filters via timeRange (nanos)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        timeRange: {
          start: "1500000000000000",
          end: "2500000000000000",
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.SpanId).toBe("s2");
    });

    it("filters by duration via gte/lte on the duration column", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1000000100000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2000000500000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3000001000000000",
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "and",
          exprs: [
            {
              kind: "gte",
              col: { kind: "col", name: "duration" },
              value: "200000000",
            },
            {
              kind: "lte",
              col: { kind: "col", name: "duration" },
              value: "600000000",
            },
          ],
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.SpanId).toBe("s2");
    });

    it("filters by spanAttributes via attr-map index", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { "http.method": "GET", "http.path": "/api" },
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        spanAttributes: { "http.method": "POST", "http.path": "/api" },
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "eq",
          col: { kind: "attr", map: "spanAttributes", key: "http.method" },
          value: "GET",
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.SpanId).toBe("s1");
    });

    it("filters by resourceAttributes via attr-map index", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        resourceAttributes: { env: "prod", region: "us-east" },
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        resourceAttributes: { env: "dev", region: "us-west" },
      });

      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "eq",
          col: { kind: "attr", map: "resourceAttributes", key: "env" },
          value: "prod",
        },
      };
      const result = await ds.executeTracesQuery(q);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.SpanId).toBe("s1");
    });

    it("respects limit + returns cursor when more pages exist", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `t${i}`,
          spanId: `s${i}`,
          startTimeNanos: `${1000000000000000 + i * 1000000000000}`,
          endTimeNanos: `${1001000000000000 + i * 1000000000000}`,
        });
      }
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        limit: 3,
      };
      const result = await ds.executeTracesQuery(q);
      expect(result.rows).toHaveLength(3);
      expect(result.cursor).not.toBeNull();
    });

    it("sorts ASC via orderBy", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "asc" }],
      };
      const result = await ds.executeTracesQuery(q);
      expect(result.rows[0]?.SpanId).toBe("s2");
      expect(result.rows[1]?.SpanId).toBe("s1");
    });

    it("paginates via cursor", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `t${i}`,
          spanId: `s${i}`,
          startTimeNanos: `${(i + 1) * 1000000000000000}`,
          endTimeNanos: `${(i + 1) * 1000000000000000 + 1000000000000}`,
        });
      }
      const base: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        limit: 2,
      };
      const page1 = await ds.executeTracesQuery(base);
      expect(page1.rows).toHaveLength(2);
      expect(page1.rows[0]?.SpanId).toBe("s4");
      expect(page1.rows[1]?.SpanId).toBe("s3");
      assertDefined(page1.cursor);

      const page2 = await ds.executeTracesQuery({
        ...base,
        cursor: page1.cursor,
      });
      expect(page2.rows).toHaveLength(2);
      expect(page2.rows[0]?.SpanId).toBe("s2");
      expect(page2.rows[1]?.SpanId).toBe("s1");
    });

    it("paginates with SpanId tiebreaker when timestamps tie", async () => {
      const sameTs = "1000000000000000";
      await insertSpan({
        traceId: "ta",
        spanId: "span-a",
        startTimeNanos: sameTs,
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "tb",
        spanId: "span-b",
        startTimeNanos: sameTs,
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "tc",
        spanId: "span-c",
        startTimeNanos: sameTs,
        endTimeNanos: "1001000000000000",
      });

      const seen = new Set<string>();
      const base: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        limit: 1,
      };
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const q: TracesKopaiQuery = { ...base, cursor };
        const r = await ds.executeTracesQuery(q);
        expect(r.rows).toHaveLength(1);
        seen.add(asString(r.rows[0]?.SpanId));
        cursor = r.cursor ?? undefined;
      }
      expect(seen).toEqual(new Set(["span-a", "span-b", "span-c"]));
    });

    it("returns empty rows + null cursor when nothing matches", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "traceId" },
          value: "nonexistent",
        },
      };
      const r = await ds.executeTracesQuery(q);
      expect(r.rows).toEqual([]);
      expect(r.cursor).toBeNull();
    });

    it("JSON-decodes attribute-map columns in returned rows", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { key1: "value1" },
        resourceAttributes: { env: "prod" },
      });
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
      };
      const r = await ds.executeTracesQuery(q);
      const row = r.rows[0];
      assertDefined(row);
      expect(row.SpanAttributes).toEqual({ key1: "value1" });
      expect((row.ResourceAttributes as Record<string, unknown>).env).toBe(
        "prod"
      );
    });

    it("throws SqliteDatasourceQueryError on closed DB", async () => {
      const badConn = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConn);
      badConn.close();
      const q: TracesKopaiQuery = {
        signal: "traces",
        select: allTraceCols,
      };
      await expect(badDs.executeTracesQuery(q)).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });

  describe("executeLogsQuery — getLogs parity", () => {
    let conn: DatabaseSync;
    let ds: OptimizedDatasource;
    let insertLog: ReturnType<typeof createInsertLog>;

    beforeEach(() => {
      conn = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(conn);
      insertLog = createInsertLog(ds);
    });
    afterEach(() => {
      conn.close();
    });

    const allLogCols: LogsKopaiQuery["select"] = {
      Timestamp: { kind: "col", name: "timestamp" },
      TraceId: { kind: "col", name: "traceId" },
      SpanId: { kind: "col", name: "spanId" },
      ServiceName: { kind: "col", name: "serviceName" },
      ScopeName: { kind: "col", name: "scopeName" },
      SeverityText: { kind: "col", name: "severityText" },
      SeverityNumber: { kind: "col", name: "severityNumber" },
      Body: { kind: "col", name: "body" },
      LogAttributes: { kind: "col", name: "logAttributes" },
      ResourceAttributes: { kind: "col", name: "resourceAttributes" },
      ScopeAttributes: { kind: "col", name: "scopeAttributes" },
    };

    it("returns all logs default DESC order", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      await insertLog({ timeNanos: "2000000000000000" });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
      });
      expect(r.rows).toHaveLength(2);
      expect(asString(r.rows[0]?.Timestamp)).toBe("2000000000000000");
      expect(asString(r.rows[1]?.Timestamp)).toBe("1000000000000000");
    });

    it("filters by traceId", async () => {
      await insertLog({ timeNanos: "1000000000000000", traceId: "target" });
      await insertLog({ timeNanos: "2000000000000000", traceId: "other" });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "traceId" },
          value: "target",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.TraceId).toBe("target");
    });

    it("filters by serviceName", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        serviceName: "svc-a",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        serviceName: "svc-b",
      });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "serviceName" },
          value: "svc-a",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.ServiceName).toBe("svc-a");
    });

    it("filters by severityNumber range (gte+lte)", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityNumber: 5 });
      await insertLog({ timeNanos: "2000000000000000", severityNumber: 10 });
      await insertLog({ timeNanos: "3000000000000000", severityNumber: 15 });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "and",
          exprs: [
            {
              kind: "gte",
              col: { kind: "col", name: "severityNumber" },
              value: 8,
            },
            {
              kind: "lte",
              col: { kind: "col", name: "severityNumber" },
              value: 12,
            },
          ],
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.SeverityNumber).toBe(10);
    });

    it("substring match via LIKE on body", async () => {
      await insertLog({ timeNanos: "1000000000000000", body: "hello world" });
      await insertLog({
        timeNanos: "2000000000000000",
        body: "error occurred",
      });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "like",
          col: { kind: "col", name: "body" },
          value: "%error%",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Body).toContain("error");
    });

    it("filters by logAttributes via attr-map", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        logAttributes: { component: "auth" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        logAttributes: { component: "db" },
      });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "eq",
          col: { kind: "attr", map: "logAttributes", key: "component" },
          value: "auth",
        },
      });
      expect(r.rows).toHaveLength(1);
    });

    it("filters by timeRange", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      await insertLog({ timeNanos: "2000000000000000" });
      await insertLog({ timeNanos: "3000000000000000" });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        timeRange: {
          start: "1500000000000000",
          end: "2500000000000000",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(asString(r.rows[0]?.Timestamp)).toBe("2000000000000000");
    });

    it("paginates via cursor with rowid tiebreaker", async () => {
      const sameTs = "1000000000000000";
      await insertLog({ timeNanos: sameTs, body: "a" });
      await insertLog({ timeNanos: sameTs, body: "b" });
      await insertLog({ timeNanos: sameTs, body: "c" });
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let p = 0; p < 3; p++) {
        const r = await ds.executeLogsQuery({
          signal: "logs",
          select: allLogCols,
          limit: 1,
          cursor,
        });
        expect(r.rows).toHaveLength(1);
        seen.add(asString(r.rows[0]?.Body));
        cursor = r.cursor ?? undefined;
      }
      expect(seen).toEqual(new Set(["a", "b", "c"]));
    });

    it("sorts ASC", async () => {
      await insertLog({ timeNanos: "2000000000000000" });
      await insertLog({ timeNanos: "1000000000000000" });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        orderBy: [{ col: { kind: "col", name: "timestamp" }, dir: "asc" }],
      });
      expect(asString(r.rows[0]?.Timestamp)).toBe("1000000000000000");
      expect(asString(r.rows[1]?.Timestamp)).toBe("2000000000000000");
    });

    it("respects limit + cursor presence", async () => {
      for (let i = 0; i < 5; i++) {
        await insertLog({
          timeNanos: `${(i + 1) * 1000000000000000}`,
        });
      }
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        limit: 3,
      });
      expect(r.rows).toHaveLength(3);
      expect(r.cursor).not.toBeNull();
    });

    it("returns empty rows + null cursor on no match", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      const r = await ds.executeLogsQuery({
        signal: "logs",
        select: allLogCols,
        where: {
          kind: "eq",
          col: { kind: "col", name: "traceId" },
          value: "nope",
        },
      });
      expect(r.rows).toEqual([]);
      expect(r.cursor).toBeNull();
    });

    it("throws on closed DB", async () => {
      const badConn = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConn);
      badConn.close();
      await expect(
        badDs.executeLogsQuery({
          signal: "logs",
          select: allLogCols,
        })
      ).rejects.toThrow(SqliteDatasourceQueryError);
    });
  });

  describe("executeMetricsQuery — getMetrics parity", () => {
    let conn: DatabaseSync;
    let ds: OptimizedDatasource;

    beforeEach(() => {
      conn = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(conn);
    });
    afterEach(() => {
      conn.close();
    });

    it("returns gauge metrics filtered to metricType 'gauge'", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 42,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Value: { kind: "col", name: "value" },
          TimeUnix: { kind: "col", name: "timeUnix" },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.MetricName).toBe("cpu.usage");
      expect(r.rows[0]?.Value).toBe(42);
    });

    it("returns sum metrics with IsMonotonic + AggregationTemporality", async () => {
      const ins = createInsertSum(ds);
      await ins({
        metricName: "requests",
        timeUnixNano: "1000000000000000",
        value: 100,
        isMonotonic: true,
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "sum",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Value: { kind: "col", name: "value" },
          IsMonotonic: { kind: "col", name: "isMonotonic" },
          AggregationTemporality: {
            kind: "col",
            name: "aggregationTemporality",
          },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.MetricName).toBe("requests");
      expect(r.rows[0]?.Value).toBe(100);
    });

    it("returns histogram metrics with Count, Sum, BucketCounts", async () => {
      const ins = createInsertHistogram(ds);
      await ins({
        metricName: "latency",
        timeUnixNano: "1000000000000000",
        count: 5,
        sum: 100,
        bucketCounts: [1, 2, 2],
        explicitBounds: [10, 50],
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "histogram",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Count: { kind: "col", name: "count" },
          Sum: { kind: "col", name: "sum" },
          BucketCounts: { kind: "col", name: "bucketCounts" },
          ExplicitBounds: { kind: "col", name: "explicitBounds" },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Count).toBe(5);
      expect(r.rows[0]?.Sum).toBe(100);
    });

    it("returns exponential histogram metrics", async () => {
      const ins = createInsertExpHistogram(ds);
      await ins({
        metricName: "latency-exp",
        timeUnixNano: "1000000000000000",
        count: 10,
        sum: 1000,
        scale: 2,
        zeroCount: 1,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "exponentialHistogram",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Count: { kind: "col", name: "count" },
          Scale: { kind: "col", name: "scale" },
          ZeroCount: { kind: "col", name: "zeroCount" },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Scale).toBe(2);
      expect(r.rows[0]?.ZeroCount).toBe(1);
    });

    it("returns summary metrics", async () => {
      const ins = createInsertSummary(ds);
      await ins({
        metricName: "summary",
        timeUnixNano: "1000000000000000",
        count: 3,
        sum: 30,
        quantiles: [0.5, 0.9, 0.99],
        quantileValues: [5, 8, 9],
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "summary",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Count: { kind: "col", name: "count" },
          Sum: { kind: "col", name: "sum" },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Count).toBe(3);
      expect(r.rows[0]?.Sum).toBe(30);
    });

    it("filters by metricName", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "a",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      await ins({
        metricName: "b",
        timeUnixNano: "2000000000000000",
        value: 2,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: {
          MetricName: { kind: "col", name: "metricName" },
          Value: { kind: "col", name: "value" },
        },
        where: {
          kind: "eq",
          col: { kind: "col", name: "metricName" },
          value: "a",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.MetricName).toBe("a");
    });

    it("filters by serviceName + scopeName (AND)", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "m",
        timeUnixNano: "1000000000000000",
        value: 1,
        serviceName: "svc-a",
        scopeName: "scope-1",
      });
      await ins({
        metricName: "m",
        timeUnixNano: "2000000000000000",
        value: 2,
        serviceName: "svc-b",
        scopeName: "scope-2",
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: {
          ServiceName: { kind: "col", name: "serviceName" },
          ScopeName: { kind: "col", name: "scopeName" },
          Value: { kind: "col", name: "value" },
        },
        where: {
          kind: "and",
          exprs: [
            {
              kind: "eq",
              col: { kind: "col", name: "serviceName" },
              value: "svc-a",
            },
            {
              kind: "eq",
              col: { kind: "col", name: "scopeName" },
              value: "scope-1",
            },
          ],
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Value).toBe(1);
    });

    it("filters by timeRange on TimeUnix", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "m",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      await ins({
        metricName: "m",
        timeUnixNano: "2000000000000000",
        value: 2,
      });
      await ins({
        metricName: "m",
        timeUnixNano: "3000000000000000",
        value: 3,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: { Value: { kind: "col", name: "value" } },
        timeRange: {
          start: "1500000000000000",
          end: "2500000000000000",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Value).toBe(2);
    });

    it("filters by attributes via attr-map", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "m",
        timeUnixNano: "1000000000000000",
        value: 1,
        attributes: { region: "us" },
      });
      await ins({
        metricName: "m",
        timeUnixNano: "2000000000000000",
        value: 2,
        attributes: { region: "eu" },
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: { Value: { kind: "col", name: "value" } },
        where: {
          kind: "eq",
          col: { kind: "attr", map: "attributes", key: "region" },
          value: "us",
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.Value).toBe(1);
    });

    it("paginates via cursor + rowid tiebreaker", async () => {
      const ins = createInsertGauge(ds);
      const sameTs = "1000000000000000";
      for (const v of [10, 20, 30]) {
        await ins({ metricName: "m", timeUnixNano: sameTs, value: v });
      }
      const seen: number[] = [];
      let cursor: string | undefined;
      for (let p = 0; p < 3; p++) {
        const r = await ds.executeMetricsQuery({
          signal: "metrics",
          metricType: "gauge",
          select: { Value: { kind: "col", name: "value" } },
          limit: 1,
          cursor,
        });
        expect(r.rows).toHaveLength(1);
        seen.push(r.rows[0]?.Value as number);
        cursor = r.cursor ?? undefined;
      }
      expect(seen.sort()).toEqual([10, 20, 30]);
    });

    it("sorts ASC by TimeUnix", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "m",
        timeUnixNano: "2000000000000000",
        value: 2,
      });
      await ins({
        metricName: "m",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: { Value: { kind: "col", name: "value" } },
        orderBy: [{ col: { kind: "col", name: "timeUnix" }, dir: "asc" }],
      });
      expect(r.rows[0]?.Value).toBe(1);
      expect(r.rows[1]?.Value).toBe(2);
    });

    it("returns empty + null cursor on no match", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "a",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: { Value: { kind: "col", name: "value" } },
        where: {
          kind: "eq",
          col: { kind: "col", name: "metricName" },
          value: "nope",
        },
      });
      expect(r.rows).toEqual([]);
      expect(r.cursor).toBeNull();
    });

    it("throws on closed DB", async () => {
      const badConn = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConn);
      badConn.close();
      await expect(
        badDs.executeMetricsQuery({
          signal: "metrics",
          metricType: "gauge",
          select: { Value: { kind: "col", name: "value" } },
        })
      ).rejects.toThrow(SqliteDatasourceQueryError);
    });
  });

  describe("executeMetricsQuery — getAggregatedMetrics parity", () => {
    let conn: DatabaseSync;
    let ds: OptimizedDatasource;

    beforeEach(() => {
      conn = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(conn);
    });
    afterEach(() => {
      conn.close();
    });

    it("sums values grouped by attribute key", async () => {
      const ins = createInsertSum(ds);
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000000",
        value: 5,
        attributes: { route: "/a" },
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000001",
        value: 7,
        attributes: { route: "/a" },
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000002",
        value: 3,
        attributes: { route: "/b" },
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "sum",
        select: {
          route: { kind: "attr", map: "attributes", key: "route" },
          total: {
            kind: "agg",
            fn: "sum",
            col: { kind: "col", name: "value" },
          },
        },
        groupBy: [{ kind: "attr", map: "attributes", key: "route" }],
      });

      const byRoute: Record<string, unknown> = {};
      for (const row of r.rows) {
        byRoute[String(row.route)] = row.total;
      }
      expect(byRoute["/a"]).toBe(12);
      expect(byRoute["/b"]).toBe(3);
      expect(r.cursor).toBeNull();
    });

    it("groups by multiple attribute keys", async () => {
      const ins = createInsertSum(ds);
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000000",
        value: 1,
        attributes: { route: "/a", method: "GET" },
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000001",
        value: 2,
        attributes: { route: "/a", method: "POST" },
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000002",
        value: 3,
        attributes: { route: "/a", method: "GET" },
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "sum",
        select: {
          route: { kind: "attr", map: "attributes", key: "route" },
          method: { kind: "attr", map: "attributes", key: "method" },
          total: {
            kind: "agg",
            fn: "sum",
            col: { kind: "col", name: "value" },
          },
        },
        groupBy: [
          { kind: "attr", map: "attributes", key: "route" },
          { kind: "attr", map: "attributes", key: "method" },
        ],
      });
      expect(r.rows.length).toBe(2);
      const aggMap: Record<string, unknown> = {};
      for (const row of r.rows) {
        aggMap[`${row.route}|${row.method}`] = row.total;
      }
      expect(aggMap["/a|GET"]).toBe(4);
      expect(aggMap["/a|POST"]).toBe(2);
    });

    it("aggregates without groupBy (one row)", async () => {
      const ins = createInsertSum(ds);
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000001",
        value: 2,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "sum",
        select: {
          total: {
            kind: "agg",
            fn: "sum",
            col: { kind: "col", name: "value" },
          },
          n: { kind: "agg", fn: "count" },
        },
      });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.total).toBe(3);
      expect(r.rows[0]?.n).toBe(2);
      expect(r.cursor).toBeNull();
    });

    it("applies time range to aggregation", async () => {
      const ins = createInsertSum(ds);
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "1000000000000000",
        value: 1,
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "2000000000000000",
        value: 2,
      });
      await ins({
        metricName: "rpc.count",
        timeUnixNano: "3000000000000000",
        value: 3,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "sum",
        select: {
          total: {
            kind: "agg",
            fn: "sum",
            col: { kind: "col", name: "value" },
          },
        },
        timeRange: {
          start: "1500000000000000",
          end: "2500000000000000",
        },
      });
      expect(r.rows[0]?.total).toBe(2);
    });

    it("avg / min / max aggregates", async () => {
      const ins = createInsertGauge(ds);
      await ins({
        metricName: "m",
        timeUnixNano: "1000000000000000",
        value: 10,
      });
      await ins({
        metricName: "m",
        timeUnixNano: "2000000000000000",
        value: 20,
      });
      await ins({
        metricName: "m",
        timeUnixNano: "3000000000000000",
        value: 30,
      });
      const r = await ds.executeMetricsQuery({
        signal: "metrics",
        metricType: "gauge",
        select: {
          avg: {
            kind: "agg",
            fn: "avg",
            col: { kind: "col", name: "value" },
          },
          mn: {
            kind: "agg",
            fn: "min",
            col: { kind: "col", name: "value" },
          },
          mx: {
            kind: "agg",
            fn: "max",
            col: { kind: "col", name: "value" },
          },
        },
      });
      expect(r.rows[0]?.avg).toBe(20);
      expect(r.rows[0]?.mn).toBe(10);
      expect(r.rows[0]?.mx).toBe(30);
    });
  });

  describe("KopaiQuery parity for discovery-style methods", () => {
    let conn: DatabaseSync;
    let ds: OptimizedDatasource;
    let insertSpan: ReturnType<typeof createInsertSpan>;

    beforeEach(() => {
      conn = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(conn);
      insertSpan = createInsertSpan(ds);
    });
    afterEach(() => {
      conn.close();
    });

    it("getServices — distinct serviceName via groupBy + count", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "svc-a",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "svc-b",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        serviceName: "svc-a",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });
      const r = await ds.executeTracesQuery({
        signal: "traces",
        select: {
          service: { kind: "col", name: "serviceName" },
          n: { kind: "agg", fn: "count" },
        },
        groupBy: [{ kind: "col", name: "serviceName" }],
        orderBy: [{ col: { kind: "col", name: "serviceName" }, dir: "asc" }],
      });
      expect(r.rows.map((row) => row.service)).toEqual(["svc-a", "svc-b"]);
    });

    it("getOperations — distinct spanName per service via groupBy", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "svc-a",
        spanName: "GET /a",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "svc-a",
        spanName: "POST /a",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        serviceName: "svc-b",
        spanName: "GET /b",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });
      const r = await ds.executeTracesQuery({
        signal: "traces",
        select: {
          op: { kind: "col", name: "spanName" },
          n: { kind: "agg", fn: "count" },
        },
        where: {
          kind: "eq",
          col: { kind: "col", name: "serviceName" },
          value: "svc-a",
        },
        groupBy: [{ kind: "col", name: "spanName" }],
        orderBy: [{ col: { kind: "col", name: "spanName" }, dir: "asc" }],
      });
      expect(r.rows.map((row) => row.op)).toEqual(["GET /a", "POST /a"]);
    });

    // Schema gaps — followup PRs (see plan)
    it.todo(
      "discoverMetrics — requires json_each unnesting + _truncated metadata"
    );
    it.todo(
      "getTraceSummaries — requires scalar subquery + root-span aggregate + multi-pass execution"
    );
  });
});
