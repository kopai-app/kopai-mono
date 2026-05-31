| title                 | impact   | tags                     |
| --------------------- | -------- | ------------------------ |
| Step 4: Check Metrics | CRITICAL | workflow, metrics, step4 |

## Step 4: Quantify Impact & Pinpoint Onset

**Impact:** CRITICAL

This is the upgrade the CLI cannot do: bucket measures over time to see **when** the
regression started and **how wide** the blast radius is. `.timeSeries(granularity)`
turns a flat "it's broken" into a precise onset and a per-service spread.

### (a) Trace-derived impact over time (lead here)

Traces already carry error rate and latency — no metric discovery needed. Bucket over a
window wide enough to bracket the onset (`3h`), at a granularity fine enough to spot the
inflection (`5m`). `errorRate` counts errors server-side (dodges the `"Error"`-casing
trap); `Duration` is **nanoseconds** so `avg`/`max` come back in ns.

```ts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
// const client = clientFromConfig();

try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.errorRate("error_rate"))
    .measure((m) => m.avg("Duration", "avg_ns"))
    .measure((m) => m.max("Duration", "max_ns"))
    .dimension("service.name")
    .timeRelative("3h")
    .timeSeries("5m")
    .orderByMeasure("error_rate", "desc")
    .build();
  const { data } = await client.queryTracesAggregate(q);
  console.log(JSON.stringify(data, null, 2)); // each row: bucket + service + measures
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

Read the buckets: the first one where `error_rate` (or `avg_ns`/`max_ns`) jumps is the
**onset**; the set of `service.name` values that move together is the **blast radius**.

**ClickHouse upgrade** — add `p95`/`p99` for tail latency. Percentiles are ClickHouse-only
and **hard-fail at query time on SQLite**, so isolate them in their own try/catch and keep
`avg`/`max` as the portable baseline:

```ts
try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.p95("Duration", "p95_ns"))
    .measure((m) => m.p99("Duration", "p99_ns"))
    .dimension("service.name")
    .timeRelative("3h")
    .timeSeries("5m")
    .build();
  const { data } = await client.queryTracesAggregate(q);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  console.error("percentiles need ClickHouse; fall back to avg/max:", e);
}
```

### (b) Discover available metrics

When the symptom is a system resource (CPU, memory, queue depth) rather than request
errors, switch to the metrics pipeline — but **discover first** to get the exact `name`
and `type`:

```ts
const { metrics } = await client.discoverMetrics();
// each entry: { name, type, unit, description, attributes, resourceAttributes }
console.log(metrics.map((m) => `${m.name} (${m.type}, ${m.unit})`));
```

### (c) Metric aggregate over time (MetricType pin required)

Every metric query **must pin exactly one `MetricType`** at the top-level AND (it cannot
sit inside an `or()`, and only one type per query). Aggregate over `"Value"` for
`Gauge`/`Sum`; over `Count`/`Sum`/`Max` for `Histogram`. Bucket with `.timeSeries()` to
align the metric's onset against the trace onset from (a).

```ts
const NAME = "http.server.errors"; // from discoverMetrics()
try {
  const q = kq.metrics
    .aggregate()
    .measure((m) => m.avg("Value", "v"))
    .where((f) => f.eq("MetricType", "Sum")) // pin exactly one type
    .where((f) => f.eq("MetricName", NAME))
    .timeRelative("1h")
    .timeSeries("1m")
    .build();
  const { data } = await client.queryMetricsAggregate(q);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

### Which signal to read

- **Error rate / counts** → trace `errorRate` measure (a), or a `Sum` metric like
  `http.server.errors` (c). Pin `MetricType "Sum"`, aggregate `Value`.
- **Latency** → trace `avg`/`max` of `Duration` (portable); `p95`/`p99` only on
  ClickHouse. For a metric-side view use a `Histogram` and aggregate `Count`/`Sum`/`Max`.
- **Resource saturation** (CPU, memory, connections) → point-in-time `Gauge`. Pin
  `MetricType "Gauge"`, aggregate `Value` (`avg`/`max`), `.dimension("host.name")` for
  per-host spread.

Whatever the signal, `.timeSeries(granularity)` is what reveals **onset** — a `.summary()`
only confirms the issue exists.

### Reference

See references/metric-filters.md (MetricType pin, value columns, aggregations) and
references/trace-filters.md (Duration units, measure ops).

## CLI fallback (quick one-offs)

The CLI has no aggregation or time-series bucketing — use it only to discover a metric or
eyeball one type. Aggregate (`--aggregate`) is `Gauge`/`Sum`-only.

```bash
npx @kopai/cli metrics discover --json
npx @kopai/cli metrics search --type Sum --name http.server.errors --json
npx @kopai/cli metrics search --type Histogram --name http.server.duration --json
npx @kopai/cli metrics search --type Gauge --service payment-api --json
```
