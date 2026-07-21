---
name: workflow
description: Dashboard creation workflow
priority: critical
---

# Dashboard Creation Workflow

Code mode: build each leaf tile's data with `kq`, embed it as `dataSource: { method: "query", params: <builtQuery> }`, then create the dashboard with `client.createDashboard(...)`. Run with `npx tsx <name>.mts` (**`.mts`** so top-level `await` works regardless of host module type).

## Steps

1. **Discover metrics** — `const { metrics } = await client.discoverMetrics();` Each entry is `{ name, type, unit, description, attributes, resourceAttributes }`. Pass the metric's `type` as the `kq.metrics("<Type>")` builder argument; set the tile `unit` prop from the metric's `unit`.
2. **Build each tile's query** — data tiles render **raw rows**, so build with `kq.<signal>.raw()…build()` → a `KopaiQuery` held in a variable (metrics: `kq.metrics("<Type>").raw()…build()`). Every query needs a time window (`.timeRelative("1h")` / `.timeAbsolute(startISO, endISO)`). (Aggregates — `.aggregate()…summary()`/`.timeSeries(granularity)` — are for analysis, not tile data; tile renderers reject aggregate/summary/timeSeries rows.)
3. **Assemble the `uiTree`** — embed the built query: `dataSource: { method: "query", params: builtQuery }`.
4. **Create** — wrap in try/catch:

   ```ts
   import { kq, KopaiQueryBuildError } from "@kopai/sdk";
   import { clientFromConfig } from "@kopai/sdk/node";
   const client = clientFromConfig();

   const { metrics } = await client.discoverMetrics();

   // Leaf tile data — RAW query; MetricType is the builder arg (auto-pins it).
   const cpuSeries = kq
     .metrics("Gauge")
     .raw()
     .where((f) => f.eq("MetricName", "system.cpu.utilization"))
     .timeRelative("1h")
     .limit(500)
     .build();

   const uiTree = {
     root: "stack-1",
     elements: {
       "stack-1": {
         key: "stack-1",
         type: "Stack",
         props: { direction: "vertical", gap: "md", align: null },
         children: ["card-1"],
         parentKey: "",
       },
       "card-1": {
         key: "card-1",
         type: "Card",
         props: { title: "CPU Usage", description: null, padding: null },
         children: ["ts-1"],
         parentKey: "stack-1",
       },
       "ts-1": {
         key: "ts-1",
         type: "MetricTimeSeries",
         props: { height: 300, showBrush: null, yAxisLabel: null, unit: "1" }, // unit from the metric's OTEL unit; null for unused nullable props
         children: [],
         parentKey: "card-1",
         dataSource: { method: "query", params: cpuSeries },
       },
     },
   };

   try {
     const dash = await client.createDashboard({
       name: "CPU Dashboard",
       uiTreeVersion: "0.14.0", // SDK field is uiTreeVersion (CLI flag is --tree-version)
       uiTree,
       metadata: {},
     });
     console.log(dash.id);
   } catch (err) {
     // On KopaiValidationError/KopaiError: re-run discoverMetrics() to recheck
     // names + types, fix the tree, retry. KopaiQueryBuildError = bad kq query.
     console.error(err);
   }
   ```

5. **View** — `<baseUrl>/?tab=metrics&dashboardId=<dash.id>`.

## Tree Structure Rules

- Every element needs: `key`, `type`, `children` array, `parentKey`, `props`
- Root element's `parentKey` is `""`
- Root key must exist in `elements`
- No orphan elements — every non-root element's `parentKey` must reference an existing element
- `children` array must list keys of child elements

## DataSource Rules

- Leaf components (no children) carry a `dataSource`; layout components (Stack/Grid/Card) do not.
- `dataSource.method` must be valid. Prefer **`"query"`** with a built `kq` query as `params`. Legacy methods still work as fallback: `searchMetricsPage`, `searchAggregatedMetrics`, `searchLogsPage`, `searchTracesPage`.
- `dataSource.params` must match the method: a `kq` `KopaiQuery` for `"query"`, or the method's own param schema for legacy methods.
- Data tiles render **raw rows** — build their `kq` query with `kq.<signal>.raw()…build()`, **not** `.aggregate()`. The renderers reject aggregate/`summary`/`timeSeries` rows (_"this panel displays raw metric rows … use a raw metric query"_).
- For metric tiles pass the `MetricType` as the builder argument — `kq.metrics("Gauge").raw()` — which auto-pins it. Use the exact `type` from `discoverMetrics()` (`Gauge | Sum | Histogram | ExponentialHistogram | Summary`); also pin `MetricName` to a real name from discover. Add a time window and `.limit(...)`.

## Required Fields

- `name` — dashboard display name
- `uiTreeVersion` — semver string, `"0.14.0"` (the SDK field; the CLI flag is `--tree-version`)
- `uiTree` — the component tree object with `root` and `elements`
- `metadata` — pass `{}` if unused

## Units

- Set `unit` on `MetricTimeSeries` and `MetricHistogram` to the raw OTEL unit from `discoverMetrics()` (e.g. `"By"`, `"s"`, `"ms"`, `"1"`, `"{requests}"`)
- The component auto-derives y-axis label, tick formatting, and tooltip display from `unit` + data range
- `yAxisLabel` is an optional override — only set when the auto-derived label isn't descriptive enough

