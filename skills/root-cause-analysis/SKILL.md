---
name: root-cause-analysis
description: Investigate and root-cause production issues from live OpenTelemetry telemetry (traces, logs, metrics) with the Kopai SDK in TypeScript code mode. Use this skill to debug errors and error-rate spikes, investigate latency/slowness and timeouts, trace requests across services, find failing or cascading services, and correlate logs to a trace — including vague symptom reports like 'why is my API slow', 'getting 500 errors', 'service is down', 'requests are timing out', or 'something is failing in prod', even when the user never says 'traces' or 'observability'. This analyzes existing telemetry to find a cause. Do NOT use it to add instrumentation (use otel-instrumentation), to build dashboards or visualizations (use create-dashboard), or to fix non-telemetry problems like failing CI, lint errors, unit tests, or SQL query tuning.
license: Apache-2.0
metadata:
  author: kopai
  version: "1.4.1"
---

# Root Cause Analysis with Kopai

Debug production issues from telemetry (traces, logs, metrics). Kopai's analytical
power — error rate, throughput, latency, group-by, time-series bucketing — lives in
the **SDK query API**, which the CLI does not expose. So lead every investigation by
writing a short TypeScript script; the CLI stays as a quick-lookup fallback.

## Prerequisites

- Services are sending OpenTelemetry data to Kopai (see the `otel-instrumentation` skill).
- `@kopai/sdk` is installed in the project: `npm i @kopai/sdk` (it ships the query API and the `.kopairc` reader).

## Code mode (recommended)

**Connect** — `clientFromConfig()` reads `.kopairc` exactly like the CLI:

```ts
import { clientFromConfig } from "@kopai/sdk/node";
// Reads ./.kopairc then ~/.kopairc; defaults to http://localhost:8000.
// Override any field: clientFromConfig({ url, token, configPath, timeout }).
const client = clientFromConfig();
```

**Run** — `npx tsx rca.mts`. Use the **`.mts`** extension: it is always an ES module, so
top-level `await` works without depending on the host project's `package.json` `"type"`.
(If `tsx` is missing: `node --experimental-strip-types rca.mts`.)

**Build a query with `kq`, run it with `client.query(q)`.** `client.query(q)` is the
single clean way to run any built query and is **fully typed** — rows autocomplete and
typos are compile errors. Aggregate queries return `{ data }`; raw queries return
`{ data, nextCursor }`. **Result rows are fully typed — iterate `data` directly and never
cast to `any`/`any[]`.** Aggregate measure values are `number` (so `row.error_rate * 100`
just works — no `String(...)`/cast), grouped dimensions are present (`row["service.name"]`),
and `.timeSeries()` rows add `bucket_start`:

```ts
const { data } = await client.query(q); // typed rows — do NOT write `data as any[]`
for (const row of data) {
  console.log(
    row["service.name"],
    `${(row.error_rate * 100).toFixed(1)}%`,
    row.rps
  );
}
```

**Output** — stdout is your result. End with `console.log(JSON.stringify(data, null, 2))`,
and wrap `.build()` + the query call in try/catch:

```ts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
try {
  const q = kq.traces
    .aggregate() /* … */
    .build();
  const { data } = await client.query(q);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError)
    console.error(e.issues); // {path,message}[]
  else throw e;
}
```

## Backend caveats & gotchas (read before querying)

- **Every query needs a time window** — `.timeRelative("1h")` or `.timeAbsolute(startISO, endISO)`. Lookback/granularity match `^[1-9]\d*[smhdw]$` (`"30s"`, `"15m"`, `"2h"`, `"7d"`).
- **`StatusCode` is exactly `"Unset" | "Ok" | "Error"`** (title case). Successful spans are usually `"Unset"`, not `"Ok"`. This enum is type-checked: a wrong value like `"ERROR"` is a **compile error**, so the casing trap is caught for you. Prefer the `errorRate` measure (counts errors server-side) over filtering the raw value anyway.
- **Use `service.name` (dotted), never `ServiceName`.** `ServiceName` is not a queryable column — filtering on it silently matches nothing. (In result rows the value comes back keyed as you grouped it, e.g. `row["service.name"]`.)
- **Empty result on a busy system ≈ a wrong column/value, not real absence.** Before concluding "no errors / no data", re-check the column name and value casing — silent empties are the #1 way to reach a false "all healthy" conclusion.
- **Percentiles (`p50`–`p999`) are ClickHouse-only.** On SQLite they fail at query time (`KopaiError: Percentile measures … not yet supported on the sqlite backend`). Lead latency with `avg`/`max` of `Duration`; treat percentiles as a ClickHouse upgrade in try/catch.
- **`Duration` filters accept duration strings** with units `s`/`m`/`h`/`d`/`w` — `f.gt("Duration", "1s")`, `f.lte("Duration", "2h")` (also `gte`/`lt`). No sub-second units; for sub-second thresholds pass a nanosecond number. (Result rows still report `Duration` in nanoseconds — `avg`/`max` of `Duration` come back in ns: 1ms = 1e6, 1s = 1e9.)
- **Metric queries choose the type up front:** `kq.metrics("Gauge")…`, `kq.metrics("Sum")…` (type ∈ `"Gauge" | "Sum" | "Histogram" | "ExponentialHistogram" | "Summary"`). The builder arg **auto-pins** the `MetricType`, so no manual `.where(f => f.eq("MetricType", …))`. Value columns are typed per type: Gauge/Sum → `"Value"`; Histogram/ExponentialHistogram → `"Count" | "Sum" | "Min" | "Max"`; Summary → `"Count" | "Sum"`.
- **`searchTraces`/`searchLogs`/`searchMetrics` are async iterables** (auto-paginate) — consume with `for await (const row of client.searchLogs({ … })) { … }`, do **not** `await` them as an array. For a single page use `searchTracesPage`/`searchLogsPage`/`searchMetricsPage` → `{ data, nextCursor }`. Limits: `kq` `.limit()` caps at 10000; `search*` filters cap at 1000.

