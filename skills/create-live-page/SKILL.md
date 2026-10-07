---
name: create-live-page
description: 'Live page: a page in Claude that charts Kopai telemetry through the viewer''s Kopai connector, refreshing as they watch. Use when the Kopai connector is attached and the user wants to watch, chart or keep an eye on traces, logs or metrics, even if they never say "live page". For a dashboard inside the Kopai UI, use create-dashboard.'
license: Apache-2.0
metadata:
  author: kopai
  version: "1.0.0"
---

# Create a live page with Kopai

A **live page** is a Claude artifact whose data arrives through the Kopai connector each time someone views it. The page holds queries, never data: each viewer's own Kopai connection runs them.

The runtime API (`claude.use("mcp")`, `watchTool`, error codes, caching, polling floor) belongs to the `artifact-capabilities` skill and its `mcp.d.ts` for the current contract. Load it before step 5 and take every API detail from there. This skill adds only what is specific to Kopai.

## Workflow

### 1. Check the connector

Look for the **account connector** named exactly `Kopai`: in Claude Code its tools appear as `mcp__claude_ai_Kopai__query`. A published page reaches only account connectors, by display name, so the exact name is what every viewer's page will ask for.

Done when one of these holds:

- **`Kopai` is attached**: continue; the page is publishable.
- **A near-match is attached** (`kopai`, `Kopai (2)`, `kopai-local`, …): build if you like, then refuse to publish. Tell the user: _"Found the connector `<name>`. Live pages reach Kopai only by the exact name `Kopai`; rename it at <https://claude.ai/customize/connectors> and run this again."_
- **Kopai is only a server configured in Claude Code** (its tools lack the `claude_ai_` prefix) **or absent**: its tools may feed steps 2–4, then refuse to publish. Tell the user: _"A published page can call only connectors on your claude.ai account, and Kopai isn't one. Add it, named exactly `Kopai`: <https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Kopai&connectorUrl=https%3A%2F%2Fapi.kopai.app%2Fv2%2Fmcp>. A static snapshot with the values written into the page is a different kind of page (an evidence page), not a live one."_

### 2. Discover metrics (metric requests only)

Traces and logs need no discovery: their columns are enums in the `query` tool's schema. For a metric, call `metrics_discover` for its name, type, unit and attribute keys.

If discovery answers `result_too_large`, take the name from the user's request or the OpenTelemetry semantic conventions (`http.server.request.duration`) and confirm it in step 4; ask the user only if that query comes back empty.

Done when every metric the page charts has a confirmed name and `MetricType`.

### 3. Write the queries

Start from the worked example below or a recipe in [`references/recipes.md`](references/recipes.md) (latency percentiles, log volume, one metric series, a fixed set of services). Write each as KopaiQuery JSON against the `query` tool's schema, which owns the row caps and field rules. Call `query`; on `invalid_input`, repair from the result's `issues` and call again.

Every page query is **aggregate**: a `timeSeries` for a chart, a `summary` for a single number. The page draws its own chart, so raw rows only cost size. A grouped chart is two calls: rank with a `summary`, then chart those groups with `in`.

Choose `granularity` once, here, so the window divided by it, times the number of groups, stays under the aggregate cap: an hour at `5m` is 13 buckets. A page cannot repair its own query later.

Done when every query returns `ok` from `query`.

### 4. Observe one real response per declared tool

Call each tool the page will call, through the `Kopai` connector, exactly as the page will. Learn the payload shape from it: `{ data: [{ bucket_start, <dimensions>, <measure aliases> }] }`.

Done when every page query answers `ok`, and every query whose chart must hold data returns at least one row. There, zero rows means a wrong metric name, filter value or window: fix it in step 3, never publish an empty chart. Zero rows is a real answer only where the page renders it as a state, such as the worked example's rank with no errors; then observe the chart query in its unfiltered one-call form to learn its shape. The observed values are the user's real data: use them to learn the shape and keep them out of the page.

### 5. Build the page

