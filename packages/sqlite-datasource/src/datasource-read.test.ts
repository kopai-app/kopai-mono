/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import {
  OptimizedDatasource,
  createOptimizedDatasource,
} from "./optimized-datasource.js";
import { otlp, denormalizedSignals, type datasource } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";

function assertDefined<T>(
  value: T | undefined | null,
  msg = "Expected defined"
): asserts value is T {
  if (value === undefined || value === null) throw new Error(msg);
}

describe("OptimizedDatasource", () => {
  describe("getTraces", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertSpan: ReturnType<typeof createInsertSpan>;

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertSpan = createInsertSpan(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("returns all spans with no filters, default limit 100, DESC order", async () => {
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

      const result = await readDs.getTraces({});

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // newest first
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1");
      expect(result.nextCursor).toBeNull();
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

      const result = await readDs.getTraces({ traceId: "target-trace" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("target-trace");
    });

    it("filters by serviceName", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        serviceName: "target-service",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        serviceName: "other-service",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const result = await readDs.getTraces({ serviceName: "target-service" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("target-service");
    });

    it("filters by spanName, spanKind, statusCode, scopeName", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        spanName: "GET /api",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        statusCode: otlp.StatusCode.STATUS_CODE_OK,
        scopeName: "http-scope",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        spanName: "POST /api",
        spanKind: otlp.SpanKind.SPAN_KIND_CLIENT,
        statusCode: otlp.StatusCode.STATUS_CODE_ERROR,
        scopeName: "grpc-scope",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });

      const resultBySpanName = await readDs.getTraces({ spanName: "GET /api" });
      expect(resultBySpanName.data).toHaveLength(1);
      const spanNameRow = resultBySpanName.data[0];
      assertDefined(spanNameRow);
      expect(spanNameRow.SpanName).toBe("GET /api");

      const resultBySpanKind = await readDs.getTraces({
        spanKind: "SPAN_KIND_SERVER",
      });
      expect(resultBySpanKind.data).toHaveLength(1);
      const spanKindRow = resultBySpanKind.data[0];
      assertDefined(spanKindRow);
      expect(spanKindRow.SpanKind).toBe("SPAN_KIND_SERVER");

      const resultByStatusCode = await readDs.getTraces({
        statusCode: "STATUS_CODE_OK",
      });
      expect(resultByStatusCode.data).toHaveLength(1);
      const statusCodeRow = resultByStatusCode.data[0];
      assertDefined(statusCodeRow);
      expect(statusCodeRow.StatusCode).toBe("STATUS_CODE_OK");

      const resultByScopeName = await readDs.getTraces({
        scopeName: "http-scope",
      });
      expect(resultByScopeName.data).toHaveLength(1);
      const scopeNameRow = resultByScopeName.data[0];
      assertDefined(scopeNameRow);
      expect(scopeNameRow.ScopeName).toBe("http-scope");
    });

    it("filters by timestampMin/Max (nanos to ms conversion)", async () => {
      // Span at 1000ms (1_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      // Span at 2000ms (2_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      // Span at 3000ms (3_000_000_000_000 nanos)
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      // Filter: >= 1500ms and <= 2500ms
      const result = await readDs.getTraces({
        timestampMin: "1500000000000000", // 1500ms in nanos
        timestampMax: "2500000000000000", // 2500ms in nanos
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span2");
    });

    it("filters by durationMin/Max (nanos to ms conversion)", async () => {
      // Span with duration 100ms = 100_000_000 nanos
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1000000100000000", // +100ms in nanos
      });
      // Span with duration 500ms = 500_000_000 nanos
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2000000500000000", // +500ms in nanos
      });
      // Span with duration 1000ms = 1_000_000_000 nanos
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3000001000000000", // +1000ms in nanos
      });

      // Filter: >= 200ms and <= 600ms (in nanos)
      const result = await readDs.getTraces({
        durationMin: "200000000", // 200ms in nanos
        durationMax: "600000000", // 600ms in nanos
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span2");
    });

    it("filters by spanAttributes using JSON extract", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { "http.method": "GET", "http.path": "/api" },
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        spanAttributes: { "http.method": "POST", "http.path": "/api" },
      });

      const result = await readDs.getTraces({
        spanAttributes: { "http.method": "GET" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("filters by resourceAttributes using JSON extract", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        resourceAttributes: { env: "prod", region: "us-east" },
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
        resourceAttributes: { env: "dev", region: "us-west" },
      });

      const result = await readDs.getTraces({
        resourceAttributes: { env: "prod" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `trace${i}`,
          spanId: `span${i}`,
          startTimeNanos: `${1000000000000000 + i * 1000000000000}`,
          endTimeNanos: `${1001000000000000 + i * 1000000000000}`,
        });
      }

      const result = await readDs.getTraces({ limit: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it("sorts ASC - oldest first", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });

      const result = await readDs.getTraces({ sortOrder: "ASC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // older
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1"); // newer
    });

    it("sorts DESC - newest first (default)", async () => {
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

      const result = await readDs.getTraces({ sortOrder: "DESC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.SpanId).toBe("span2"); // newer
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.SpanId).toBe("span1"); // older
    });

    it("pagination with cursor continues from timestamp", async () => {
      for (let i = 0; i < 5; i++) {
        await insertSpan({
          traceId: `trace${i}`,
          spanId: `span${i}`,
          startTimeNanos: `${(i + 1) * 1000000000000000}`,
          endTimeNanos: `${(i + 1) * 1000000000000000 + 1000000000000}`,
        });
      }

      // First page (DESC order)
      const page1 = await readDs.getTraces({ limit: 2, sortOrder: "DESC" });
      expect(page1.data).toHaveLength(2);
      const p1r0 = page1.data[0];
      assertDefined(p1r0);
      expect(p1r0.SpanId).toBe("span4"); // newest
      const p1r1 = page1.data[1];
      assertDefined(p1r1);
      expect(p1r1.SpanId).toBe("span3");
      expect(page1.nextCursor).not.toBeNull();

      // Second page
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getTraces({
        limit: 2,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      const p2r0 = page2.data[0];
      assertDefined(p2r0);
      expect(p2r0.SpanId).toBe("span2");
      const p2r1 = page2.data[1];
      assertDefined(p2r1);
      expect(p2r1.SpanId).toBe("span1");
    });

    it("pagination with same-timestamp spans uses SpanId tiebreaker", async () => {
      const sameTimestamp = "1000000000000000";
      // Insert 3 spans with same timestamp but different spanIds
      await insertSpan({
        traceId: "trace-a",
        spanId: "span-a",
        startTimeNanos: sameTimestamp,
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace-b",
        spanId: "span-b",
        startTimeNanos: sameTimestamp,
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace-c",
        spanId: "span-c",
        startTimeNanos: sameTimestamp,
        endTimeNanos: "1001000000000000",
      });

      const seen = new Set<string>();

      // Page 1
      const page1 = await readDs.getTraces({ limit: 1, sortOrder: "DESC" });
      expect(page1.data).toHaveLength(1);
      const p1row = page1.data[0];
      assertDefined(p1row);
      seen.add(p1row.SpanId);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getTraces({
        limit: 1,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(1);
      const p2row = page2.data[0];
      assertDefined(p2row);
      seen.add(p2row.SpanId);
      expect(page2.nextCursor).not.toBeNull();

      // Page 3
      assertDefined(page2.nextCursor);
      const page3 = await readDs.getTraces({
        limit: 1,
        sortOrder: "DESC",
        cursor: page2.nextCursor,
      });
      expect(page3.data).toHaveLength(1);
      const p3row = page3.data[0];
      assertDefined(p3row);
      seen.add(p3row.SpanId);
      expect(page3.nextCursor).toBeNull();

      // All 3 unique spans should be seen across pages
      expect(seen.size).toBe(3);
      expect(seen).toContain("span-a");
      expect(seen).toContain("span-b");
      expect(seen).toContain("span-c");
    });

    it("combines multiple filters with AND", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        serviceName: "target-service",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });
      await insertSpan({
        traceId: "trace2",
        spanId: "span2",
        serviceName: "target-service",
        spanKind: otlp.SpanKind.SPAN_KIND_CLIENT,
        startTimeNanos: "2000000000000000",
        endTimeNanos: "2001000000000000",
      });
      await insertSpan({
        traceId: "trace3",
        spanId: "span3",
        serviceName: "other-service",
        spanKind: otlp.SpanKind.SPAN_KIND_SERVER,
        startTimeNanos: "3000000000000000",
        endTimeNanos: "3001000000000000",
      });

      const result = await readDs.getTraces({
        serviceName: "target-service",
        spanKind: "SPAN_KIND_SERVER",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("span1");
    });

    it("returns empty result with null cursor when no matches", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
      });

      const result = await readDs.getTraces({ traceId: "nonexistent" });

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("parses JSON fields in returned rows", async () => {
      await insertSpan({
        traceId: "trace1",
        spanId: "span1",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        spanAttributes: { key1: "value1" },
        resourceAttributes: { env: "prod" },
      });

      const result = await readDs.getTraces({});

      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanAttributes).toEqual({ key1: "value1" });
      expect(row.ResourceAttributes).toEqual({
        env: "prod",
        "service.name": undefined,
      });
    });

    it("returns array attribute values in ResourceAttributes", async () => {
      // OTel attributes can be arrays (e.g. process.command_args)
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "process.command_args",
                  value: {
                    arrayValue: {
                      values: [
                        { stringValue: "node" },
                        { stringValue: "server.js" },
                        { stringValue: "--port=3000" },
                      ],
                    },
                  },
                },
                {
                  key: "service.name",
                  value: { stringValue: "test-service" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-scope" },
                spans: [
                  {
                    traceId: "trace-with-array-attr",
                    spanId: "span1",
                    name: "test-span",
                    startTimeUnixNano: "1000000000000000",
                    endTimeUnixNano: "1001000000000000",
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await readDs.getTraces({
        traceId: "trace-with-array-attr",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ResourceAttributes).toEqual({
        "process.command_args": ["node", "server.js", "--port=3000"],
        "service.name": "test-service",
      });

      // Validate schema accepts array attribute values (this is what fastify validates)
      const parseResult = denormalizedSignals.otelTracesSchema.safeParse(row);
      expect(parseResult.success).toBe(true);
    });

    it("returns nested object/array attribute values (recursive AnyValue)", async () => {
      // OTel attributes can contain nested objects and arrays of objects (e.g. errorCauses)
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "test-service" },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-scope" },
                spans: [
                  {
                    traceId: "trace-with-nested-attr",
                    spanId: "span1",
                    name: "test-span",
                    startTimeUnixNano: "1000000000000000",
                    endTimeUnixNano: "1001000000000000",
                    attributes: [
                      {
                        key: "errorCauses",
                        value: {
                          arrayValue: {
                            values: [
                              {
                                kvlistValue: {
                                  values: [
                                    {
                                      key: "message",
                                      value: {
                                        stringValue: "Connection refused",
                                      },
                                    },
                                    { key: "code", value: { intValue: "500" } },
                                  ],
                                },
                              },
                              {
                                kvlistValue: {
                                  values: [
                                    {
                                      key: "message",
                                      value: { stringValue: "Timeout" },
                                    },
                                    { key: "code", value: { intValue: "504" } },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      },
                      {
                        key: "nested.config",
                        value: {
                          kvlistValue: {
                            values: [
                              { key: "retries", value: { intValue: "3" } },
                              {
                                key: "hosts",
                                value: {
                                  arrayValue: {
                                    values: [
                                      { stringValue: "host1" },
                                      { stringValue: "host2" },
                                    ],
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await readDs.getTraces({
        traceId: "trace-with-nested-attr",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);

      // Verify nested structures are preserved
      // Note: intValue is stored as string per OTLP spec (supports int64)
      expect(row.SpanAttributes).toEqual({
        errorCauses: [
          { message: "Connection refused", code: "500" },
          { message: "Timeout", code: "504" },
        ],
        "nested.config": {
          retries: "3",
          hosts: ["host1", "host2"],
        },
      });

      // Validate schema accepts nested object/array attribute values
      const parseResult = denormalizedSignals.otelTracesSchema.safeParse(row);
      expect(parseResult.success).toBe(true);
    });

    it("parses Events and Links fields as arrays", async () => {
      await insertSpan({
        traceId: "trace-with-events-links",
        spanId: "span1",
        serviceName: "test-service",
        startTimeNanos: "1000000000000000",
        endTimeNanos: "1001000000000000",
        events: [
          { name: "processing.start", timeUnixNano: "1000000000000000" },
          { name: "processing.checkpoint", timeUnixNano: "1000500000000000" },
        ],
        links: [
          {
            traceId: "linked-trace-id",
            spanId: "linked-span-id",
            traceState: "linked=state",
          },
        ],
      });

      const result = await readDs.getTraces({
        traceId: "trace-with-events-links",
      });

      const row = result.data[0];
      assertDefined(row);

      // Events fields should be arrays, not JSON strings
      expect(row["Events.Name"]).toEqual([
        "processing.start",
        "processing.checkpoint",
      ]);
      expect(row["Events.Timestamp"]).toEqual([
        "1000000000000000",
        "1000500000000000",
      ]);

      // Links fields should be arrays, not JSON strings
      expect(row["Links.TraceId"]).toEqual(["linked-trace-id"]);
      expect(row["Links.SpanId"]).toEqual(["linked-span-id"]);
      expect(row["Links.TraceState"]).toEqual(["linked=state"]);
    });

    it("throws SqliteDatasourceQueryError on DB error", async () => {
      // Create a separate connection to close for this test
      const badConnection = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConnection);
      badConnection.close();

      await expect(badDs.getTraces({})).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });

  describe("getLogs", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertLog: ReturnType<typeof createInsertLog>;

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      readDs = ds;
      insertLog = createInsertLog(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("returns all logs with no filters, default limit 100, DESC order", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      await insertLog({ timeNanos: "2000000000000000" });

      const result = await readDs.getLogs({});

      expect(result.data).toHaveLength(2);
      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.Timestamp).toBe("2000000000000000"); // newer first (DESC)
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.Timestamp).toBe("1000000000000000");
      expect(result.nextCursor).toBeNull();
    });

    it("filters by traceId", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        traceId: "target-trace",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        traceId: "other-trace",
      });

      const result = await readDs.getLogs({ traceId: "target-trace" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TraceId).toBe("target-trace");
    });

    it("filters by spanId", async () => {
      await insertLog({ timeNanos: "1000000000000000", spanId: "target-span" });
      await insertLog({ timeNanos: "2000000000000000", spanId: "other-span" });

      const result = await readDs.getLogs({ spanId: "target-span" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SpanId).toBe("target-span");
    });

    it("filters by serviceName", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        serviceName: "target-service",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        serviceName: "other-service",
      });

      const result = await readDs.getLogs({ serviceName: "target-service" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("target-service");
    });

    it("filters by scopeName", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        scopeName: "http-scope",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        scopeName: "grpc-scope",
      });

      const result = await readDs.getLogs({ scopeName: "http-scope" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ScopeName).toBe("http-scope");
    });

    it("filters by severityText", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityText: "ERROR" });
      await insertLog({ timeNanos: "2000000000000000", severityText: "INFO" });

      const result = await readDs.getLogs({ severityText: "ERROR" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SeverityText).toBe("ERROR");
    });

    it("filters by severityNumberMin/Max", async () => {
      await insertLog({ timeNanos: "1000000000000000", severityNumber: 5 });
      await insertLog({ timeNanos: "2000000000000000", severityNumber: 10 });
      await insertLog({ timeNanos: "3000000000000000", severityNumber: 15 });

      const result = await readDs.getLogs({
        severityNumberMin: 8,
        severityNumberMax: 12,
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.SeverityNumber).toBe(10);
    });

    it("filters by bodyContains (substring search)", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        body: "User logged in successfully",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        body: "Database connection failed",
      });

      const result = await readDs.getLogs({ bodyContains: "logged in" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toContain("logged in");
    });

    it("filters by timestampMin/Max (nanos to ms conversion)", async () => {
      await insertLog({ timeNanos: "1000000000000000" }); // 1000ms
      await insertLog({ timeNanos: "2000000000000000" }); // 2000ms
      await insertLog({ timeNanos: "3000000000000000" }); // 3000ms

      const result = await readDs.getLogs({
        timestampMin: "1500000000000000",
        timestampMax: "2500000000000000",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Timestamp).toBe("2000000000000000");
    });

    it("filters by logAttributes using JSON extract", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        logAttributes: { "request.id": "abc123" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        logAttributes: { "request.id": "xyz789" },
      });

      const result = await readDs.getLogs({
        logAttributes: { "request.id": "abc123" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.LogAttributes).toEqual({ "request.id": "abc123" });
    });

    it("filters by resourceAttributes using JSON extract", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        resourceAttributes: { env: "prod" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        resourceAttributes: { env: "dev" },
      });

      const result = await readDs.getLogs({
        resourceAttributes: { env: "prod" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
    });

    it("filters by scopeAttributes using JSON extract", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        scopeAttributes: { "library.version": "1.0.0" },
      });
      await insertLog({
        timeNanos: "2000000000000000",
        scopeAttributes: { "library.version": "2.0.0" },
      });

      const result = await readDs.getLogs({
        scopeAttributes: { "library.version": "1.0.0" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ScopeAttributes).toEqual({ "library.version": "1.0.0" });
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertLog({
          timeNanos: `${(i + 1) * 1000000000000000}`,
        });
      }

      const result = await readDs.getLogs({ limit: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it("sorts ASC - oldest first", async () => {
      await insertLog({ timeNanos: "2000000000000000" });
      await insertLog({ timeNanos: "1000000000000000" });

      const result = await readDs.getLogs({ sortOrder: "ASC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.Timestamp).toBe("1000000000000000"); // older
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.Timestamp).toBe("2000000000000000"); // newer
    });

    it("sorts DESC - newest first (default)", async () => {
      await insertLog({ timeNanos: "1000000000000000" });
      await insertLog({ timeNanos: "2000000000000000" });

      const result = await readDs.getLogs({ sortOrder: "DESC" });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.Timestamp).toBe("2000000000000000"); // newer
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.Timestamp).toBe("1000000000000000"); // older
    });

    it("pagination with cursor continues from timestamp", async () => {
      for (let i = 0; i < 5; i++) {
        await insertLog({ timeNanos: `${(i + 1) * 1000000000000000}` });
      }

      // First page (DESC order)
      const page1 = await readDs.getLogs({ limit: 2, sortOrder: "DESC" });
      expect(page1.data).toHaveLength(2);
      const p1r0 = page1.data[0];
      assertDefined(p1r0);
      expect(p1r0.Timestamp).toBe("5000000000000000"); // newest
      expect(page1.nextCursor).not.toBeNull();

      // Second page
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getLogs({
        limit: 2,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      const p2r0 = page2.data[0];
      assertDefined(p2r0);
      expect(p2r0.Timestamp).toBe("3000000000000000");
    });

    it("pagination with same-timestamp logs uses rowid tiebreaker", async () => {
      const sameTimestamp = "1000000000000000";
      await insertLog({ timeNanos: sameTimestamp, body: "log-a" });
      await insertLog({ timeNanos: sameTimestamp, body: "log-b" });
      await insertLog({ timeNanos: sameTimestamp, body: "log-c" });

      const seen = new Set<string>();

      // Page 1
      const page1 = await readDs.getLogs({ limit: 1, sortOrder: "DESC" });
      expect(page1.data).toHaveLength(1);
      const p1row = page1.data[0];
      assertDefined(p1row);
      assertDefined(p1row.Body);
      seen.add(p1row.Body);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getLogs({
        limit: 1,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(1);
      const p2row = page2.data[0];
      assertDefined(p2row);
      assertDefined(p2row.Body);
      seen.add(p2row.Body);
      expect(page2.nextCursor).not.toBeNull();

      // Page 3
      assertDefined(page2.nextCursor);
      const page3 = await readDs.getLogs({
        limit: 1,
        sortOrder: "DESC",
        cursor: page2.nextCursor,
      });
      expect(page3.data).toHaveLength(1);
      const p3row = page3.data[0];
      assertDefined(p3row);
      assertDefined(p3row.Body);
      seen.add(p3row.Body);
      expect(page3.nextCursor).toBeNull();

      // All 3 unique logs should be seen across pages
      expect(seen.size).toBe(3);
    });

    it("combines multiple filters with AND", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        serviceName: "target-service",
        severityText: "ERROR",
      });
      await insertLog({
        timeNanos: "2000000000000000",
        serviceName: "target-service",
        severityText: "INFO",
      });
      await insertLog({
        timeNanos: "3000000000000000",
        serviceName: "other-service",
        severityText: "ERROR",
      });

      const result = await readDs.getLogs({
        serviceName: "target-service",
        severityText: "ERROR",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("target-service");
      expect(row.SeverityText).toBe("ERROR");
    });

    it("returns empty result with null cursor when no matches", async () => {
      await insertLog({ timeNanos: "1000000000000000" });

      const result = await readDs.getLogs({ traceId: "nonexistent" });

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("parses JSON fields in returned rows", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        body: "test message",
        logAttributes: { key1: "value1" },
        resourceAttributes: { env: "prod" },
        scopeAttributes: { "lib.name": "test" },
      });

      const result = await readDs.getLogs({});

      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toBe("test message");
      expect(row.LogAttributes).toEqual({ key1: "value1" });
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
      expect(row.ScopeAttributes).toEqual({ "lib.name": "test" });
    });

    it("returns string Body without extra quotes", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        body: "Hello world",
      });

      const result = await readDs.getLogs({});

      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toBe("Hello world");
    });

    it("returns complex Body as JSON string", async () => {
      await insertLog({
        timeNanos: "1000000000000000",
        bodyValue: {
          kvlistValue: {
            values: [
              { key: "user", value: { stringValue: "alice" } },
              { key: "action", value: { stringValue: "login" } },
            ],
          },
        },
      });

      const result = await readDs.getLogs({});

      const row = result.data[0];
      assertDefined(row);
      expect(row.Body).toBe('{"user":"alice","action":"login"}');
    });

    it("throws SqliteDatasourceQueryError on DB error", async () => {
      const badConnection = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConnection);
      badConnection.close();

      await expect(badDs.getLogs({})).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });

  describe("getMetrics", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let readDs: datasource.ReadTelemetryDatasource;
    let insertGauge: ReturnType<typeof createInsertGauge>;
    let insertSum: ReturnType<typeof createInsertSum>;
    let insertHistogram: ReturnType<typeof createInsertHistogram>;
    let insertExpHistogram: ReturnType<typeof createInsertExpHistogram>;
    let insertSummary: ReturnType<typeof createInsertSummary>;

    beforeEach(async () => {
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

    it("returns gauge metrics with metricType filter", async () => {
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

      const result = await readDs.getMetrics({ metricType: "Gauge" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Gauge");
      expect(row.MetricName).toBe("cpu.usage");
      if (row.MetricType === "Gauge") {
        expect(row.Value).toBe(0.75);
      }
    });

    it("returns sum metrics with metricType filter", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertSum({
        metricName: "request.count",
        timeUnixNano: "2000000000000000",
        value: 100,
        isMonotonic: true,
        aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      });

      const result = await readDs.getMetrics({ metricType: "Sum" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Sum");
      expect(row.MetricName).toBe("request.count");
      if (row.MetricType === "Sum") {
        expect(row.Value).toBe(100);
        expect(row.IsMonotonic).toBe(1);
        expect(row.AggregationTemporality).toBe(
          "AGGREGATION_TEMPORALITY_CUMULATIVE"
        );
      }
    });

    it("returns histogram metrics with metricType filter", async () => {
      await insertHistogram({
        metricName: "http.latency",
        timeUnixNano: "1000000000000000",
        count: 10,
        sum: 500,
        bucketCounts: [1, 2, 3, 4],
        explicitBounds: [10, 50, 100],
      });

      const result = await readDs.getMetrics({ metricType: "Histogram" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Histogram");
      if (row.MetricType === "Histogram") {
        expect(row.Count).toBe(10);
        expect(row.Sum).toBe(500);
        expect(row.BucketCounts).toEqual([1, 2, 3, 4]);
        expect(row.ExplicitBounds).toEqual([10, 50, 100]);
      }
    });

    it("returns exponential histogram metrics with metricType filter", async () => {
      await insertExpHistogram({
        metricName: "request.duration",
        timeUnixNano: "1000000000000000",
        count: 100,
        sum: 5000,
        scale: 3,
        zeroCount: 5,
        positiveBucketCounts: [10, 20, 30],
        positiveOffset: 1,
      });

      const result = await readDs.getMetrics({
        metricType: "ExponentialHistogram",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("ExponentialHistogram");
      if (row.MetricType === "ExponentialHistogram") {
        expect(row.Scale).toBe(3);
        expect(row.ZeroCount).toBe(5);
        expect(row.PositiveBucketCounts).toEqual([10, 20, 30]);
      }
    });

    it("returns summary metrics with metricType filter", async () => {
      await insertSummary({
        metricName: "request.latency",
        timeUnixNano: "1000000000000000",
        count: 50,
        sum: 2500,
        quantiles: [0.5, 0.9, 0.99],
        quantileValues: [25, 80, 120],
      });

      const result = await readDs.getMetrics({ metricType: "Summary" });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricType).toBe("Summary");
      if (row.MetricType === "Summary") {
        expect(row.Count).toBe(50);
        expect(row["ValueAtQuantiles.Quantile"]).toEqual([0.5, 0.9, 0.99]);
        expect(row["ValueAtQuantiles.Value"]).toEqual([25, 80, 120]);
      }
    });

    it("filters by metricName", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertGauge({
        metricName: "memory.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        metricName: "cpu.usage",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricName).toBe("cpu.usage");
    });

    it("filters by serviceName", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        serviceName: "service-a",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertGauge({
        metricName: "cpu.usage",
        serviceName: "service-b",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        serviceName: "service-a",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ServiceName).toBe("service-a");
    });

    it("filters by scopeName", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        scopeName: "scope-a",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertGauge({
        metricName: "cpu.usage",
        scopeName: "scope-b",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        scopeName: "scope-a",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ScopeName).toBe("scope-a");
    });

    it("filters by timeUnixMin/Max (nanos to ms conversion)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000", // stored as 1000000000 ms
        value: 0.1,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000", // stored as 2000000000 ms
        value: 0.2,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "3000000000000000", // stored as 3000000000 ms
        value: 0.3,
      });

      // Filter: >= 1500ms and <= 2500ms (in nanos)
      const result = await readDs.getMetrics({
        metricType: "Gauge",
        timeUnixMin: "1500000000000000", // 1500000000 ms
        timeUnixMax: "2500000000000000", // 2500000000 ms
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.TimeUnix).toBe("2000000000000000");
    });

    it("filters by attributes using JSON extract", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1", region: "us-east" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
        attributes: { host: "host-2", region: "us-west" },
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        attributes: { host: "host-1" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.Attributes).toEqual({ host: "host-1", region: "us-east" });
    });

    it("filters by resourceAttributes using JSON extract", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        resourceAttributes: { env: "prod" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
        resourceAttributes: { env: "dev" },
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        resourceAttributes: { env: "prod" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
    });

    it("filters by scopeAttributes using JSON extract", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        scopeAttributes: { "lib.version": "1.0" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.5,
        scopeAttributes: { "lib.version": "2.0" },
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        scopeAttributes: { "lib.version": "1.0" },
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.ScopeAttributes).toEqual({ "lib.version": "1.0" });
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await insertGauge({
          metricName: "cpu.usage",
          timeUnixNano: `${(i + 1) * 1000000000000000}`,
          value: i * 0.1,
        });
      }

      const result = await readDs.getMetrics({ metricType: "Gauge", limit: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it("sorts DESC - newest first (default)", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.1,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.2,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        sortOrder: "DESC",
      });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.TimeUnix).toBe("2000000000000000"); // newer
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.TimeUnix).toBe("1000000000000000"); // older
    });

    it("sorts ASC - oldest first", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.2,
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.1,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        sortOrder: "ASC",
      });

      const row0 = result.data[0];
      assertDefined(row0);
      expect(row0.TimeUnix).toBe("1000000000000000"); // older
      const row1 = result.data[1];
      assertDefined(row1);
      expect(row1.TimeUnix).toBe("2000000000000000"); // newer
    });

    it("pagination with cursor continues from timestamp", async () => {
      for (let i = 0; i < 5; i++) {
        await insertGauge({
          metricName: "cpu.usage",
          timeUnixNano: `${(i + 1) * 1000000000000000}`,
          value: i * 0.1,
        });
      }

      // First page (DESC order)
      const page1 = await readDs.getMetrics({
        metricType: "Gauge",
        limit: 2,
        sortOrder: "DESC",
      });
      expect(page1.data).toHaveLength(2);
      const p1r0 = page1.data[0];
      assertDefined(p1r0);
      expect(p1r0.TimeUnix).toBe("5000000000000000"); // newest
      expect(page1.nextCursor).not.toBeNull();

      // Second page
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getMetrics({
        metricType: "Gauge",
        limit: 2,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(2);
      const p2r0 = page2.data[0];
      assertDefined(p2r0);
      expect(p2r0.TimeUnix).toBe("3000000000000000");
    });

    it("pagination with same-timestamp metrics uses rowid tiebreaker", async () => {
      const sameTimestamp = "1000000000000000";
      await insertGauge({
        metricName: "metric-a",
        timeUnixNano: sameTimestamp,
        value: 0.1,
      });
      await insertGauge({
        metricName: "metric-b",
        timeUnixNano: sameTimestamp,
        value: 0.2,
      });
      await insertGauge({
        metricName: "metric-c",
        timeUnixNano: sameTimestamp,
        value: 0.3,
      });

      const seen = new Set<string>();

      // Page 1
      const page1 = await readDs.getMetrics({
        metricType: "Gauge",
        limit: 1,
        sortOrder: "DESC",
      });
      expect(page1.data).toHaveLength(1);
      const p1row = page1.data[0];
      assertDefined(p1row);
      assertDefined(p1row.MetricName);
      seen.add(p1row.MetricName);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2
      assertDefined(page1.nextCursor);
      const page2 = await readDs.getMetrics({
        metricType: "Gauge",
        limit: 1,
        sortOrder: "DESC",
        cursor: page1.nextCursor,
      });
      expect(page2.data).toHaveLength(1);
      const p2row = page2.data[0];
      assertDefined(p2row);
      assertDefined(p2row.MetricName);
      seen.add(p2row.MetricName);
      expect(page2.nextCursor).not.toBeNull();

      // Page 3
      assertDefined(page2.nextCursor);
      const page3 = await readDs.getMetrics({
        metricType: "Gauge",
        limit: 1,
        sortOrder: "DESC",
        cursor: page2.nextCursor,
      });
      expect(page3.data).toHaveLength(1);
      const p3row = page3.data[0];
      assertDefined(p3row);
      assertDefined(p3row.MetricName);
      seen.add(p3row.MetricName);
      expect(page3.nextCursor).toBeNull();

      // All 3 unique metrics should be seen
      expect(seen.size).toBe(3);
    });

    it("combines multiple filters with AND", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        serviceName: "service-a",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });
      await insertGauge({
        metricName: "cpu.usage",
        serviceName: "service-b",
        timeUnixNano: "2000000000000000",
        value: 0.5,
      });
      await insertGauge({
        metricName: "memory.usage",
        serviceName: "service-a",
        timeUnixNano: "3000000000000000",
        value: 0.6,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        metricName: "cpu.usage",
        serviceName: "service-a",
      });

      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      assertDefined(row);
      expect(row.MetricName).toBe("cpu.usage");
      expect(row.ServiceName).toBe("service-a");
    });

    it("returns empty result with null cursor when no matches", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });

      const result = await readDs.getMetrics({
        metricType: "Gauge",
        metricName: "nonexistent",
      });

      expect(result.data).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it("parses JSON fields in returned rows", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1" },
        resourceAttributes: { env: "prod" },
        scopeAttributes: { "lib.name": "test" },
      });

      const result = await readDs.getMetrics({ metricType: "Gauge" });

      const row = result.data[0];
      assertDefined(row);
      expect(row.Attributes).toEqual({ host: "host-1" });
      expect(row.ResourceAttributes).toMatchObject({ env: "prod" });
      expect(row.ScopeAttributes).toEqual({ "lib.name": "test" });
    });

    it("parses Exemplars fields as arrays", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        exemplars: [
          {
            timeUnixNano: "1000000000000000",
            value: 0.8,
            spanId: "span123",
            traceId: "trace456",
          },
        ],
      });

      const result = await readDs.getMetrics({ metricType: "Gauge" });

      const row = result.data[0];
      assertDefined(row);
      expect(row["Exemplars.TimeUnix"]).toEqual(["1000000000000000"]);
      expect(row["Exemplars.Value"]).toEqual([0.8]);
      expect(row["Exemplars.SpanId"]).toEqual(["span123"]);
    });

    it("throws SqliteDatasourceQueryError on DB error", async () => {
      const badConnection = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConnection);
      badConnection.close();

      await expect(badDs.getMetrics({ metricType: "Gauge" })).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });

  describe("discoverMetrics", () => {
    let testConnection: DatabaseSync;
    let ds: OptimizedDatasource;
    let insertGauge: ReturnType<typeof createInsertGauge>;
    let insertSum: ReturnType<typeof createInsertSum>;
    let insertHistogram: ReturnType<typeof createInsertHistogram>;

    beforeEach(async () => {
      testConnection = initializeDatabase(":memory:");
      ds = createOptimizedDatasource(testConnection);
      insertGauge = createInsertGauge(ds);
      insertSum = createInsertSum(ds);
      insertHistogram = createInsertHistogram(ds);
    });

    afterEach(() => {
      testConnection.close();
    });

    it("returns empty array when no metrics", async () => {
      const result = await ds.discoverMetrics();

      expect(result.metrics).toEqual([]);
    });

    it("returns single metric with attributes", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1", region: "us-east" },
        resourceAttributes: { env: "prod" },
      });

      const result = await ds.discoverMetrics();

      expect(result.metrics).toHaveLength(1);
      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: { values: { host: ["host-1"], region: ["us-east"] } },
        resourceAttributes: { values: { env: ["prod"] } },
      });
    });

    it("returns multiple metrics with different types", async () => {
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
      await insertHistogram({
        metricName: "latency",
        timeUnixNano: "3000000000000000",
        count: 10,
        sum: 500,
        bucketCounts: [1, 2, 3],
        explicitBounds: [10, 50],
      });

      const result = await ds.discoverMetrics();

      expect(result.metrics).toHaveLength(3);
      const types = result.metrics.map((m) => m.type).sort();
      expect(types).toEqual(["Gauge", "Histogram", "Sum"]);
    });

    it("aggregates unique attribute values across data points", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.8,
        attributes: { host: "host-2" },
      });
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "3000000000000000",
        value: 0.85,
        attributes: { host: "host-1" }, // duplicate
      });

      const result = await ds.discoverMetrics();

      expect(result.metrics).toHaveLength(1);
      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: {
          values: { host: expect.arrayContaining(["host-1", "host-2"]) },
        },
        resourceAttributes: { values: {} },
      });
    });

    it("separates attributes vs resourceAttributes correctly", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1" },
        resourceAttributes: { env: "prod" },
      });

      const result = await ds.discoverMetrics();

      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: { values: { host: ["host-1"] } },
        resourceAttributes: { values: { env: ["prod"] } },
      });
    });

    it("truncates at 100 values and sets _truncated flag", async () => {
      // Insert 105 data points with unique host values
      for (let i = 0; i < 105; i++) {
        await insertGauge({
          metricName: "cpu.usage",
          timeUnixNano: `${1000000000000000 + i}`,
          value: 0.5,
          attributes: { host: `host-${i}` },
        });
      }

      const result = await ds.discoverMetrics();

      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: { values: { host: expect.any(Array) }, _truncated: true },
        resourceAttributes: { values: {} },
      });
      expect(metric.attributes.values.host).toHaveLength(100);
    });

    it("handles metrics with no attributes", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
      });

      const result = await ds.discoverMetrics();

      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: { values: {} },
        resourceAttributes: { values: {} },
      });
    });

    it("handles metrics with no resourceAttributes", async () => {
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1" },
      });

      const result = await ds.discoverMetrics();

      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        attributes: { values: { host: ["host-1"] } },
        resourceAttributes: { values: {} },
      });
    });

    it("includes unit and description when present", async () => {
      // Need to insert directly since helper doesn't support unit/description
      await ds.writeMetrics({
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                scope: { name: "test" },
                metrics: [
                  {
                    name: "cpu.usage",
                    unit: "percent",
                    description: "CPU usage percentage",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1000000000000000",
                          asDouble: 0.75,
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

      const result = await ds.discoverMetrics();

      const metric = result.metrics[0];
      assertDefined(metric);
      expect(metric).toEqual({
        name: "cpu.usage",
        type: "Gauge",
        unit: "percent",
        description: "CPU usage percentage",
        attributes: { values: {} },
        resourceAttributes: { values: {} },
      });
    });

    it("populates discovery state during writes (in-memory)", async () => {
      // First write
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "1000000000000000",
        value: 0.75,
        attributes: { host: "host-1" },
      });

      const result1 = await ds.discoverMetrics();
      expect(result1.metrics).toHaveLength(1);
      expect(result1.metrics[0]?.attributes.values.host).toEqual(["host-1"]);

      // Second write adds new attribute value - should be reflected immediately
      await insertGauge({
        metricName: "cpu.usage",
        timeUnixNano: "2000000000000000",
        value: 0.8,
        attributes: { host: "host-2" },
      });

      const result2 = await ds.discoverMetrics();
      expect(result2.metrics).toHaveLength(1);
      expect(result2.metrics[0]?.attributes.values.host).toEqual(
        expect.arrayContaining(["host-1", "host-2"])
      );
    });

    it("OptimizedDatasource.discoverMetrics returns in-memory state (no DB error on closed connection)", async () => {
      // OptimizedDatasource.discoverMetrics() returns from in-memory state, not from DB
      const badConnection = initializeDatabase(":memory:");
      const badDs = createOptimizedDatasource(badConnection);
      badConnection.close();

      // Should NOT throw - returns from in-memory state
      const result = await badDs.discoverMetrics();
      expect(result.metrics).toEqual([]);
    });

    it("extractAnyValue should handle nested arrayValue attributes", async () => {
      // This test reproduces a bug where extractAnyValue doesn't recursively
      // handle nested OTel AnyValue types (arrayValue, kvlistValue).
      // Instead of extracting ["a", "b"], it returns the raw OTel structure.
      await ds.writeMetrics({
        resourceMetrics: [
          {
            resource: { attributes: [] },
            scopeMetrics: [
              {
                scope: { name: "test" },
                metrics: [
                  {
                    name: "metric.with.array.attr",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1000000000000000",
                          asDouble: 1.0,
                          attributes: [
                            {
                              key: "tags",
                              value: {
                                arrayValue: {
                                  values: [
                                    { stringValue: "tag-a" },
                                    { stringValue: "tag-b" },
                                  ],
                                },
                              },
                            },
                          ],
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

      const result = await ds.discoverMetrics();
      const metric = result.metrics[0];
      assertDefined(metric);

      // EXPECTED: The attribute value should be the string representation of ["tag-a", "tag-b"]
      // BUG: It returns the raw OTel structure as a string like '[object Object]' or
      //      the JSON of {arrayValue: {values: [...]}}
      const tagsValue = metric.attributes.values.tags?.[0];
      expect(tagsValue).not.toContain("arrayValue");
      expect(tagsValue).not.toBe("[object Object]");
    });
  });
});

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
    spanAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    events?: { name: string; timeUnixNano: string }[];
    links?: { traceId: string; spanId: string; traceState?: string }[];
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [
            {
              key: "service.name",
              value: { stringValue: opts.serviceName },
            },
          ]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const spanAttrs = Object.entries(opts.spanAttributes ?? {}).map(
      ([key, value]) => ({
        key,
        value: { stringValue: value },
      })
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
                  name: opts.spanName ?? "test-span",
                  kind: opts.spanKind,
                  startTimeUnixNano: opts.startTimeNanos,
                  endTimeUnixNano: opts.endTimeNanos,
                  status: opts.statusCode
                    ? { code: opts.statusCode }
                    : undefined,
                  attributes: spanAttrs,
                  events: opts.events,
                  links: opts.links,
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
    startTimeUnixNano?: string;
    value: number;
    serviceName?: string;
    scopeName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
    exemplars?: Array<{
      timeUnixNano: string;
      value: number;
      spanId?: string;
      traceId?: string;
    }>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const exemplars = opts.exemplars?.map((e) => ({
      timeUnixNano: e.timeUnixNano,
      asDouble: e.value,
      spanId: e.spanId,
      traceId: e.traceId,
    }));

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                        exemplars,
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
    startTimeUnixNano?: string;
    value: number;
    serviceName?: string;
    scopeName?: string;
    isMonotonic?: boolean;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    // Map aggregation temporality string to enum value
    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
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
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    bucketCounts: number[];
    explicitBounds: number[];
    serviceName?: string;
    scopeName?: string;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  histogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        bucketCounts: opts.bucketCounts,
                        explicitBounds: opts.explicitBounds,
                        attributes: metricAttrs,
                      },
                    ],
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

function createInsertExpHistogram(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    scale: number;
    zeroCount: number;
    positiveBucketCounts?: number[];
    positiveOffset?: number;
    negativeBucketCounts?: number[];
    negativeOffset?: number;
    serviceName?: string;
    scopeName?: string;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  exponentialHistogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        scale: opts.scale,
                        zeroCount: opts.zeroCount,
                        positive: {
                          offset: opts.positiveOffset ?? 0,
                          bucketCounts: opts.positiveBucketCounts,
                        },
                        negative: {
                          offset: opts.negativeOffset ?? 0,
                          bucketCounts: opts.negativeBucketCounts,
                        },
                        attributes: metricAttrs,
                      },
                    ],
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

function createInsertSummary(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    quantiles: number[];
    quantileValues: number[];
    serviceName?: string;
    scopeName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const quantileValues = opts.quantiles.map((q, i) => ({
      quantile: q,
      value: opts.quantileValues[i],
    }));

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  summary: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        quantileValues,
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
    bodyValue?: otlp.AnyValue;
    logAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
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

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeLogs({
      resourceLogs: [
        {
          resource: { attributes: resourceAttrs },
          scopeLogs: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              logRecords: [
                {
                  timeUnixNano: opts.timeNanos,
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  severityText: opts.severityText,
                  severityNumber: opts.severityNumber,
                  body:
                    opts.bodyValue ??
                    (opts.body ? { stringValue: opts.body } : undefined),
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
