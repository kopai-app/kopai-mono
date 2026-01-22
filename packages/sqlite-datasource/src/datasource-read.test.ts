/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteTelemetryDatasource } from "./datasource.js";
import { otlp, type datasource } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";

describe("NodeSqliteTelemetryDatasource", () => {
  describe("getTraces", () => {
    let testConnection: DatabaseSync;
    let ds: NodeSqliteTelemetryDatasource;
    let readDs: datasource.ReadTelemetryDatasource;

    function assertDefined<T>(
      value: T | undefined | null,
      msg = "Expected defined"
    ): asserts value is T {
      if (value === undefined || value === null) throw new Error(msg);
    }

    beforeEach(() => {
      testConnection = initializeDatabase(":memory:");
      ds = new NodeSqliteTelemetryDatasource(testConnection);
      readDs = ds;
    });

    afterEach(() => {
      testConnection.close();
    });

    // Helper to insert test spans
    async function insertSpan(opts: {
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
    }) {
      const resourceAttrs = [
        ...(opts.serviceName
          ? [
              {
                key: "service.name",
                value: { stringValue: opts.serviceName },
              },
            ]
          : []),
        ...Object.entries(opts.resourceAttributes ?? {}).map(
          ([key, value]) => ({
            key,
            value: { stringValue: value },
          })
        ),
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
                  },
                ],
              },
            ],
          },
        ],
      });
    }

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
        timestampMin: 1500000000000000, // 1500ms in nanos
        timestampMax: 2500000000000000, // 2500ms in nanos
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
        durationMin: 200_000_000, // 200ms in nanos
        durationMax: 600_000_000, // 600ms in nanos
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

    it("parses Events and Links fields as arrays", async () => {
      await ds.writeTraces({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: "test-service" } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "test-scope" },
                spans: [
                  {
                    traceId: "trace-with-events-links",
                    spanId: "span1",
                    name: "test-span",
                    startTimeUnixNano: "1000000000000000",
                    endTimeUnixNano: "1001000000000000",
                    events: [
                      {
                        name: "processing.start",
                        timeUnixNano: "1000000000000000",
                      },
                      {
                        name: "processing.checkpoint",
                        timeUnixNano: "1000500000000000",
                      },
                    ],
                    links: [
                      {
                        traceId: "linked-trace-id",
                        spanId: "linked-span-id",
                        traceState: "linked=state",
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
        traceId: "trace-with-events-links",
      });

      const row = result.data[0];
      assertDefined(row);

      // Events fields should be arrays, not JSON strings
      expect(row["Events.Name"]).toEqual([
        "processing.start",
        "processing.checkpoint",
      ]);
      expect(row["Events.Timestamp"]).toEqual([1000000000, 1000500000]);

      // Links fields should be arrays, not JSON strings
      expect(row["Links.TraceId"]).toEqual(["linked-trace-id"]);
      expect(row["Links.SpanId"]).toEqual(["linked-span-id"]);
      expect(row["Links.TraceState"]).toEqual(["linked=state"]);
    });

    it("throws SqliteDatasourceQueryError on DB error", async () => {
      // Create a separate connection to close for this test
      const badConnection = initializeDatabase(":memory:");
      const badDs = new NodeSqliteTelemetryDatasource(badConnection);
      badConnection.close();

      await expect(badDs.getTraces({})).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });
});