## Layout Best Practices

- Use `Stack` with `direction: "vertical"` as root for simple dashboards
- Use `Grid` with `columns: 2` or `columns: 3` for metric grids
- Wrap data components in `Card` with a descriptive `title`
- Use `MetricStat` for KPI overview, `MetricTimeSeries` for trends
- Use `MetricHistogram` only for Histogram/ExponentialHistogram metric types
- Set `height: 600` on LogTimeline — smaller values collapse the log content to a count badge
- Set `height: 300` on MetricTimeSeries and MetricHistogram
- MetricStat does not need a height prop

## Component Compatibility

- **MetricStat** — **Sum** and **Gauge** only. Does NOT work with Histogram (shows "--").
- **MetricStat single value** — feed it a RAW metric query (the renderer reduces the raw rows itself), e.g.
  `kq.metrics("Sum").raw().where(f => f.eq("MetricName", NAME)).timeRelative("1h").limit(500).build()`
  — or legacy `method: "searchAggregatedMetrics"` with `aggregate: "sum"` (also `"avg"`/`"min"`/`"max"`/`"count"`). Do NOT group by a dimension with MetricStat (use MetricTable for grouped results).
- **MetricTimeSeries** — **Sum**, **Gauge**, and **Histogram** (renders mean over time).
- **MetricHistogram** — **Histogram** and **ExponentialHistogram** only.

Always check the metric's `type` from `discoverMetrics()`. Mismatched types render empty or show "--".

**For Histogram metrics**: use `MetricHistogram` for distribution views, or `MetricTimeSeries` for trends over time (renders mean = Sum/Count). `MetricStat` is NOT compatible with Histogram.

## Error Handling

### No metrics discovered

If `discoverMetrics()` returns an empty `metrics` array, telemetry hasn't reached Kopai yet.

1. Confirm Kopai is up and receiving — a non-empty `discoverMetrics()` (or `client.getServices()`) means it's reachable.
2. Verify the instrumented app is exporting — check app logs for OTLP export errors.
3. Wait 10-30s and retry — metrics can lag the app start.

### Dashboard creation fails validation

Wrap the create in try/catch. On `KopaiValidationError`/`KopaiError`, re-run `discoverMetrics()` to recheck names and types, fix the tree, and retry. `KopaiQueryBuildError` means the `kq` query is malformed — fix it before reassembling the tree. Common messages:

- **"Invalid metric type"** — the `kq.metrics("<Type>")` builder argument doesn't match the actual `type` from `discoverMetrics()`. Use the exact `type` value.
- **"Unknown element type"** — component type not in schema. Re-check the component schema (`npx @kopai/cli dashboards schema`).
- **"Orphan element"** — an element's `parentKey` references a non-existent key. Verify all parent-child relationships.
- **"Root key not found"** — `root` doesn't match any key in `elements`.

Do not guess — always validate against the schema and `discoverMetrics()` output.

## Post-Creation

Display the URL to the user:

```
<baseUrl>/?tab=metrics&dashboardId=<id>
```

- `<id>` — the `id` field on the returned `Dashboard`
- `<baseUrl>` — the backend URL from `.kopairc` (default `http://localhost:8000`)

Common pitfalls:

- **LogTimeline with severity filter** — avoid filtering by severity unless the user explicitly asks for error logs. Many services only emit info-level logs, so filtering to error level returns empty results. Default to showing all logs. (When error logs ARE requested, filter `SeverityNumber >= 17`: `kq.logs.raw().where(f => f.gte("SeverityNumber", 17)).timeRelative("1h").limit(100).build()`.)
- **Trace error tiles** — StatusCode value is the literal `"Error"` (also `"Unset"`/`"Ok"`); successful spans are usually `"Unset"`.
- **Percentiles** (`p50`–`p999`) are ClickHouse-only and hard-fail on SQLite at query time. Lead latency tiles with `avg`/`max` of `Duration` (nanoseconds: 1ms = 1e6, 1s = 1e9).

## CLI fallback (one-off create)

The CLI takes the tree on stdin and uses `--tree-version` (the SDK field is `uiTreeVersion`). It cannot build `kq` queries, so tiles use the legacy `searchMetricsPage`/`searchLogsPage` form:

```bash
echo '{"uiTree":{"root":"stack-1","elements":{"stack-1":{"key":"stack-1","type":"Stack","props":{"direction":"vertical","gap":"md","align":null},"children":["card-1"],"parentKey":""},"card-1":{"key":"card-1","type":"Card","props":{"title":"CPU Usage","description":null,"padding":null},"children":["ts-1"],"parentKey":"stack-1"},"ts-1":{"key":"ts-1","type":"MetricTimeSeries","props":{"height":300,"showBrush":null,"yAxisLabel":null,"unit":"1"},"children":[],"parentKey":"card-1","dataSource":{"method":"searchMetricsPage","params":{"metricType":"Gauge","metricName":"system.cpu.utilization"}}}}},"metadata":{}}' | npx @kopai/cli dashboards create --name "<name>" --tree-version "0.14.0" --json
```