## RCA Workflow

1. **Find the failing work** — rank services by error rate and throughput. `errorRate`
   handles `StatusCode` server-side, so you never guess the value:

   ```ts
   const q = kq.traces
     .aggregate()
     .measure((m) => m.errorRate("error_rate"))
     .measure((m) => m.throughput("rps"))
     .measure((m) => m.count("spans"))
     .dimension("service.name")
     .timeRelative("1h")
     .summary()
     .orderByMeasure("error_rate", "desc")
     .build();
   const { data } = await client.query(q);
   ```

   For log-first triage, pull error-level logs by **`SeverityNumber >= 17`** (catches
   ERROR/FATAL regardless of text casing):
   `client.query(kq.logs.raw().where(f => f.gte("SeverityNumber", 17)).timeRelative("1h").limit(50).build())`.
   See `workflow-find-errors`.

2. **Get full trace context** — `const spans = await client.getTrace(traceId)`. Inspect
   `Duration` (bottlenecks), `ParentSpanId` (call chain), `StatusMessage`, `SpanKind`.
   See `workflow-get-context`.

3. **Correlate logs to the trace** —
   `client.query(kq.logs.raw().where(f => f.eq("TraceId", traceId)).timeRelative("1h").build())`
   (or iterate `client.searchLogs({ traceId })`). Look for the earliest error and its
   stack trace. See `workflow-correlate-logs`.

4. **Quantify impact / pinpoint onset** — the upgrade the CLI can't do. Bucket the metric
   over time to see when it started and how wide the blast radius is. Watch the
   retention floor: if the earliest bucket is already elevated, the true onset is at or
   before it — say so rather than calling the floor a "step change":

   ```ts
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
   const { data } = await client.query(q);
   ```

   When the signal is a metric rather than a trace, choose the type up front and let it
   auto-pin `MetricType` — e.g. bucket a Gauge over time:

   ```ts
   const q = kq
     .metrics("Gauge")
     .aggregate()
     .measure((m) => m.avg("Value", "avg_value"))
     .where((f) => f.eq("MetricName", "process.cpu.utilization"))
     .timeRelative("3h")
     .timeSeries("5m")
     .build();
   const { data } = await client.query(q);
   ```

   See `workflow-check-metrics`.

5. **Present findings** — root cause with evidence (specific TraceIds, log entries,
   metric deltas), blast radius, and a suggested fix. Offer to build an incident
   dashboard (see the `create-dashboard` skill). See `workflow-identify-cause`.

## Quick Example

```ts
// rca-triage.mts — run: npx tsx rca-triage.mts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.errorRate("error_rate"))
    .measure((m) => m.throughput("rps"))
    .measure((m) => m.avg("Duration", "avg_ns"))
    .measure((m) => m.max("Duration", "max_ns"))
    .measure((m) => m.count("spans"))
    .dimension("service.name")
    .timeRelative("1h")
    .summary()
    .orderByMeasure("error_rate", "desc")
    .build();

  const { data } = await client.query(q); // typed rows
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

## Rules

### 1. Workflow (CRITICAL)

- `workflow-find-errors` - Find error traces and error-level logs
- `workflow-get-context` - Get full trace context
- `workflow-correlate-logs` - Correlate logs with a trace
- `workflow-check-metrics` - Quantify impact with aggregate/time-series queries
- `workflow-identify-cause` - Identify root cause & present findings

### 2. Patterns (HIGH)

- `pattern-http-errors` - HTTP error debugging
- `pattern-slow-requests` - Slow request analysis
- `pattern-distributed` - Distributed failure tracing
- `pattern-log-driven` - Log-driven investigation

Read `rules/<rule-name>.md` for details.

## Tips

1. Start from the aggregate (error rate / latency by service), then drill into one trace.
2. Prefer the `errorRate` measure over filtering `StatusCode` (counted server-side).
3. Run any built query with `client.query(q)` — it is fully typed (rows autocomplete, typos compile-error).
4. Filter `Duration` with strings (`f.gt("Duration", "1s")`); result rows still report `Duration` in nanoseconds. The earliest error in a trace chain is usually closest to root cause.
5. Use `.timeSeries(granularity)` to find _when_ a regression started — and don't mistake the retention floor for the onset.
6. For metrics, pick the type up front — `kq.metrics("Gauge")…` (auto-pins `MetricType`, types the value columns).
7. On SQLite, latency = `avg`/`max` of `Duration`; switch to `p95`/`p99` on ClickHouse.

## CLI fallback (quick one-offs)

The CLI is fine for a single lookup, but has no query/aggregation command. Note the
`StatusCode` value is the literal `"Error"`.

```bash
npx @kopai/cli traces search --status-code Error --limit 20 --json
npx @kopai/cli traces get <traceId> --json
npx @kopai/cli logs search --trace-id <traceId> --severity-min 17 --json
npx @kopai/cli metrics discover --json
```

## References

- [trace-filters](references/trace-filters.md) - Trace columns, filter/measure ops, containers
- [log-filters](references/log-filters.md) - Log columns, severity model, filter ops
- [metric-filters](references/metric-filters.md) - Metric columns, MetricType pin, aggregations
