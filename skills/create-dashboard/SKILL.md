---
name: create-dashboard
description: Create observability dashboards from OTEL metrics, logs, and traces using Kopai. Use when building metric visualizations, monitoring views, KPI panels, or when the user wants to see their telemetry data in a dashboard — even if they don't say "dashboard" explicitly. Also use when other skills or workflows need to present telemetry data visually (e.g. after root cause analysis).
license: Apache-2.0
metadata:
  author: kopai
  version: "1.0.1"
---

# Create Dashboard with Kopai

## Component Schema (auto-generated)

!`npx @kopai/cli dashboards schema 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Available Metrics

!`npx @kopai/cli metrics discover --json 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Workflow

1. **Discover metrics** — `npx @kopai/cli metrics discover --json`
2. **Design tree** — build a uiTree using components from the schema above
3. **Create dashboard** — pipe JSON to `npx @kopai/cli dashboards create --name "<name>" --tree-version "0.7.0" --json`
4. **Verify** — response contains `id` (success) or `error` (failure). On error: re-run `metrics discover` to check metric names and types match the component compatibility table below, fix the tree, and retry

## Quick Example

A single-card dashboard showing CPU usage:

```bash
echo '{"uiTree":{"root":"stack-1","elements":{"stack-1":{"key":"stack-1","type":"Stack","props":{"direction":"vertical","gap":"md"},"children":["card-1"],"parentKey":""},"card-1":{"key":"card-1","type":"Card","props":{"title":"CPU Usage"},"children":["ts-1"],"parentKey":"stack-1"},"ts-1":{"key":"ts-1","type":"MetricTimeSeries","props":{"height":300,"unit":"1"},"children":[],"parentKey":"card-1","dataSource":{"method":"searchMetricsPage","params":{"metricType":"Gauge","metricName":"system.cpu.utilization"}}}}},"metadata":{}}' | npx @kopai/cli dashboards create --name "CPU Dashboard" --tree-version "0.7.0" --json
```

## Common Components

| Component        | Use for       | Compatible metric types         |
| ---------------- | ------------- | ------------------------------- |
| MetricStat       | KPI numbers   | Sum, Gauge                      |
| MetricTimeSeries | Trend charts  | Sum, Gauge, Histogram           |
| MetricHistogram  | Distributions | Histogram, ExponentialHistogram |
| LogTimeline      | Log stream    | n/a (uses searchLogsPage)       |

## Rules

- `workflow` - Dashboard creation workflow (detailed rules, tree structure, error handling)

Read `rules/<rule-name>.md` for details.