- **Capability**: declare `mcp` with `{ server: "Kopai", tools: [...] }` listing exactly the tools the page's code calls, usually `["query"]`. A later edit that adds a call adds its tool in the same republish.
- **Reads**: one `watchTool("Kopai", "query", { query }, handler, { refetchInterval })` per query, with `refetchInterval` equal to the query's `granularity` in milliseconds (`5m` → `300000`). Polling faster than the buckets change returns the same rows.
- **Freshness**: a "last updated" line driven by `result.cache.storedAt`.
- **Messages**: give each state below its own message in the section it affects, naming the connector `Kopai` in code formatting.
- **Viewers**: one line on the page saying each viewer needs their own Kopai connection, linked to <https://kopai.app/connect-ai-assistants>.

- **`server_not_connected`**: This page reads live data through the `Kopai` connector. Add it to your claude.ai account, named exactly `Kopai`: [link]
- **`not_granted`**: You declined access to `Kopai` for this page, so its live sections stay empty. Reload to be asked again.
- **`blocked_by_policy`**: Your organization blocks the `Kopai` connector on pages. An admin can allow it.
- **`needs_reauth`**: Your `Kopai` connection has expired. Reconnect it at <https://claude.ai/customize/connectors>, then reload.
- **`tool_error` with `error.result.structuredContent.error === "result_too_large"`**: This view outgrew its query. Show this state in place of the chart; never draw a partial one, and drop the last-good rows for the section.
- **Any other code**: the runtime's generic degraded state from `artifact-capabilities`, keeping last-good data.

`[link]` is <https://kopai.app/connect-ai-assistants>.

Done when every query has a watch, every state in the list has its message, and no observed value appears in the page source.

### 6. Publish

Publish only when step 1 found `Kopai`. Done when the publish result names the display name `Kopai` for the declared server and you have told the user that each viewer needs their own Kopai connection.

## Worked example: error rate by service, last hour

Two calls: rank the services producing the most errors, then chart the error rate of those ten. Ranking by error count keeps a service with one failed span from topping the chart.

**Rank** (a `summary`, re-run on the same interval):

```json
{
  "signal": "traces",
  "mode": "aggregate",
  "measures": [{ "op": "COUNT", "as": "error_count" }],
  "dimensions": ["service.name"],
  "filters": [{ "column": "StatusCode", "op": "eq", "value": "Error" }],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "orderBy": [
    { "type": "measure", "alias": "error_count", "direction": "desc" }
  ],
  "output": { "type": "summary" },
  "limit": 10
}
```

**Chart** (a `timeSeries` filtered to the ranked names):

```json
{
  "signal": "traces",
  "mode": "aggregate",
  "measures": [{ "op": "ERROR_RATE", "as": "error_rate" }],
  "dimensions": ["service.name"],
  "filters": [
    {
      "column": "service.name",
      "op": "in",
      "values": ["<names from the rank>"]
    }
  ],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

In the page, the rank watch drives the chart watch: when the set of ranked names changes, unsubscribe the chart watch and register it again with the new `values`. With no ranked names, show "No errors in the last hour" and register no chart watch. `error_rate` is a fraction in [0, 1].

```js
const mcp = await claude.use("mcp");
const every = 300000; // matches granularity "5m"
let chartNames = "";
let stopChart = () => {};

watchSection("Kopai", "query", { query: RANK }, every, (rows) => {
  const names = rows.map((r) => r["service.name"]);
  if (names.join() === chartNames) return;
  chartNames = names.join();
  stopChart();
  if (names.length === 0) return renderNoErrors();
  const chart = {
    ...CHART,
    filters: [{ column: "service.name", op: "in", values: names }],
  };
  stopChart = watchSection(
    "Kopai",
    "query",
    { query: chart },
    every,
    renderChart
  );
});
```

`watchSection` is the page's own wrapper around `mcp.watchTool`: it reads `result.payload.data`, updates the section's "last updated" from `result.cache?.storedAt`, routes error events to the messages above, and returns the unsubscribe function.
