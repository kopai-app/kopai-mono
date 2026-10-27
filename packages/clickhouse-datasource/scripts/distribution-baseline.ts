/**
 * 24-hour baseline for the distribution and counter ops (KOP-70, spec 9).
 *
 * Seeds a day of synthetic cumulative Sum and Histogram data into a
 * throwaway ClickHouse container, then times the staged queries next to
 * their plain-path neighbours. It records numbers; it asserts nothing. Run
 * it before and after a change to the staged SQL and compare.
 *
 *   pnpm --filter @kopai/clickhouse-datasource build
 *   node packages/clickhouse-datasource/scripts/distribution-baseline.ts
 *
 * Env: BASELINE_SERIES (default 100 per metric type), BASELINE_RUNS
 * (default 3). Needs Docker. Node 24 runs this file as TypeScript.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@clickhouse/client";
import { GenericContainer, Wait } from "testcontainers";
import { ClickHouseReadDatasource } from "../dist/index.mjs";
import { createOtelTables } from "../src/test/otel-ddl.ts";
import { CLICKHOUSE_IMAGE } from "../src/test/constants.ts";

const SERIES = Number(process.env.BASELINE_SERIES ?? 100);
const RUNS = Number(process.env.BASELINE_RUNS ?? 3);
const INTERVAL_S = 15;
const DAY_S = 24 * 3600;
const DATABASE = "baseline";
const BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

const dirname = path.dirname(fileURLToPath(import.meta.url));
const END = Date.UTC(2026, 0, 2, 0, 0, 0);
const START = END - DAY_S * 1000;

function chTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000000`;
}

function* points(kind: "Sum" | "Histogram") {
  for (let s = 0; s < SERIES; s++) {
    const resource = { "service.name": `svc-${String(s % 10)}` };
    let value = 0;
    let buckets = BOUNDS.map(() => 0).concat(0);
    let start = START - 3600 * 1000;
    // Lookback included: points start 5 minutes before the window.
    for (let t = START - 300_000; t < END; t += INTERVAL_S * 1000) {
      if ((t / 1000 + s * 997) % 21_600 === 0) {
        value = 0; // a restart every 6 hours per series, staggered
        buckets = buckets.map(() => 0);
        start = t - 1000;
      }
      const common = {
        ResourceAttributes: resource,
        ServiceName: resource["service.name"],
        MetricName: kind === "Sum" ? "baseline.requests" : "baseline.latency",
        MetricUnit: kind === "Sum" ? "1" : "ms",
        Attributes: { route: `/r${String(s % 5)}` },
        StartTimeUnix: chTime(start),
        TimeUnix: chTime(t),
        Flags: 0,
        AggregationTemporality: 2,
      };
      if (kind === "Sum") {
        value += 1 + ((t / 1000 + s) % 7);
        yield { ...common, Value: value, IsMonotonic: true };
      } else {
        buckets = buckets.map((b, i) => b + ((t / 1000 + s + i) % 4));
        const count = buckets.reduce((a, b) => a + b, 0);
        yield {
          ...common,
          Count: count,
          Sum: count * 120,
          BucketCounts: buckets,
          ExplicitBounds: BOUNDS,
          Min: 0,
          Max: 0,
        };
      }
    }
  }
}

function query(
  metricType: "Sum" | "Histogram",
  measures: unknown[],
  output: unknown,
  dimensions?: unknown[]
) {
  return {
    signal: "metrics",
    mode: "aggregate",
    timeDimension: {
      type: "absolute",
      startTime: new Date(START).toISOString(),
      endTime: new Date(END).toISOString(),
    },
    output,
    filters: [
      { column: "MetricType", op: "eq", value: metricType },
      ...(metricType === "Sum"
        ? [{ column: "IsMonotonic", op: "eq", value: true }]
        : []),
    ],
    measures,
    ...(dimensions && { dimensions }),
  };
}

const SUMMARY = { type: "summary" };
const FIVE_MIN = { type: "timeSeries", granularity: "5m" };
const BY_SERVICE = ["service.name"];

const CASES: [string, ReturnType<typeof query>][] = [
  [
    "plain: P95(Value) + SUM, by service",
    query(
      "Sum",
      [
        { op: "P95", column: "Value", as: "p95" },
        { op: "SUM", column: "Value", as: "s" },
      ],
      SUMMARY,
      BY_SERVICE
    ),
  ],
  [
    "INCREASE + RATE, by service",
    query(
      "Sum",
      [
        { op: "INCREASE", column: "Value", as: "inc" },
        { op: "RATE", column: "Value", as: "rate" },
      ],
      SUMMARY,
      BY_SERVICE
    ),
  ],
  [
    "RATE, 5m buckets",
    query("Sum", [{ op: "RATE", column: "Value", as: "rate" }], FIVE_MIN),
  ],
  [
    "HISTOGRAM_QUANTILE p95, by service",
    query(
      "Histogram",
      [{ op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" }],
      SUMMARY,
      BY_SERVICE
    ),
  ],
  [
    "HISTOGRAM_QUANTILE p95 + p99, 5m buckets",
    query(
      "Histogram",
      [
        { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" },
        { op: "HISTOGRAM_QUANTILE", quantile: 0.99, as: "p99" },
      ],
      FIVE_MIN
    ),
  ],
  [
    "HISTOGRAM_AVG + RATE(Count), 5m buckets, by service",
    query(
      "Histogram",
      [
        { op: "HISTOGRAM_AVG", as: "avg" },
        { op: "RATE", column: "Count", as: "rps" },
      ],
      FIVE_MIN,
      BY_SERVICE
    ),
  ],
];

async function main(): Promise<void> {
  console.log(`Starting ${CLICKHOUSE_IMAGE}…`);
  const container = await new GenericContainer(CLICKHOUSE_IMAGE)
    .withExposedPorts(8123)
    .withBindMounts([
      {
        source: path.join(dirname, "../src/test-users.xml"),
        target: "/etc/clickhouse-server/users.d/test-users.xml",
      },
    ])
    .withWaitStrategy(
      Wait.forHttp("/", 8123).forResponsePredicate((r) => r === "Ok.\n")
    )
    .start();
  const url = `http://${container.getHost()}:${String(container.getMappedPort(8123))}`;
  const admin = createClient({ url });
  await admin.command({ query: `CREATE DATABASE ${DATABASE}` });
  const client = createClient({ url, database: DATABASE });
  await createOtelTables(client);

  for (const kind of ["Sum", "Histogram"] as const) {
    const table =
      kind === "Sum" ? "otel_metrics_sum" : "otel_metrics_histogram";
    let batch: unknown[] = [];
    let rows = 0;
    const seeded = performance.now();
    for (const p of points(kind)) {
      batch.push(p);
      if (batch.length === 100_000) {
        await client.insert({ table, values: batch, format: "JSONEachRow" });
        rows += batch.length;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await client.insert({ table, values: batch, format: "JSONEachRow" });
      rows += batch.length;
    }
    await client.command({ query: `OPTIMIZE TABLE ${table} FINAL` });
    console.log(
      `${kind}: ${String(rows)} rows (${String(SERIES)} series, ${String(INTERVAL_S)} s interval) in ${((performance.now() - seeded) / 1000).toFixed(1)} s`
    );
  }

  const ds = new ClickHouseReadDatasource(url);
  const requestContext = {
    database: DATABASE,
    username: "default",
    password: "",
  };
  const version = await admin.query({
    query: "SELECT version() AS v",
    format: "JSONEachRow",
  });
  console.log(
    `ClickHouse ${String(((await version.json()) as { v: string }[])[0]?.v)}`
  );
  console.log(
    `\n| query | rows out | min ms | median ms |\n| --- | ---: | ---: | ---: |`
  );
  for (const [label, q] of CASES) {
    const times: number[] = [];
    let out = 0;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      const { data } = await ds.queryMetricsAggregate({
        ...(q as Parameters<typeof ds.queryMetricsAggregate>[0]),
        requestContext,
      });
      times.push(performance.now() - t0);
      out = data.length;
    }
    times.sort((a, b) => a - b);
    console.log(
      `| ${label} | ${String(out)} | ${times[0]!.toFixed(0)} | ${times[Math.floor(times.length / 2)]!.toFixed(0)} |`
    );
  }

  await ds.close();
  await client.close();
  await admin.close();
  await container.stop();
}

await main();
