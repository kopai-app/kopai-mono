/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import {
  OptimizedDatasource,
  createOptimizedDatasource,
} from "./optimized-datasource.js";
import {
  otlp,
  kopaiQueryCompiler,
  type datasource,
  type kopaiQuery as kopaiQueryNs,
} from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";

function assertDefined<T>(
  value: T | undefined | null,
  msg = "Expected defined"
): asserts value is T {
  if (value === undefined || value === null) throw new Error(msg);
}

// Typed wrappers around kopaiQueryCompiler.allStructuralColumns. The
// core helper returns `string[]` because it spreads three different
// structural-name sets; here we re-type the result to the exact per-
// signal column literal union via a generic helper. The validator
// enforces the literal-set invariant at runtime, so the
// `<unknown[]>` round-trip avoids an `as`-to-narrow cast.
function structuralDimensions<S extends "traces">(
  signal: S
): NonNullable<kopaiQueryNs.TraceRawQuery["dimensions"]>;
function structuralDimensions<S extends "logs">(
  signal: S
): NonNullable<kopaiQueryNs.LogRawQuery["dimensions"]>;
function structuralDimensions(signal: "traces" | "logs"): unknown[] {
  return kopaiQueryCompiler.allStructuralColumns(signal);
}

// Time window wide enough to cover the synthetic 1970-era timestamps used
// in tests + present-day timestamps. Upper bound kept inside SQLite's i64
// nanosecond range (max ≈ 9.22e18). 2200-01-01 ≈ 7.26e18 ns.
const WIDE_WINDOW = {
  type: "absolute" as const,
  startTime: "1970-01-01T00:00:00.000Z",
  endTime: "2200-01-01T00:00:00.000Z",
};

