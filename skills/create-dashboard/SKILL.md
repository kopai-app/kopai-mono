---
name: create-dashboard
description: Build Kopai observability dashboards from OpenTelemetry metrics, logs, and traces by composing tiles — time-series charts, stat/KPI numbers, histograms, log timelines, and trace-detail views — into a dashboard via the Kopai SDK. Use this skill whenever the user wants to visualize, chart, monitor, or 'keep an eye on' telemetry — e.g. 'make a dashboard', 'monitoring view', 'KPI panel', 'chart request latency and throughput', 'an incident board with error logs and a trace viewer' — even if they don't say the word 'dashboard' — and when another workflow needs to present telemetry visually (e.g. after a root-cause analysis). This creates Kopai dashboards specifically. Do NOT use it to investigate or root-cause an issue (use root-cause-analysis), to add instrumentation (use otel-instrumentation), to build Grafana/Prometheus dashboards, or to code React/UI chart components.
license: Apache-2.0
metadata:
  author: kopai
  version: "1.4.1"
---

# Create Dashboard with Kopai

Build a dashboard by writing a short TypeScript script: design a `uiTree`, feed each
data tile with a type-safe `kq` query, and create it via `client.createDashboard(...)`.
The CLI stays as a fallback for one-off creates.

## Component Schema (auto-generated)

!`npx @kopai/cli dashboards schema 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Available Metrics

!`npx @kopai/cli metrics discover --json 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Code mode (recommended)

**Connect** — `clientFromConfig()` reads `.kopairc` just like the CLI:

```ts
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig(); // ./.kopairc → ~/.kopairc → http://localhost:8000
```

**Run** — `npx tsx dashboard.mts`. Use **`.mts`** so top-level `await` works regardless
of the project's module type. Requires `@kopai/sdk` installed (`npm i @kopai/sdk`).

**Output** — `console.log(dash.id)` so the new dashboard id lands on stdout. Wrap the
build + create in try/catch.

**Typed results** — `discoverMetrics()` and `client.query(q)` return fully typed values
(metric `name`/`type`/`unit`, aggregate measure values as `number`, etc.). When you
probe/verify data, iterate the results directly — **don't cast to `any`/`any[]`**.

## Two rules that will save you a broken dashboard

1. **Feed data tiles with a RAW query** — `kq.metrics("<Type>").raw()…build()`, not `.aggregate()`.
   The tile renderers (MetricStat/MetricTimeSeries/MetricHistogram/MetricTable, LogTimeline,
   TraceDetail) plot **raw rows**; an aggregate/`summary`/`timeSeries` query is rejected
   at render with _"this panel displays raw metric rows … use a raw metric query"_. Choose the
   `MetricType` up front via `kq.metrics("Gauge")` (auto-pinned), add a `MetricName` filter and
   a time window on metric tiles.
2. **Set every declared prop — use `null` for unused ones.** The render-time schema
   requires nullable props to be _present_, not omitted. Omitting them passes
   `createDashboard` but fails at render with _"invalid layout: …props.description:
   expected string, received undefined"_. So a Card is `{ title, description: null,
padding: null }`, a MetricTimeSeries is `{ height, showBrush: null, yAxisLabel: null,
unit }`, etc.

## Backend caveats

- **Every tile query needs a time window** — `.timeRelative("1h")` / `.timeAbsolute(startISO, endISO)`.
- **Choose the `MetricType` up front via `kq.metrics("Gauge")`** — it's auto-pinned, no manual `.where("MetricType", …)` needed. Use the type from `discoverMetrics()`. Types: `Gauge | Sum | Histogram | ExponentialHistogram | Summary`.
- The SDK field is **`uiTreeVersion`** (the CLI flag is `--tree-version`). Current tree version: **`0.14.0`**.

## Workflow

1. **Discover metrics** — `const { metrics } = await client.discoverMetrics();` Each entry
   is `{ name, type, unit, description, attributes, resourceAttributes }`. Pass the metric's
   `type` to `kq.metrics("<Type>")`, and set the tile `unit` prop from `unit`.
2. **Build each tile's query with `kq.metrics("<Type>").raw()`** (or `kq.logs.raw()` /
   `kq.traces.raw()`) — returns a `KopaiQuery` object; hold it in a variable.
3. **Assemble the `uiTree`** — embed the built query into the tile:
   `dataSource: { method: "query", params: <builtQuery> }`. Set every prop (null for unused).
4. **Create** —
   ```ts
   const dash = await client.createDashboard({
     name: "<name>",
     uiTreeVersion: "0.14.0",
     uiTree,
     metadata: {},
   });
   console.log(dash.id);
   ```
   On a `KopaiValidationError`/`KopaiError`, re-run `discoverMetrics()` to recheck names
   and types, fix the tree, and retry.
5. **View** — open `<baseUrl>/?tab=metrics&dashboardId=<dash.id>`.

## Quick Example

```ts
// create-cpu-dashboard.mts — run: npx tsx create-cpu-dashboard.mts
import { kq } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

