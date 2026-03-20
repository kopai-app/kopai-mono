import { describe, it, expect } from "vitest";
import {
  buildDiscoverMetricsQueries,
  buildAggregatedMetricsQuery,
} from "./query-metrics.js";

describe("buildDiscoverMetricsQueries", () => {
  it("does not produce double arrayJoin in attributesQuery", () => {
    const { attributesQuery } = buildDiscoverMetricsQueries();

    // Should use ARRAY JOIN clause, not nested arrayJoin() calls
    const lines = attributesQuery.split("\n");
    for (const line of lines) {
      const count = (line.match(/arrayJoin\(/g) || []).length;
      expect(
        count,
        `double arrayJoin on line: ${line.trim()}`
      ).toBeLessThanOrEqual(1);
    }
  });

  it("uses ARRAY JOIN clause for attribute expansion", () => {
    const { attributesQuery } = buildDiscoverMetricsQueries();
    expect(attributesQuery).toContain("ARRAY JOIN mapKeys(");
  });
});

describe("buildAggregatedMetricsQuery", () => {
  it("generates SUM aggregation with single groupBy", () => {
    const { query, params } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      metricName: "kopai.ingestion.bytes",
      aggregate: "sum",
      groupBy: ["tenant.id"],
    });

    expect(query).toContain("SUM(Value) AS value");
    expect(query).toContain("FROM otel_metrics_sum");
    expect(query).toContain("GROUP BY");
    expect(query).toContain("Attributes[{groupByKey0:String}]");
    expect(query).toContain("ORDER BY value DESC");
    expect(query).not.toContain("_rowHash");
    expect(params.metricName).toBe("kopai.ingestion.bytes");
    expect(params.groupByKey0).toBe("tenant.id");
  });

  it("generates AVG aggregation with multiple groupBy keys", () => {
    const { query, params } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "avg",
      groupBy: ["tenant.id", "signal"],
    });

    expect(query).toContain("AVG(Value) AS value");
    expect(query).toContain("Attributes[{groupByKey0:String}]");
    expect(query).toContain("Attributes[{groupByKey1:String}]");
    expect(query).toContain("GROUP BY");
    expect(params.groupByKey0).toBe("tenant.id");
    expect(params.groupByKey1).toBe("signal");
  });

  it("generates COUNT aggregation without groupBy", () => {
    const { query } = buildAggregatedMetricsQuery({
      metricType: "Gauge",
      metricName: "some.gauge",
      aggregate: "count",
    });

    expect(query).toContain("COUNT(Value) AS value");
    expect(query).toContain("FROM otel_metrics_gauge");
    expect(query).not.toContain("GROUP BY");
  });

  it("adds AggregationTemporality = 1 for Sum metric type", () => {
    const { query } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "sum",
      groupBy: ["signal"],
    });

    expect(query).toContain("AggregationTemporality = 1");
  });

  it("does NOT add AggregationTemporality filter for Gauge", () => {
    const { query } = buildAggregatedMetricsQuery({
      metricType: "Gauge",
      aggregate: "sum",
    });

    expect(query).not.toContain("AggregationTemporality");
  });

  it("applies time range and attribute filters", () => {
    const { query, params } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "sum",
      groupBy: ["tenant.id"],
      timeUnixMin: "1700000000000000000",
      timeUnixMax: "1700100000000000000",
      attributes: { signal: "/v1/traces" },
    });

    expect(query).toContain("TimeUnix >= {tsMin:DateTime64(9)}");
    expect(query).toContain("TimeUnix <= {tsMax:DateTime64(9)}");
    expect(query).toContain("Attributes[{attrKey0:String}]");
    expect(params.attrKey0).toBe("signal");
    expect(params.attrVal0).toBe("/v1/traces");
  });

  it("applies LIMIT", () => {
    const { query, params } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "sum",
      groupBy: ["tenant.id"],
      limit: 50,
    });

    expect(query).toContain("LIMIT {limit:UInt32}");
    expect(params.limit).toBe(50);
  });

  it("uses MIN/MAX aggregate functions", () => {
    const { query: minQuery } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "min",
    });
    expect(minQuery).toContain("MIN(Value) AS value");

    const { query: maxQuery } = buildAggregatedMetricsQuery({
      metricType: "Sum",
      aggregate: "max",
    });
    expect(maxQuery).toContain("MAX(Value) AS value");
  });
});
