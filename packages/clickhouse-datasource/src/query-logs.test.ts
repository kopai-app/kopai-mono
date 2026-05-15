import { describe, it, expect } from "vitest";
import { buildAggregatedLogsQuery } from "./query-logs.js";

describe("buildAggregatedLogsQuery", () => {
  it("generates COUNT aggregation with single groupBy and logAttr filter", () => {
    const { query, params } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
      logAttributes: { "event.name": "tool_decision" },
    });

    expect(query).toContain("COUNT(*) AS value");
    expect(query).toContain("FROM otel_logs");
    expect(query).toContain("LogAttributes[{groupByKey0:String}] AS group_0");
    expect(query).toContain("GROUP BY group_0");
    expect(query).toContain("ORDER BY value DESC");
    expect(query).not.toContain("_rowHash");
    expect(query).not.toContain("cursor");

    expect(params).toMatchObject({
      serviceName: "claude-code",
      groupByKey0: "tool_name",
      logAttrKey0: "event.name",
      logAttrVal0: "tool_decision",
    });
  });

  it("generates aggregation with multi-key groupBy", () => {
    const { query, params } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name", "decision"],
      logAttributes: { "event.name": "tool_decision" },
    });

    expect(query).toContain("LogAttributes[{groupByKey0:String}] AS group_0");
    expect(query).toContain("LogAttributes[{groupByKey1:String}] AS group_1");
    expect(query).toContain("GROUP BY group_0, group_1");
    expect(params.groupByKey0).toBe("tool_name");
    expect(params.groupByKey1).toBe("decision");
  });

  it("applies time range filter", () => {
    const { query, params } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
      timestampMin: "1700000000000000000",
      timestampMax: "1700100000000000000",
    });

    expect(query).toContain("Timestamp >= {tsMin:DateTime64(9)}");
    expect(query).toContain("Timestamp <= {tsMax:DateTime64(9)}");
    expect(params.tsMin).toBeDefined();
    expect(params.tsMax).toBeDefined();
  });

  it("includes LIMIT 1000 server cap", () => {
    const { query } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
    });

    expect(query).toContain("LIMIT 1000");
  });

  it("matches expected SQL snapshot for single groupBy", () => {
    const { query } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name"],
      logAttributes: { "event.name": "tool_decision" },
    });

    expect(query).toMatchInlineSnapshot(`
      "
      SELECT
        LogAttributes[{groupByKey0:String}] AS group_0,
        COUNT(*) AS value
      FROM otel_logs
      WHERE ServiceName = {serviceName:String} AND LogAttributes[{logAttrKey0:String}] = {logAttrVal0:String}
      GROUP BY group_0
      ORDER BY value DESC
      LIMIT 1000"
    `);
  });

  it("matches expected SQL snapshot for multi-key groupBy with time range", () => {
    const { query } = buildAggregatedLogsQuery({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name", "decision"],
      logAttributes: { "event.name": "tool_decision" },
      timestampMin: "1700000000000000000",
      timestampMax: "1700100000000000000",
    });

    expect(query).toMatchInlineSnapshot(`
      "
      SELECT
        LogAttributes[{groupByKey0:String}] AS group_0,
        LogAttributes[{groupByKey1:String}] AS group_1,
        COUNT(*) AS value
      FROM otel_logs
      WHERE ServiceName = {serviceName:String} AND Timestamp >= {tsMin:DateTime64(9)} AND Timestamp <= {tsMax:DateTime64(9)} AND LogAttributes[{logAttrKey0:String}] = {logAttrVal0:String}
      GROUP BY group_0, group_1
      ORDER BY value DESC
      LIMIT 1000"
    `);
  });

  it("applies all log filter dimensions", () => {
    const { query, params } = buildAggregatedLogsQuery({
      serviceName: "svc",
      scopeName: "sc",
      traceId: "tid",
      spanId: "sid",
      severityText: "ERROR",
      severityNumberMin: 13,
      severityNumberMax: 21,
      eventName: "evt",
      bodyContains: "needle",
      aggregate: "count",
      groupBy: ["k"],
      resourceAttributes: { "tenant.id": "abc" },
      scopeAttributes: { "scope.k": "v" },
    });

    expect(query).toContain("ServiceName = {serviceName:String}");
    expect(query).toContain("ScopeName = {scopeName:String}");
    expect(query).toContain("TraceId = {traceId:String}");
    expect(query).toContain("SpanId = {spanId:String}");
    expect(query).toContain("SeverityText = {severityText:String}");
    expect(query).toContain("SeverityNumber >= {sevMin:UInt8}");
    expect(query).toContain("SeverityNumber <= {sevMax:UInt8}");
    expect(query).toContain("EventName = {eventName:String}");
    expect(query).toContain("Body ILIKE {bodyContains:String}");
    expect(query).toContain("ResourceAttributes[{resAttrKey0:String}]");
    expect(query).toContain("ScopeAttributes[{scopeAttrKey0:String}]");
    expect(params.serviceName).toBe("svc");
    expect(params.scopeName).toBe("sc");
    expect(params.traceId).toBe("tid");
    expect(params.spanId).toBe("sid");
    expect(params.resAttrKey0).toBe("tenant.id");
    expect(params.resAttrVal0).toBe("abc");
    expect(params.scopeAttrKey0).toBe("scope.k");
    expect(params.scopeAttrVal0).toBe("v");
  });
});
