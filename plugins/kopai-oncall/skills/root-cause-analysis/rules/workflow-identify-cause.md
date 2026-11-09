| title                                          | impact   | tags                                  |
| ---------------------------------------------- | -------- | ------------------------------------- |
| Step 5: Identify Root Cause & Present Findings | CRITICAL | workflow, synthesis, dashboard, step5 |

## Step 5: Identify Root Cause & Present Findings

**Impact:** CRITICAL

Final step in RCA — synthesize the data you gathered in steps 1-4, present the
analysis, then offer an incident dashboard. This step is mostly synthesis: little
querying, except to build the dashboard tiles in 5c.

### 5a. Synthesize Findings

Combine evidence from the previous steps into a coherent narrative:

1. **Timeline** — establish the sequence of events using timestamps from traces and logs.
2. **Blast radius** — which services are affected? Use the `service.name` grouping from your error-rate aggregate.
3. **Root vs symptoms** — distinguish the originating failure from cascading effects. The earliest error in the trace chain is usually closest to root cause.
4. **Evidence chain** — link specific `TraceId`s, `SpanId`s, log entries, and metric deltas that support the conclusion.

### 5b. Present Analysis

Present the root cause analysis to the user with:

- **Summary** — one-sentence root cause statement.
- **Evidence** — the specific traces, logs, and metrics that support it.
- **Impact** — which services/endpoints are affected and how.
- **Suggested fix** — actionable next steps based on the findings.

### 5c. Create Incident Dashboard (code mode)

Use the **create-dashboard** skill's code mode: build each tile's data query with
`kq`, embed it via `dataSource: { method: "query", params: <builtQuery> }`, and ship
the tree with `client.createDashboard(...)`. The dashboard lets the user visually
verify the hypothesis and explore the data themselves, and is a sharable artifact of
the investigation.

Include three evidence tiles:

1. **The anomaly** — `MetricTimeSeries` (trend) or `MetricStat` (KPI) for the metric that spiked during the incident (error rate, latency, resource exhaustion). Build the tile query with `kq.metrics("<Type>").raw()` (metric tiles render raw `Value` rows; the builder arg auto-pins the `MetricType`).
2. **Affected logs** — `LogTimeline` fed by error-level logs (`SeverityNumber >= 17`), scoped to the affected service.
3. **Representative trace** — `TraceDetail` for one error trace from the incident.

```ts
// incident-dashboard.mts — run: npx tsx incident-dashboard.mts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

const SERVICE = "checkout"; // affected service from your blast-radius analysis
const TRACE_ID = "<representative error traceId>";

try {
  // 1. Anomaly — Gauge metric that spiked (use discoverMetrics() for name/type/unit).
  // Metric tiles render raw rows, so build with kq.metrics("Type").raw() (not .aggregate()).
  const anomaly = kq
    .metrics("Gauge") // MetricType is the builder arg — auto-pins it; no manual filter needed.
    .raw()
    .where((f) => f.eq("MetricName", "process.runtime.memory"))
    .where((f) => f.eq("service.name", SERVICE))
    .timeRelative("3h")
    .limit(1000)
    .build();

  // 2. Error-level logs for the affected service.
  const errorLogs = kq.logs
    .raw()
    .where((f) => f.gte("SeverityNumber", 17)) // ERROR/FATAL regardless of text casing
    .where((f) => f.eq("service.name", SERVICE))
    .timeRelative("3h")
    .limit(100)
    .build();

  // 3. One representative error trace.
  const errorTrace = kq.traces
    .raw()
    .where((f) => f.eq("TraceId", TRACE_ID))
    .timeRelative("3h")
    .limit(50)
    .build();

  const uiTree = {
    root: "stack-1",
    elements: {
      // Set every declared prop — null for unused ones, or the renderer rejects the layout.
      "stack-1": {
        key: "stack-1",
        type: "Stack",
        props: { direction: "vertical", gap: "md", align: null },
        children: ["card-1", "card-2", "card-3"],
        parentKey: "",
      },
      "card-1": {
        key: "card-1",
        type: "Card",
        props: { title: "Anomaly — memory", description: null, padding: null },
        children: ["ts-1"],
        parentKey: "stack-1",
      },
      "ts-1": {
        key: "ts-1",
        type: "MetricTimeSeries",
        props: { height: 300, showBrush: null, yAxisLabel: null, unit: "By" },
        children: [],
        parentKey: "card-1",
        dataSource: { method: "query", params: anomaly },
      },
      "card-2": {
        key: "card-2",
        type: "Card",
        props: {
          title: `Errors — ${SERVICE}`,
          description: null,
          padding: null,
        },
        children: ["logs-1"],
        parentKey: "stack-1",
      },
      "logs-1": {
        key: "logs-1",
        type: "LogTimeline",
        props: { height: 600 },
        children: [],
        parentKey: "card-2",
        dataSource: { method: "query", params: errorLogs },
      },
      "card-3": {
        key: "card-3",
        type: "Card",
        props: {
          title: "Representative error trace",
          description: null,
          padding: null,
        },
        children: ["trace-1"],
        parentKey: "stack-1",
      },
      "trace-1": {
        key: "trace-1",
        type: "TraceDetail",
        props: { height: 400 },
        children: [],
        parentKey: "card-3",
        dataSource: { method: "query", params: errorTrace },
      },
    },
  };

  const dash = await client.createDashboard({
    name: `Incident — ${SERVICE}`,
    uiTreeVersion: "0.14.0",
    uiTree,
    metadata: {},
  });
  console.log(dash.id);
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

Run with `npx tsx incident-dashboard.mts` (the `.mts` extension keeps top-level
`await` working regardless of the host project's module type). On a
`KopaiValidationError`/`KopaiError`, re-run `client.discoverMetrics()` to recheck
metric names/types, fix the tree, and retry. See the **create-dashboard** skill for
the full tile catalog, sizing, and tree rules.

After creation, present the link to the user:

```
<baseUrl>/?tab=metrics&dashboardId=<id>
```

Where `<id>` is `dash.id` and `<baseUrl>` is your `.kopairc` URL (default
`http://localhost:8000`).

### Why create a dashboard?

The script output gives you the data to analyze, but the user needs to visually review
and validate the findings. A dashboard with the relevant signals side-by-side makes it
easy to spot patterns, confirm the timeline, and decide on next actions. It also serves
as a persistent, sharable artifact of the investigation.

## CLI fallback (one-off)

The CLI cannot build `kq` queries or aggregate, so a CLI-created dashboard uses the
legacy `searchLogsPage`/`searchMetricsPage` tile form and `--tree-version` (the SDK
field is `uiTreeVersion`). For a quick create:

```bash
echo '{"uiTree":{…},"metadata":{}}' | npx @kopai/cli dashboards create --name "Incident" --tree-version "0.14.0" --json
```