describe("OptimizedDatasource.query (KopaiQuery)", () => {
  // ============================================================
  // Traces — raw mode
  // ============================================================
  describe("traces raw", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertSpan: ReturnType<typeof createInsertSpan>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertSpan = createInsertSpan(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("returns all spans with no filters, default limit, DESC order", async () => {
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

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: structuralDimensions("traces"),
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2");
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1");
      expect(result.nextCursor).toBeNull();
    });

    it("filters by TraceId via string filter", async () => {
      await insertSpan({
        traceId: "target",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "other",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId"],
        filters: [{ column: "TraceId", op: "eq", value: "target" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("target");
    });

    it("filters by service.name semconv attribute (resource container)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "target",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "other",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId"],
        filters: [{ column: "service.name", op: "eq", value: "target" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("target");
    });

    it("filters by SpanName + time-range (number filter)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        spanName: "GET /api",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        spanName: "POST /api",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        spanName: "GET /api",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId", "SpanName", "Timestamp"],
        filters: [
          { column: "SpanName", op: "eq", value: "GET /api" },
          { column: "Timestamp", op: "lte", value: 1500000000000000 },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("s1");
    });

    it("filters via attribute container reference (SpanAttributes)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { "http.method": "GET", custom: "yes" },
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        spanAttributes: { "http.method": "POST", custom: "no" },
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId"],
        filters: [
          {
            column: { container: "SpanAttributes", key: "custom" },
            op: "eq",
            value: "yes",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("s1");
    });

    it("respects limit + returns next cursor for pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `trace${i}`,
          spanId: `span${i}`,
          startTimeNanos: `${(i + 1) * 1000000000000000}`,
          endTimeNanos: `${(i + 1) * 1000000000000000 + 1000000000000}`,
        });
      }

      const page1 = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId", "Timestamp"],
        timeDimension: WIDE_WINDOW,
        limit: 2,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const p1r0 = page1.data[0];
      assertDefined(p1r0);
      expect(p1r0.SpanId).toBe("span4");

      assertDefined(page1.nextCursor);
      const page2 = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId", "Timestamp"],
        timeDimension: WIDE_WINDOW,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      const p2r0 = page2.data[0];
      assertDefined(p2r0);
      expect(p2r0.SpanId).toBe("span2");
    });

    it("returns full denormalized OtelTracesRow shape regardless of dimensions", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { key1: "value1" },
        resourceAttributes: { env: "prod" },
      });

      // Even though dimensions only lists TraceId, full shape is returned.
      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId"],
        timeDimension: WIDE_WINDOW,
      });

      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("t1");
      expect(row.SpanId).toBe("s1");
      expect(row.SpanAttributes).toEqual({ key1: "value1" });
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
    });

    it("raw mode without dimensions returns full denormalized OtelTracesRow", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        spanName: "GET /api",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { foo: "bar" },
        resourceAttributes: { env: "prod" },
      });

      // No `dimensions` field — Phase A made it optional on raw queries.
      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      // Structural columns
      expect(row.TraceId).toBe("t1");
      expect(row.SpanId).toBe("s1");
      expect(row.SpanName).toBe("GET /api");
      expect(row.Timestamp).toBeDefined();
      expect(row.Duration).toBeDefined();
      // Attribute maps survive the full-denormalized projection.
      expect(row.SpanAttributes).toEqual({ foo: "bar" });
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
    });

    // Parity with old `searchTraces` filters: ParentSpanId, StatusCode,
    // SpanKind, Duration range. None were covered before this commit.

    it("filters by ParentSpanId (old searchTraces.parentSpanId parity)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "root",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t1",
        spanId: "child",
        parentSpanId: "root",
        startTimeNanos: "1000500000000000",
        endTimeNanos: "1000900000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId", "ParentSpanId"],
        filters: [{ column: "ParentSpanId", op: "eq", value: "root" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("child");
    });

    it("filters by StatusCode (old searchTraces.statusCode parity)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "ok",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "err",
        statusCode: otlp.StatusCode.STATUS_CODE_ERROR,
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId", "StatusCode"],
        filters: [
          { column: "StatusCode", op: "eq", value: "STATUS_CODE_ERROR" },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("err");
    });

    it("filters by SpanKind (old searchTraces.spanKind parity)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "server",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "client",
        spanKind: otlp.SpanKind.SPAN_KIND_CLIENT,
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId", "SpanKind"],
        filters: [{ column: "SpanKind", op: "eq", value: "SPAN_KIND_SERVER" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("server");
    });

    it("filters by Duration range (old searchTraces.durationMin/Max parity)", async () => {
      // The Duration range parity assumes the writer pipeline stores
      // Duration as `endTimeNanos - startTimeNanos`. Assert that
      // invariant explicitly on the matched row so a writer-side
      // regression surfaces as a clearer failure here.
      await insertSpan({
        traceId: "t1",
        spanId: "fast",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1000001000000000", // 1e9 ns
      });
      await insertSpan({
        traceId: "t2",
        spanId: "med",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2000005000000000", // 5e9 ns
      });
      await insertSpan({
        traceId: "t3",
        spanId: "slow",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3000020000000000", // 2e10 ns
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId", "Duration"],
        filters: [
          { column: "Duration", op: "gte", value: 2_000_000_000 },
          { column: "Duration", op: "lte", value: 10_000_000_000 },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("med");
      // Writer-pipeline sanity: Duration == endTimeNanos - startTimeNanos.
      expect(Number(row.Duration)).toBe(5_000_000_000);
    });

    it("filters by ResourceAttributes container (old searchTraces.resourceAttributes parity)", async () => {
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        resourceAttributes: { "service.version": "1.0" },
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        resourceAttributes: { "service.version": "2.0" },
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId"],
        filters: [
          {
            column: {
              container: "ResourceAttributes",
              key: "service.version",
            },
            op: "eq",
            value: "2.0",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("s2");
    });

    it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
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

      const result = await readDs.query({
        signal: "traces",
        mode: "raw",
        dimensions: ["TraceId", "SpanId", "Timestamp"],
        timeDimension: WIDE_WINDOW,
        orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      });

      expect(result.data).toHaveLength(3);
      const ids = result.data.map((r) => r.SpanId);
      expect(ids).toEqual(["s1", "s2", "s3"]);
    });
  });

  // ============================================================
  // Logs — raw mode
  // ============================================================
  describe("logs raw", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertLog: ReturnType<typeof createInsertLog>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertLog = createInsertLog(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("returns all logs DESC by default", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      await insertLog({ timeNanos: "2000000000000000" });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: structuralDimensions("logs"),
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.Timestamp).toBe("2000000000000000");
    });

    it("filters by TraceId", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        traceId: "target",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        traceId: "other",
      });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["TraceId", "Timestamp"],
        filters: [{ column: "TraceId", op: "eq", value: "target" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("target");
    });

    it("filters by SeverityNumber via number filter", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityNumber: 5 });
      await insertLog({ timeNanos: "2000000000000000", severityNumber: 10 });
      await insertLog({ timeNanos: "3000000000000000", severityNumber: 15 });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "SeverityNumber"],
        filters: [
          { column: "SeverityNumber", op: "gte", value: 8 },
          { column: "SeverityNumber", op: "lte", value: 12 },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SeverityNumber).toBe(10);
    });

    it("filters by attribute container reference (LogAttributes)", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        logAttributes: { "request.id": "abc123" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        logAttributes: { "request.id": "xyz789" },
      });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp"],
        filters: [
          {
            column: { container: "LogAttributes", key: "request.id" },
            op: "eq",
            value: "abc123",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.LogAttributes).toEqual({ "request.id": "abc123" });
    });

    it("body contains via string contains filter", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        body: "User logged in successfully",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        body: "Database connection failed",
      });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "Body"],
        filters: [{ column: "Body", op: "contains", value: "logged in" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toContain("logged in");
    });

    // Parity with old SDK `searchLogs` capabilities that lacked tests:
    // pagination, ASC sortOrder, SeverityText, ResourceAttributes,
    // ScopeName, case-insensitive Body.contains.

    it("respects limit + returns next cursor for pagination (old searchLogsPage parity)", async () => {
      for (let i = 0; i < 5; i++) {
        await insertLog({
          timeNanos: `${String((i + 1) * 1_000_000_000_000_000)}`,
          body: `log-${String(i)}`,
        });
      }

      const page1 = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "Body"],
        timeDimension: WIDE_WINDOW,
        limit: 2,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      assertDefined(page1.nextCursor);

      const page2 = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "Body"],
        timeDimension: WIDE_WINDOW,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      // Pages must not overlap AND must cover 4 distinct logs (the 5th
      // remains unread under the 2+2 pagination). Catches "cursor skips
      // a row" regressions that a no-overlap check alone would miss.
      const union = new Set([
        ...page1.data.map((r) => r.Body),
        ...page2.data.map((r) => r.Body),
      ]);
      expect(union.size).toBe(4);
    });

    it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
      await insertLog({ timeNanos: "1000000000000000", body: "first" });
      await insertLog({ timeNanos: "2000000000000000", body: "second" });
      await insertLog({ timeNanos: "3000000000000000", body: "third" });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "Body"],
        timeDimension: WIDE_WINDOW,
        orderBy: [{ type: "dimension", column: "Timestamp", direction: "asc" }],
      });

      expect(result.data).toHaveLength(3);
      expect(result.data.map((r) => r.Body)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });

    it("filters by SeverityText exact match (old searchLogs.severityText parity)", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityText: "INFO" });
      await insertLog({ timeNanos: "2000000000000000", severityText: "ERROR" });
      await insertLog({ timeNanos: "3000000000000000", severityText: "WARN" });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "SeverityText"],
        filters: [{ column: "SeverityText", op: "eq", value: "ERROR" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SeverityText).toBe("ERROR");
    });

    it("filters by ResourceAttributes container (old searchLogs.resourceAttributes parity)", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        resourceAttributes: { "deployment.env": "prod" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        resourceAttributes: { "deployment.env": "staging" },
      });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp"],
        filters: [
          {
            column: { container: "ResourceAttributes", key: "deployment.env" },
            op: "eq",
            value: "prod",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Timestamp).toBe("1000000000000000");
    });

    it("filters by ScopeName structural column (old searchLogs.scopeName parity)", async () => {
      await insertLog({ timeNanos: "1000000000000000", scopeName: "scope-a" });
      await insertLog({ timeNanos: "2000000000000000", scopeName: "scope-b" });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "ScopeName"],
        filters: [{ column: "ScopeName", op: "eq", value: "scope-b" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ScopeName).toBe("scope-b");
    });

    it("body contains is case-insensitive (parity with old SDK bodyContains ILIKE)", async () => {
      // Old SDK `searchLogs.bodyContains` compiled to ClickHouse ILIKE,
      // which is case-insensitive. The new `contains` operator on the
      // sqlite backend compiles to `LIKE` for parity — SQLite's default
      // LIKE is case-insensitive for ASCII, matching ILIKE for typical
      // log-body searches. Lowercase needle vs. capitalized body must
      // still match.
      await insertLog({
        timeNanos: "1000000000000000",
        body: "Database connection failed",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        body: "User logged in",
      });

      const result = await readDs.query({
        signal: "logs",
        mode: "raw",
        dimensions: ["Timestamp", "Body"],
        filters: [{ column: "Body", op: "contains", value: "database" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toBe("Database connection failed");
    });
  });

  // ============================================================
  // Metrics — raw mode (per MetricType)
  // ============================================================
  describe("metrics raw", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertGauge: ReturnType<typeof createInsertGauge>;
    let insertSum: ReturnType<typeof createInsertSum>;
    let insertHistogram: ReturnType<typeof createInsertHistogram>;
    let insertExpHistogram: ReturnType<typeof createInsertExpHistogram>;
    let insertSummary: ReturnType<typeof createInsertSummary>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertGauge = createInsertGauge(ds);
      insertSum = createInsertSum(ds);
      insertHistogram = createInsertHistogram(ds);
      insertExpHistogram = createInsertExpHistogram(ds);
      insertSummary = createInsertSummary(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("rejects metric query without MetricType filter", async () => {
      await expect(
        readDs.query({
          signal: "metrics",
          mode: "raw",
          dimensions: ["MetricName"],
          timeDimension: WIDE_WINDOW,
        })
      ).rejects.toThrow();
    });

    it("returns Gauge rows with MetricType filter", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertSum({
        metricName: "request.count",
        timeUnixNano: "2000000000000000",
        value: 100,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Gauge");
      expect(row.MetricName).toBe("cpu.usage");
    });

    it("returns Sum rows", async () => {
      await insertSum({
        metricName: "request.count",
        timeUnixNano: "1000000000000000",
        value: 42,
        isMonotonic: true,
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [{ column: "MetricType", op: "eq", value: "Sum" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Sum");
      if (row.MetricType === "Sum") {
        expect(row.Value).toBe(42);
        expect(row.IsMonotonic).toBe(1);
      }
    });

    it("returns Histogram rows", async () => {
      await insertHistogram({
        metricName: "http.latency",
        timeUnixNano: "1000000000000000",
        count: 10,
        sum: 500,
        bucketCounts: [1, 2, 3, 4],
        explicitBounds: [10, 50, 100],
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Count"],
        filters: [{ column: "MetricType", op: "eq", value: "Histogram" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      if (row.MetricType === "Histogram") {
        expect(row.Count).toBe(10);
        expect(row.BucketCounts).toEqual([1, 2, 3, 4]);
      }
    });

    it("returns ExponentialHistogram rows", async () => {
      await insertExpHistogram({
        metricName: "req.duration",
        timeUnixNano: "1000000000000000",
        count: 100,
        sum: 5000,
        scale: 3,
        zeroCount: 5,
        positiveBucketCounts: [10, 20, 30],
        positiveOffset: 1,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Scale"],
        filters: [
          { column: "MetricType", op: "eq", value: "ExponentialHistogram" },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      if (row.MetricType === "ExponentialHistogram") {
        expect(row.Scale).toBe(3);
        expect(row.ZeroCount).toBe(5);
      }
    });

    it("returns Summary rows", async () => {
      await insertSummary({
        metricName: "request.latency",
        timeUnixNano: "1000000000000000",
        count: 50,
        sum: 2500,
        quantiles: [0.5, 0.9, 0.99],
        quantileValues: [25, 80, 120],
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Count"],
        filters: [{ column: "MetricType", op: "eq", value: "Summary" }],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      if (row.MetricType === "Summary") {
        expect(row.Count).toBe(50);
        expect(row["ValueAtQuantiles.Quantile"]).toEqual([0.5, 0.9, 0.99]);
      }
    });

    // Parity with old SDK `searchMetrics` capabilities that lacked
    // tests: pagination, ASC sortOrder, MetricName / attributes /
    // service.name / ResourceAttributes filtering in raw mode.

    it("respects limit + returns next cursor for pagination (old searchMetricsPage parity)", async () => {
      for (let i = 0; i < 5; i++) {
        await insertGauge({
          metricName: "cpu.usage",
          timeUnixNano: `${String((i + 1) * 1_000_000_000_000_000)}`,
          value: i * 0.1,
          attributes: { cpu: `${String(i)}` },
        });
      }

      const page1 = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
        limit: 2,
      });
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      assertDefined(page1.nextCursor);

      const page2 = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      // Pages must cover 4 distinct rows (5th remains unread). Catches
      // "cursor skips a row" regressions. Discriminator: Value, since
      // each seeded row has a unique value (i * 0.1).
      const union = new Set([
        ...page1.data.map((r) => (r.MetricType === "Gauge" ? r.Value : null)),
        ...page2.data.map((r) => (r.MetricType === "Gauge" ? r.Value : null)),
      ]);
      expect(union.size).toBe(4);
    });

    it("orderBy ascending reverses default DESC (old sortOrder=ASC parity)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.1,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "3000000000000000",
        value: 0.9,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "TimeUnix", "Value"],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
        orderBy: [{ type: "dimension", column: "TimeUnix", direction: "asc" }],
      });

      expect(result.data).toHaveLength(3);
      const values = result.data.map((r) => {
        if (r.MetricType !== "Gauge") throw new Error("expected Gauge");
        return r.Value;
      });
      expect(values).toEqual([0.1, 0.5, 0.9]);
    });

    it("filters by MetricName (old searchMetrics.metricName parity)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.5,
      });
      await insertGauge({
        metricName: "memory.usage",
        timeUnixNano: "2000000000000000",
        value: 0.3,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [
          { column: "MetricType", op: "eq", value: "Gauge" },
          { column: "MetricName", op: "eq", value: "memory.usage" },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricName).toBe("memory.usage");
    });

    it("filters by Attributes container (old searchMetrics.attributes parity)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.5,
        attributes: { cpu: "0" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.6,
        attributes: { cpu: "1" },
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [
          { column: "MetricType", op: "eq", value: "Gauge" },
          {
            column: { container: "Attributes", key: "cpu" },
            op: "eq",
            value: "1",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      if (row.MetricType !== "Gauge") throw new Error("expected Gauge");
      expect(row.Value).toBe(0.6);
    });

    it("filters by service.name (old searchMetrics.serviceName parity)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.5,
        serviceName: "alpha",
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.6,
        serviceName: "beta",
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [
          { column: "MetricType", op: "eq", value: "Gauge" },
          { column: "service.name", op: "eq", value: "beta" },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("beta");
    });

    it("filters by ResourceAttributes container (old searchMetrics.resourceAttributes parity)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.5,
        resourceAttributes: { region: "us-east" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.6,
        resourceAttributes: { region: "eu-west" },
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "raw",
        dimensions: ["MetricName", "MetricType", "Value"],
        filters: [
          { column: "MetricType", op: "eq", value: "Gauge" },
          {
            column: { container: "ResourceAttributes", key: "region" },
            op: "eq",
            value: "eu-west",
          },
        ],
        timeDimension: WIDE_WINDOW,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      if (row.MetricType !== "Gauge") throw new Error("expected Gauge");
      expect(row.Value).toBe(0.6);
    });
  });

  // ============================================================
  // Metrics — aggregate mode (mirrors getAggregatedMetrics)
  // ============================================================
  describe("metrics aggregate", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertSum: ReturnType<typeof createInsertSum>;
    let insertGauge: ReturnType<typeof createInsertGauge>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertSum = createInsertSum(ds);
      insertGauge = createInsertGauge(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("aggregates SUM(Value) grouped by attribute", async () => {
      await insertSum({
        metricName: "ingestion.bytes",
        timeUnixNano: "1000000000000000",
        value: 100,
        attributes: { signal: "/v1/traces" },
      });
      await insertSum({
        metricName: "ingestion.bytes",
        timeUnixNano: "2000000000000000",
        value: 200,
        attributes: { signal: "/v1/traces" },
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "SUM", column: "Value", as: "total" }],
        dimensions: [{ container: "Attributes", key: "signal" }],
        filters: [
          { column: "MetricType", op: "eq", value: "Sum" },
          { column: "MetricName", op: "eq", value: "ingestion.bytes" },
        ],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row["Attributes.signal"]).toBe("/v1/traces");
      expect(row.total).toBe(300);
    });

    it("supports AVG / MIN / MAX / COUNT", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.1,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "3000000000000000",
        value: 0.9,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [
          { op: "AVG", column: "Value", as: "avg_v" },
          { op: "MIN", column: "Value", as: "min_v" },
          { op: "MAX", column: "Value", as: "max_v" },
          { op: "COUNT", as: "cnt" },
        ],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.avg_v).toBeCloseTo(0.5);
      expect(row.min_v).toBe(0.1);
      expect(row.max_v).toBe(0.9);
      expect(row.cnt).toBe(3);
    });

    it("supports COUNT_DISTINCT", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.1,
        attributes: { host: "host-1" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.2,
        attributes: { host: "host-2" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "3000000000000000",
        value: 0.3,
        attributes: { host: "host-1" },
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [
          {
            op: "COUNT_DISTINCT",
            column: { container: "Attributes", key: "host" },
            as: "distinct_hosts",
          },
        ],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      const row = result.data[0];
      assertDefined(row);
      expect(row.distinct_hosts).toBe(2);
    });

    it("groups by multiple attributes", async () => {
      await insertSum({
        metricName: "ingestion.bytes",
        timeUnixNano: "1000000000000000",
        value: 100,
        attributes: { signal: "/v1/traces", "tenant.id": "t1" },
      });
      await insertSum({
        metricName: "ingestion.bytes",
        timeUnixNano: "2000000000000000",
        value: 50,
        attributes: { signal: "/v1/logs", "tenant.id": "t1" },
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "SUM", column: "Value", as: "total" }],
        dimensions: [
          { container: "Attributes", key: "signal" },
          { container: "Attributes", key: "tenant.id" },
        ],
        filters: [
          { column: "MetricType", op: "eq", value: "Sum" },
          { column: "MetricName", op: "eq", value: "ingestion.bytes" },
        ],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
        orderBy: [{ type: "measure", alias: "total", direction: "desc" }],
      });

      expect(result.data).toHaveLength(2);
      const first = result.data[0];
      assertDefined(first);
      expect(first.total).toBe(100);
      expect(first["Attributes.signal"]).toBe("/v1/traces");
    });

    it("HAVING filters groups by aggregated value", async () => {
      // 3 hosts: host-1 sums to 300, host-2 to 50, host-3 to 5
      const seed = async (
        host: string,
        ts: string,
        value: number
      ): Promise<void> => {
        await insertSum({
          metricName: "ingestion.bytes",
          timeUnixNano: ts,
          value,
          attributes: { host },
        });
      };
      await seed("host-1", "1000000000000000", 100);
      await seed("host-1", "1100000000000000", 200);
      await seed("host-2", "1200000000000000", 50);
      await seed("host-3", "1300000000000000", 5);

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "SUM", column: "Value", as: "total" }],
        dimensions: [{ container: "Attributes", key: "host" }],
        filters: [
          { column: "MetricType", op: "eq", value: "Sum" },
          { column: "MetricName", op: "eq", value: "ingestion.bytes" },
        ],
        havings: [{ measure: "total", op: "gt", value: 40 }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
        orderBy: [{ type: "measure", alias: "total", direction: "desc" }],
      });

      expect(result.data).toHaveLength(2);
      const hosts = result.data.map((r) => r["Attributes.host"]);
      expect(hosts).toEqual(["host-1", "host-2"]);
    });

    it("RATE_AVG / RATE_SUM / RATE_MAX divide by window seconds (summary mode)", async () => {
      // Absolute 100-second window keeps the denominator easy to compute.
      const window = {
        type: "absolute" as const,
        startTime: "2024-01-01T00:00:00.000Z",
        endTime: "2024-01-01T00:01:40.000Z", // +100s
      };
      const startNs =
        BigInt(Date.parse("2024-01-01T00:00:00.000Z")) * 1_000_000n;
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: (startNs + 1_000_000_000n).toString(),
        value: 10,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: (startNs + 2_000_000_000n).toString(),
        value: 30,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [
          { op: "RATE_AVG", column: "Value", as: "ravg" },
          { op: "RATE_SUM", column: "Value", as: "rsum" },
          { op: "RATE_MAX", column: "Value", as: "rmax" },
        ],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: window,
        output: { type: "summary" },
      });

      const row = result.data[0];
      assertDefined(row);
      // avg(10, 30) = 20 → 20/100 = 0.2
      expect(row.ravg).toBeCloseTo(0.2);
      // sum(10, 30) = 40 → 40/100 = 0.4
      expect(row.rsum).toBeCloseTo(0.4);
      // max(10, 30) = 30 → 30/100 = 0.3
      expect(row.rmax).toBeCloseTo(0.3);
    });

    it("timeSeries output buckets results by granularity with ISO bucket_start", async () => {
      const startNs =
        BigInt(Date.parse("2024-01-01T00:00:00.000Z")) * 1_000_000n;
      const HOUR_NS = 3_600n * 1_000_000_000n;
      // 3 points: hour-0 has two, hour-2 has one.
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: (startNs + 60_000_000_000n).toString(),
        value: 1,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: (startNs + 120_000_000_000n).toString(),
        value: 3,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: (startNs + 2n * HOUR_NS + 60_000_000_000n).toString(),
        value: 5,
      });

      const result = await readDs.query({
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "AVG", column: "Value", as: "avg_v" }],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: {
          type: "absolute",
          startTime: "2024-01-01T00:00:00.000Z",
          endTime: "2024-01-01T03:00:00.000Z",
        },
        output: { type: "timeSeries", granularity: "1h" },
      });

      // Buckets at 00:00 (avg 2) and 02:00 (avg 5). 01:00 has no data → no row.
      expect(result.data).toHaveLength(2);
      const byBucket = new Map<string, number>();
      for (const r of result.data) {
        const ts = r.bucket_start;
        if (typeof ts !== "string") throw new Error("bucket_start not string");
        // ISO datetime should parse cleanly.
        expect(Number.isNaN(Date.parse(ts))).toBe(false);
        const v = r.avg_v;
        if (typeof v !== "number") throw new Error("avg_v not number");
        byBucket.set(ts, v);
      }
      expect(byBucket.get("2024-01-01T00:00:00.000Z")).toBeCloseTo(2);
      expect(byBucket.get("2024-01-01T02:00:00.000Z")).toBeCloseTo(5);
    });

    it("percentile measures (P50/P95/P999) throw NotSupported on sqlite", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.5,
      });

      await expect(
        readDs.query({
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "P95", column: "Value", as: "p95" }],
          filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
          timeDimension: WIDE_WINDOW,
          output: { type: "summary" },
        })
      ).rejects.toThrow(/percentile/i);
    });
  });

  // ============================================================
  // Validator rejections (errors surfaced from @kopai/core)
  // ============================================================
  describe("validation", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
    });

    afterEach(() => {
      testConnection.close();
    });

    it("rejects metric query without a MetricType filter", async () => {
      await expect(
        readDs.query({
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "cnt" }],
          timeDimension: WIDE_WINDOW,
          output: { type: "summary" },
        })
      ).rejects.toThrow(/MetricType/);
    });

    it("rejects metric query where MetricType is buried inside an OR branch", async () => {
      await expect(
        readDs.query({
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "cnt" }],
          filters: [
            {
              or: [
                { column: "MetricType", op: "eq", value: "Gauge" },
                { column: "MetricType", op: "eq", value: "Sum" },
              ],
            },
          ],
          timeDimension: WIDE_WINDOW,
          output: { type: "summary" },
        })
      ).rejects.toThrow(/MetricType.*OR|OR.*MetricType|ambiguous/i);
    });
  });

  // ============================================================
  // Traces — aggregate mode (mirrors getTraceSummaries scalar fields)
  // services[] rollup not expressible; assert scalars only.
  // ============================================================
  describe("traces aggregate", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertSpan: ReturnType<typeof createInsertSpan>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertSpan = createInsertSpan(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("computes COUNT and ERROR_RATE per trace", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "root-span",
        serviceName: "frontend",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1000000500000000",
      });
      await insertSpan({
        traceId: "trace1",
        spanId: "child-span-1",
        parentSpanId: "root-span",
        serviceName: "backend",
        startTimeNanos: "1000000100000000",
        endTimeNanos: "1000000400000000",
      });
      await insertSpan({
        traceId: "trace1",
        spanId: "child-span-2",
        parentSpanId: "root-span",
        serviceName: "backend",
        statusCode: otlp.StatusCode.STATUS_CODE_ERROR,
        startTimeNanos: "1000000050000000",
        endTimeNanos: "1000000150000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "aggregate",
        measures: [
          { op: "COUNT", as: "span_count" },
          { op: "ERROR_RATE", as: "err_rate" },
          { op: "MAX", column: "Duration", as: "max_dur" },
        ],
        dimensions: ["TraceId"],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("trace1");
      expect(row.span_count).toBe(3);
      expect(row.err_rate).toBeCloseTo(1 / 3);
    });

    it("supports THROUGHPUT (spans / window seconds)", async () => {
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

      const result = await readDs.query({
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "THROUGHPUT", as: "rate" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      const row = result.data[0];
      assertDefined(row);
      const rate = row.rate;
      // 2 spans / ~32e9 seconds (1970 to 3000) — very small but positive.
      assertDefined(rate);
      if (typeof rate !== "number") throw new Error("rate must be number");
      expect(rate).toBeGreaterThan(0);
    });

    it("lists distinct ServiceName values — equivalent to old SDK getServices()", async () => {
      // Old SDK `getServices()` → { services: string[] } is reproducible
      // as a KopaiQuery aggregate over traces grouping by service.name.
      // Demonstrates that getServices is fully replaceable.
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "alpha",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "beta",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        serviceName: "alpha",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "aggregate",
        dimensions: ["service.name"],
        measures: [{ op: "COUNT", as: "n" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      const services = result.data
        .map((r) => r["service.name"])
        .filter((v): v is string => typeof v === "string")
        .sort();
      expect(services).toEqual(["alpha", "beta"]);
    });

    it("lists distinct SpanName values for a service — equivalent to old SDK getOperations(serviceName)", async () => {
      // Old SDK `getOperations(serviceName)` → { operations: string[] }
      // is reproducible as a KopaiQuery aggregate grouping by SpanName
      // with a service.name filter. Demonstrates that getOperations is
      // fully replaceable.
      await insertSpan({
        traceId: "t1",
        spanId: "s1",
        serviceName: "alpha",
        spanName: "GET /a",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "t2",
        spanId: "s2",
        serviceName: "alpha",
        spanName: "GET /b",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "t3",
        spanId: "s3",
        serviceName: "beta",
        spanName: "GET /c",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const result = await readDs.query({
        signal: "traces",
        mode: "aggregate",
        dimensions: ["SpanName"],
        filters: [{ column: "service.name", op: "eq", value: "alpha" }],
        measures: [{ op: "COUNT", as: "n" }],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
      });

      const ops = result.data
        .map((r) => r.SpanName)
        .filter((v): v is string => typeof v === "string")
        .sort();
      expect(ops).toEqual(["GET /a", "GET /b"]);
    });
  });

  // ============================================================
  // Logs — aggregate mode
  // ============================================================
  describe("logs aggregate", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertLog: ReturnType<typeof createInsertLog>;

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertLog = createInsertLog(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("counts logs grouped by SeverityText", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityText: "ERROR" });
      await insertLog({ timeNanos: "2000000000000000", severityText: "ERROR" });
      await insertLog({ timeNanos: "3000000000000000", severityText: "INFO" });

      const result = await readDs.query({
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "cnt" }],
        dimensions: ["SeverityText"],
        timeDimension: WIDE_WINDOW,
        output: { type: "summary" },
        orderBy: [{ type: "measure", alias: "cnt", direction: "desc" }],
      });

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SeverityText).toBe("ERROR");
      expect(row0.cnt).toBe(2);
    });
  });
});