// Tile data: a RAW metric query (tiles render raw rows, not aggregates).
const cpuSeries = kq
  .metrics("Gauge") // MetricType chosen up front, auto-pinned
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
      props: { height: 300, showBrush: null, yAxisLabel: null, unit: "1" },
      children: [],
      parentKey: "card-1",
      dataSource: { method: "query", params: cpuSeries },
    },
  },
};

const dash = await client.createDashboard({
  name: "CPU Dashboard",
  uiTreeVersion: "0.14.0",
  uiTree,
  metadata: {},
});
console.log(`Created dashboard ${dash.id}`);
```

## Components

Layout (have children, no `dataSource`): **Stack**, **Grid**, **Card**. Static:
**Heading**, **Text**, **Badge**, **Divider**, **Empty**.

Data tiles — feed each with a **raw** `kq` query via `method: "query"` (legacy methods
still work, listed for fallback):

| Component        | Best for        | Metric types                    | dataSource methods                                      | `kq` params example (RAW)                                                                               |
| ---------------- | --------------- | ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| MetricStat       | KPI number      | Sum, Gauge                      | `searchMetricsPage`, `searchAggregatedMetrics`, `query` | `kq.metrics("Sum").raw().where(f=>f.eq("MetricName",NAME)).timeRelative("1h").limit(500).build()`       |
| MetricTimeSeries | Trend chart     | Sum, Gauge, Histogram           | `searchMetricsPage`, `query`                            | `kq.metrics("Gauge").raw().where(f=>f.eq("MetricName",NAME)).timeRelative("1h").limit(500).build()`     |
| MetricHistogram  | Distribution    | Histogram, ExponentialHistogram | `searchMetricsPage`, `query`                            | `kq.metrics("Histogram").raw().where(f=>f.eq("MetricName",NAME)).timeRelative("1h").limit(500).build()` |
| MetricTable      | Tabular         | any                             | `searchMetricsPage`, `query`                            | `kq.metrics("Gauge").raw().where(f=>f.eq("MetricName",NAME)).timeRelative("1h").limit(500).build()`     |
| LogTimeline      | Log stream      | n/a                             | `searchLogsPage`, `query`                               | `kq.logs.raw().where(f=>f.gte("SeverityNumber",17)).timeRelative("1h").limit(100).build()`              |
| TraceDetail      | Trace inspector | n/a                             | `searchTracesPage`, `searchTraceSummariesPage`, `query` | `kq.traces.raw().where(f=>f.eq("StatusCode","Error")).timeRelative("1h").limit(50).build()`             |

Sizing/props: set `height: 300` on MetricTimeSeries/MetricHistogram, `height: 600` on
LogTimeline (smaller collapses it to a count badge); MetricStat needs no height. Set
`unit` on chart tiles to the metric's raw OTEL unit (`"By"`, `"s"`, `"ms"`, `"1"`). And
remember rule #2: every declared prop must be present (null for unused).

## Rules

- `workflow` - Dashboard creation workflow (tree structure, dataSource rules, layout, error handling)

Read `rules/<rule-name>.md` for details.

## CLI fallback (one-off create)

The CLI takes the tree on stdin and uses `--tree-version` (the SDK field is `uiTreeVersion`).
It cannot build `kq` queries, so tiles use the legacy `searchMetricsPage`/`searchLogsPage` form:

```bash
echo '{"uiTree":{…},"metadata":{}}' | npx @kopai/cli dashboards create --name "<name>" --tree-version "0.14.0" --json
```
