// Distribution and counter ops (KOP-70) against real ClickHouse: the golden
// cases of spec 9.1 and seeded differential tests, each compared with the
// TypeScript reference (test/reference-ops.ts).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { ClickHouseReadDatasource } from "./datasource.js";
import { createOtelTables } from "./test/otel-ddl.js";
import { CLICKHOUSE_IMAGE } from "./test/constants.js";
import { GOLDEN_CASES } from "./test/golden-cases.js";
import { generateScenario } from "./test/differential.js";
import { referenceAggregate } from "./test/reference-ops.js";
import {
  expectRowsClose,
  runOnClickHouse,
  seed,
} from "./test/distribution-harness.js";

const CLICKHOUSE_HTTP_PORT = 8123;
const TEST_DATABASE = "test_distribution_ops";
const CONTAINER_STARTUP_TIMEOUT = 60_000;

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Differential scenarios: override the base seed to replay a failure.
const BASE_SEED = Number(process.env.KOPAI_DIFF_SEED ?? 7000);
const SCENARIO_COUNT = 300;
const SCENARIOS = Array.from({ length: SCENARIO_COUNT }, (_, i) =>
  generateScenario(BASE_SEED + i)
);

let container: StartedTestContainer;
let client: ClickHouseClient;
let ds: ClickHouseReadDatasource;

const requestContext = {
  database: TEST_DATABASE,
  username: "default",
  password: "",
};

beforeAll(async () => {
  container = await new GenericContainer(CLICKHOUSE_IMAGE)
    .withExposedPorts(CLICKHOUSE_HTTP_PORT)
    .withBindMounts([
      {
        source: path.join(dirname, "test-users.xml"),
        target: "/etc/clickhouse-server/users.d/test-users.xml",
      },
    ])
    .withWaitStrategy(
      Wait.forHttp("/", CLICKHOUSE_HTTP_PORT).forResponsePredicate(
        (response) => response === "Ok.\n"
      )
    )
    .start();
  const baseUrl = `http://${container.getHost()}:${String(
    container.getMappedPort(CLICKHOUSE_HTTP_PORT)
  )}`;
  const admin = createClient({ url: baseUrl });
  await admin.command({ query: `CREATE DATABASE ${TEST_DATABASE}` });
  await admin.close();
  client = createClient({ url: baseUrl, database: TEST_DATABASE });
  await createOtelTables(client);
  await seed(client, [
    ...GOLDEN_CASES.map((c) => ({ metricName: c.id, input: c.input })),
    ...SCENARIOS.map((sc) => ({
      metricName: `diff-${String(sc.seed)}`,
      input: sc.input,
    })),
  ]);
  ds = new ClickHouseReadDatasource(baseUrl);
}, CONTAINER_STARTUP_TIMEOUT);

afterAll(async () => {
  await ds?.close();
  await client?.close();
  await container?.stop();
});

describe("golden cases on ClickHouse (spec 9.1)", () => {
  it.each(GOLDEN_CASES.map((c) => [c.id, c] as const))("%s", async (_, c) => {
    const rows = await runOnClickHouse(ds, requestContext, c.id, c.input);
    expectRowsClose(rows, c.expected, c.id);
  });
});

function metricsQuery(
  metricName: string,
  metricType: string,
  measures: unknown[],
  extra: Record<string, unknown> = {}
) {
  const filters: unknown[] = [
    { column: "MetricType", op: "eq", value: metricType },
    { column: "MetricName", op: "eq", value: metricName },
  ];
  if (metricType === "Sum") {
    filters.push({ column: "IsMonotonic", op: "eq", value: true });
  }
  return {
    signal: "metrics",
    mode: "aggregate",
    timeDimension: {
      type: "absolute",
      startTime: "2026-01-01T12:00:00.000Z",
      endTime: "2026-01-01T12:05:00.000Z",
    },
    output: { type: "summary" },
    filters,
    measures,
    requestContext,
    ...extra,
  } as unknown as Parameters<
    ClickHouseReadDatasource["queryMetricsAggregate"]
  >[0];
}

describe("result value types", () => {
  it("returns numbers for range keys and integer increases, a string code for _error", async () => {
    const { data } = await ds.queryMetricsAggregate(
      metricsQuery("G16", "Histogram", [
        { op: "HISTOGRAM_QUANTILE", quantile: 0.5, as: "p" },
        { op: "INCREASE", column: "Count", as: "n" },
      ])
    );
    expect(data).toEqual([
      {
        p: null,
        p_low: null,
        p_high: null,
        p_coarsened: 0,
        p_error: "mixed_units",
        n: 20,
      },
    ]);
  });
});