// ============================================================
// Helpers (copied from datasource-read.test.ts — fixtures)
// ============================================================

function createInsertSpan(
  ds: Pick<datasource.WriteTracesDatasource, "writeTraces">
) {
  return async (opts: {
    traceId: string;
    spanId: string;
    serviceName?: string;
    spanName?: string;
    spanKind?: otlp.SpanKind;
    statusCode?: otlp.StatusCode;
    scopeName?: string;
    startTimeNanos: string;
    endTimeNanos: string;
    parentSpanId?: string;
    spanAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const spanAttrs = Object.entries(opts.spanAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeTraces({
      resourceSpans: [
        {
          resource: { attributes: resourceAttrs },
          scopeSpans: [
            {
              scope: { name: opts.scopeName ?? "test-scope" },
              spans: [
                {
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  parentSpanId: opts.parentSpanId,
                  name: opts.spanName ?? "test-span",
                  kind: opts.spanKind,
                  startTimeUnixNano: opts.startTimeNanos,
                  endTimeUnixNano: opts.endTimeNanos,
                  status: opts.statusCode
                    ? { code: opts.statusCode }
                    : undefined,
                  attributes: spanAttrs,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertLog(
  ds: Pick<datasource.WriteLogsDatasource, "writeLogs">
) {
  return async (opts: {
    timeNanos: string;
    traceId?: string;
    spanId?: string;
    serviceName?: string;
    scopeName?: string;
    severityText?: string;
    severityNumber?: number;
    body?: string;
    logAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const logAttrs = Object.entries(opts.logAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeLogs({
      resourceLogs: [
        {
          resource: { attributes: resourceAttrs },
          scopeLogs: [
            {
              scope: { name: opts.scopeName ?? "test-scope" },
              logRecords: [
                {
                  timeUnixNano: opts.timeNanos,
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  severityText: opts.severityText,
                  severityNumber: opts.severityNumber,
                  body: opts.body ? { stringValue: opts.body } : undefined,
                  attributes: logAttrs,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertGauge(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    value: number;
    serviceName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];
    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertSum(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    value: number;
    isMonotonic?: boolean;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
  }) => {
    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA")
      aggTemp = 1;
    else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    )
      aggTemp = 2;

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                      },
                    ],
                    isMonotonic: opts.isMonotonic,
                    aggregationTemporality: aggTemp,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertHistogram(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    count: number;
    sum: number;
    bucketCounts: number[];
    explicitBounds: number[];
  }) => {
    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  histogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        bucketCounts: opts.bucketCounts,
                        explicitBounds: opts.explicitBounds,
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertExpHistogram(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    count: number;
    sum: number;
    scale: number;
    zeroCount: number;
    positiveBucketCounts?: number[];
    positiveOffset?: number;
  }) => {
    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  exponentialHistogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        scale: opts.scale,
                        zeroCount: opts.zeroCount,
                        positive: {
                          offset: opts.positiveOffset ?? 0,
                          bucketCounts: opts.positiveBucketCounts,
                        },
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

function createInsertSummary(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    count: number;
    sum: number;
    quantiles: number[];
    quantileValues: number[];
  }) => {
    const quantileValues = opts.quantiles.map((q, i) => ({
      quantile: q,
      value: opts.quantileValues[i],
    }));

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: [] },
          scopeMetrics: [
            {
              scope: { name: "test-scope" },
              metrics: [
                {
                  name: opts.metricName,
                  summary: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano: opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        quantileValues,
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}
