---
name: workflow
description: Dashboard creation workflow
priority: critical
---

# Dashboard Creation Workflow

## Steps

1. **Discover metrics** — run `npx @kopai/cli metrics discover --json` to get real metric names, types, and attributes
2. **Design tree** — build a uiTree matching the component schema
3. **Create dashboard** — pipe JSON to CLI:
   ```bash
   echo '{"uiTree":<tree>,"metadata":{}}' | npx @kopai/cli dashboards create --name "<name>" --tree-version "0.7.0" --json
   ```

## Tree Structure Rules

- Every element needs: `key`, `type`, `children` array, `parentKey`, `props`
- Root element's `parentKey` is `""`
- Root key must exist in `elements`
- No orphan elements — every non-root element's `parentKey` must reference an existing element
- `children` array must list keys of child elements

## DataSource Rules

- Leaf components (hasChildren: false) can have a `dataSource`
- `dataSource.method` must match a valid SDK method (e.g. `searchMetricsPage`, `searchLogsPage`)
- `dataSource.params` must match the method's parameter schema
- `metricType` in `searchMetricsPage` params is **required** — use the type from `metrics discover` output (Gauge, Sum, Histogram, etc.)
- `metricName` should match an actual metric name from discover output

## Required Fields

- `name` — dashboard display name (passed via `--name`)
- `uiTreeVersion` — semver string (passed via `--tree-version`)
- `uiTree` — the component tree object with `root` and `elements` (in stdin JSON)

## Units

- Set `unit` on `MetricTimeSeries` and `MetricHistogram` to the raw OTEL unit from `metrics discover` (e.g. `"By"`, `"s"`, `"ms"`, `"1"`, `"{requests}"`)
- The component auto-derives: y-axis label, tick formatting, and tooltip display from `unit` + data range
- `yAxisLabel` is an optional override — only set it when the auto-derived label is not descriptive enough

## Layout Best Practices

- Use `Stack` with `direction: "vertical"` as root for simple dashboards
- Use `Grid` with `columns: 2` or `columns: 3` for metric grids
- Wrap data components in `Card` with descriptive `title`
- Use `MetricStat` for KPI overview, `MetricTimeSeries` for trends
- Use `MetricHistogram` only for Histogram/ExponentialHistogram metric types
- Set `height: 600` on LogTimeline — smaller values collapse the log content and only show a count badge
- Set `height: 300` on MetricTimeSeries and MetricHistogram
- MetricStat does not need a height prop

## Component Compatibility

- **MetricStat** — works with **Sum** and **Gauge** only. Does NOT work with Histogram (shows "--")
- **MetricTimeSeries** — works with **Sum** and **Gauge** only. Histogram causes internal server errors
- **MetricHistogram** — works with **Histogram** and **ExponentialHistogram** only

When choosing components, always check the metric's `type` from `metrics discover` output. Mismatched types render empty or show "--".

**For Histogram metrics**: use `MetricHistogram` for distribution views, or `MetricStat` is NOT compatible. If you need a time-series trend for a Histogram metric, use `MetricHistogram` — do NOT use `MetricTimeSeries`.

## Example Creation

```bash
echo '{"uiTree":{"root":"stack-1","elements":{"stack-1":{"key":"stack-1","type":"Stack","props":{"direction":"vertical","gap":"md","align":null},"children":["card-1"],"parentKey":""},"card-1":{"key":"card-1","type":"Card","props":{"title":"CPU Usage","description":null,"padding":null},"children":["ts-1"],"parentKey":"stack-1"},"ts-1":{"key":"ts-1","type":"MetricTimeSeries","props":{"height":300,"showBrush":null,"yAxisLabel":null,"unit":"1"},"children":[],"parentKey":"card-1","dataSource":{"method":"searchMetricsPage","params":{"metricType":"Gauge","metricName":"system.cpu.utilization"}}}}},"metadata":{}}' | npx @kopai/cli dashboards create --name "CPU Dashboard" --tree-version "0.7.0" --json
```

## Error Handling

### No metrics discovered

If `metrics discover` returns an empty array, telemetry data hasn't reached Kopai yet.

1. Check Kopai is running: `npx @kopai/cli metrics discover --json` — if this returns data, Kopai is up and receiving telemetry
2. Verify the instrumented app is sending data — check app logs for OTLP export errors
3. Wait 10-30 seconds and retry — metrics may take time to appear after app starts

### Dashboard creation fails validation

The CLI returns a JSON error with a `message` field describing what's wrong. Common issues:

- **"Invalid metric type"** — `metricType` doesn't match the actual type from `metrics discover`. Re-run discover and use the exact `type` value
- **"Unknown element type"** — component type not in schema. Re-check `dashboards schema` output
- **"Orphan element"** — an element's `parentKey` references a non-existent key. Verify all parent-child relationships
- **"Root key not found"** — `root` value doesn't match any key in `elements`

When creation fails, read the error message, fix the tree, and retry. Do not guess — always validate against the schema and discover output.

## Post-Creation

After the dashboard is created, display the URL to the user:

```
<baseUrl>/?tab=metrics&dashboardId=<id>
```

- `<id>` — the `id` field from the CLI JSON response
- `<baseUrl>` — the URL used for the CLI command: the `--url` flag value, or `http://localhost:8000` if omitted

Common pitfalls:

- **LogTimeline with severity filter** — avoid `severityNumberMin` unless the user explicitly asks for error logs. Many services only emit info-level logs, so filtering to ERROR+ returns empty results. Default to showing all logs.