describe("existing measures next to a new op", () => {
  const ROWS = 20_000;

  beforeAll(async () => {
    // Enough rows that quantileDeterministic samples (above 8,192), spread
    // over several series so the staged path merges per-series states.
    const values = Array.from({ length: ROWS }, (_, i) => {
      const ms = Date.UTC(2026, 0, 1, 12, 0, 0) + (i % 290) * 1000 + i;
      const iso = new Date(ms).toISOString();
      return {
        ResourceAttributes: { pod: `pod-${String(i % 7)}` },
        MetricName: "mixed",
        MetricUnit: "1",
        Attributes: { route: `/r${String(i % 3)}` },
        StartTimeUnix: "2026-01-01 09:00:00.000000000",
        TimeUnix: `${iso.slice(0, 10)} ${iso.slice(11, 23)}000000`,
        Value: (i * 7919) % 1000,
        Flags: i % 50 === 0 ? 1 : 0,
        AggregationTemporality: 2,
        IsMonotonic: true,
      };
    });
    await client.insert({
      table: "otel_metrics_sum",
      values,
      format: "JSONEachRow",
    });
  });

  const existing = [
    { op: "P95", column: "Value", as: "p95" },
    { op: "P50", column: "Value", as: "p50" },
    { op: "COUNT", as: "n" },
    { op: "SUM", column: "Value", as: "total" },
    { op: "MAX", column: "Value", as: "max" },
    { op: "RATE_SUM", column: "Value", as: "rs" },
    {
      op: "COUNT_DISTINCT",
      column: { container: "Attributes", key: "route" },
      as: "routes",
    },
  ];

  it.each([
    ["summary", {}],
    [
      "grouped timeSeries",
      {
        dimensions: [{ container: "ResourceAttributes", key: "pod" }],
        output: { type: "timeSeries", granularity: "1m" },
      },
    ],
  ])(
    "gives the same values with and without INCREASE (%s)",
    async (_, extra) => {
      const plain = await ds.queryMetricsAggregate(
        metricsQuery("mixed", "Sum", existing, extra)
      );
      const staged = await ds.queryMetricsAggregate(
        metricsQuery(
          "mixed",
          "Sum",
          [...existing, { op: "INCREASE", column: "Value", as: "inc" }],
          extra
        )
      );
      const key = (r: Record<string, unknown>) =>
        `${String(r["ResourceAttributes.pod"])}|${String(r.bucket_start)}`;
      const strip = (rows: Record<string, unknown>[]) =>
        rows
          .map(({ inc: _inc, ...rest }) => rest)
          .sort((a, b) => (key(a) < key(b) ? -1 : 1));
      expect(plain.data.length).toBeGreaterThan(0);
      expect(strip(staged.data)).toEqual(strip(plain.data));
    }
  );
});

describe("ordering and limit with errored groups", () => {
  it.each(["asc", "desc"] as const)(
    "sorts errored groups last (%s) and counts them against limit",
    async (direction) => {
      const q = (limit?: number) =>
        metricsQuery(
          "G26",
          "Histogram",
          [{ op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p" }],
          {
            dimensions: [
              { container: "ResourceAttributes", key: "service.name" },
            ],
            orderBy: [{ type: "measure", alias: "p", direction }],
            ...(limit !== undefined && { limit }),
          }
        );
      const all = await ds.queryMetricsAggregate(q());
      const services = all.data.map(
        (r) => r["ResourceAttributes.service.name"]
      );
      expect(services).toEqual(
        direction === "asc" ? ["c", "a", "b"] : ["a", "c", "b"]
      );
      const limited = await ds.queryMetricsAggregate(q(3));
      expect(limited.data).toHaveLength(3);
    }
  );
});

describe("differential: ClickHouse equals the reference on seeded scenarios", () => {
  it.each(SCENARIOS.map((sc) => [sc.seed, sc] as const))(
    "seed %i",
    async (seedNo, sc) => {
      const name = `diff-${String(seedNo)}`;
      const label = `seed ${String(seedNo)} (KOPAI_DIFF_SEED=${String(seedNo)})`;
      const rows = await runOnClickHouse(ds, requestContext, name, sc.input);
      expectRowsClose(rows, referenceAggregate(sc.input), label);

      // Buckets add up to the summary over the same window (spec 4.2).
      const counts = sc.input.measures.some((m) => m.op === "INCREASE");
      if (sc.input.granularitySec === undefined || !counts) return;
      const { granularitySec: _g, ...summaryInput } = sc.input;
      const summary = await runOnClickHouse(
        ds,
        requestContext,
        name,
        summaryInput
      );
      const groupKey = (r: Record<string, unknown>) =>
        (sc.input.groupBy ?? []).map((g) => String(r[g])).join("|");
      for (const s of summary) {
        const parts = rows
          .filter((r) => groupKey(r) === groupKey(s))
          .map((r) => r.inc)
          .filter((v): v is number => typeof v === "number");
        const total = parts.reduce((a, b) => a + b, 0);
        if (s.inc === null) {
          expect(parts, label).toEqual([]);
        } else {
          expect(
            Math.abs(total - Number(s.inc)),
            `${label}: buckets ${String(total)} vs summary ${String(s.inc)}`
          ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(Number(s.inc))));
        }
      }
    }
  );
});
