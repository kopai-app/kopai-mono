/**
 * Runs a reference-implementation input (reference-ops.ts) against real
 * ClickHouse: seeds its points as table rows and turns it into the
 * equivalent KopaiQuery. Shared by the golden and differential tests, so
 * both compare the SQL path with the reference on exactly the same data.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { kopaiQuery } from "@kopai/core";
import { expect } from "vitest";
import type { ClickHouseReadDatasource } from "../datasource.js";
import type { RefInput, RefPoint, RefRow } from "./reference-ops.js";

const TABLE = {
  Sum: "otel_metrics_sum",
  Histogram: "otel_metrics_histogram",
  Summary: "otel_metrics_summary",
} as const;

/** Epoch ms → ClickHouse DateTime64(9) text. */
function chTime(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-01-01T12:00:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000000`;
}

function row(
  input: RefInput,
  metricName: string,
  p: RefPoint
): Record<string, unknown> {
  const resource = p.resource ?? {};
  const common = {
    ResourceAttributes: resource,
    ResourceSchemaUrl: "",
    ScopeName: p.scopeName ?? "",
    ScopeVersion: p.scopeVersion ?? "",
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: "",
    ServiceName: resource["service.name"] ?? "",
    MetricName: metricName,
    MetricDescription: "",
    MetricUnit: p.unit ?? "",
    Attributes: p.attributes ?? {},
    StartTimeUnix: chTime(p.start),
    TimeUnix: chTime(p.time),
    Flags: p.flags ?? 0,
  };
  switch (input.metricType) {
    case "Sum":
      return {
        ...common,
        Value: p.value ?? 0,
        AggregationTemporality: p.temporality ?? 0,
        IsMonotonic: true,
      };
    case "Histogram":
      return {
        ...common,
        Count: p.count ?? 0,
        Sum: p.sum ?? 0,
        BucketCounts: p.buckets ?? [],
        ExplicitBounds: p.bounds ?? [],
        Min: 0,
        Max: 0,
        AggregationTemporality: p.temporality ?? 0,
      };
    case "Summary":
      return {
        ...common,
        Count: p.count ?? 0,
        Sum: p.sum ?? 0,
        "ValueAtQuantiles.Quantile": (p.quantiles ?? []).map((q) => q.quantile),
        "ValueAtQuantiles.Value": (p.quantiles ?? []).map((q) => q.value),
      };
  }
}

/**
 * Inserts each input's points under its MetricName, one insert per table:
 * a MergeTree insert per case costs about a second.
 */
export async function seed(
  client: ClickHouseClient,
  cases: readonly { metricName: string; input: RefInput }[]
): Promise<void> {
  const byTable = new Map<string, Record<string, unknown>[]>();
  for (const { metricName, input } of cases) {
    const table = TABLE[input.metricType];
    const rows = byTable.get(table) ?? [];
    for (const p of input.points) rows.push(row(input, metricName, p));
    byTable.set(table, rows);
  }
  for (const [table, values] of byTable) {
    await client.insert({ table, values, format: "JSONEachRow" });
  }
}

const dimension = (key: string) => ({
  container: "ResourceAttributes" as const,
  key,
});

/** The KopaiQuery that asks ClickHouse what `referenceAggregate` computes. */
export function toKopaiQuery(
  metricName: string,
  input: RefInput
): kopaiQuery.MetricAggregateQuery {
  const filters: unknown[] = [
    { column: "MetricType", op: "eq", value: input.metricType },
    { column: "MetricName", op: "eq", value: metricName },
  ];
  if (input.metricType === "Sum") {
    filters.push({ column: "IsMonotonic", op: "eq", value: true });
  }
  const q = {
    signal: "metrics",
    mode: "aggregate",
    timeDimension: {
      type: "absolute",
      startTime: new Date(input.window.startMs).toISOString(),
      endTime: new Date(input.window.endMs).toISOString(),
    },
    output:
      input.granularitySec === undefined
        ? { type: "summary" }
        : { type: "timeSeries", granularity: `${input.granularitySec}s` },
    filters,
    measures: input.measures,
    ...(input.groupBy && { dimensions: input.groupBy.map(dimension) }),
    ...(input.having && { havings: input.having }),
  };
  return q as unknown as kopaiQuery.MetricAggregateQuery;
}

/**
 * ClickHouse rows in the reference's shape and order: dimension keys
 * without their container prefix, bucket_start as epoch ms, sorted by
 * group then bucket.
 */
export async function runOnClickHouse(
  ds: ClickHouseReadDatasource,
  requestContext: unknown,
  metricName: string,
  input: RefInput
): Promise<RefRow[]> {
  const { data } = await ds.queryMetricsAggregate({
    ...toKopaiQuery(metricName, input),
    requestContext,
  });
  const groupBy = input.groupBy ?? [];
  const rows = data.map((r) => {
    const out: RefRow = {};
    for (const [k, v] of Object.entries(r)) {
      const dim = groupBy.find((g) => k === `ResourceAttributes.${g}`);
      if (dim !== undefined) out[dim] = v;
      else if (k === "bucket_start") out[k] = Date.parse(String(v));
      else out[k] = v;
    }
    return out;
  });
  return rows.sort((a, b) => {
    for (const g of groupBy) {
      const x = String(a[g]);
      const y = String(b[g]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return Number(a.bucket_start ?? 0) - Number(b.bucket_start ?? 0);
  });
}

/** Same keys, same order; numbers equal to 1e-9 relative. */
export function expectRowsClose(
  actual: RefRow[],
  expected: RefRow[],
  label = ""
): void {
  expect(
    actual.map((r) => Object.keys(r).sort()),
    `${label} keys`
  ).toEqual(expected.map((r) => Object.keys(r).sort()));
  actual.forEach((row, i) => {
    for (const [key, want] of Object.entries(expected[i]!)) {
      const got = row[key];
      if (typeof want === "number" && typeof got === "number") {
        const tolerance = 1e-9 * Math.max(1, Math.abs(want));
        expect(
          Math.abs(got - want),
          `${label} row ${i} ${key}: got ${got}, want ${want}`
        ).toBeLessThanOrEqual(tolerance);
      } else {
        expect(got, `${label} row ${i} ${key}`).toEqual(want);
      }
    }
  });
}
