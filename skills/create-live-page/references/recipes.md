# Live page recipes

Each recipe is the `query` input a page embeds, written for the last hour at `5m`. Adjust the window and granularity together: the window divided by the granularity, times the number of groups, must stay under the aggregate cap in the `query` tool's schema.

## p95 latency by route

```json
{
  "signal": "traces",
  "mode": "aggregate",
  "measures": [{ "op": "P95", "column": "Duration", "as": "p95_duration" }],
  "dimensions": ["http.route"],
  "filters": [{ "column": "http.route", "op": "isNotNull" }],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

`Duration` is in nanoseconds; divide by 1e6 to label the axis in ms. Swap `P95` for `P50`, `P99` or `P999` as asked. More routes than the cap allows? Rank first, as in the worked example, with `P95` as the ordered measure.

**When `P95` is refused.** Percentiles run on the ClickHouse backend only; a SQLite backend (a bare local `@kopai/app`) answers `invalid_input` with _"Percentile measures (P50-P999) are not yet supported on the sqlite backend."_ Chart the nearest honest measures instead and label them as what they are, never as p95:

```json
"measures": [
  { "op": "AVG", "column": "Duration", "as": "avg_duration" },
  { "op": "MAX", "column": "Duration", "as": "max_duration" }
]
```

## Log volume by severity

```json
{
  "signal": "logs",
  "mode": "aggregate",
  "measures": [{ "op": "COUNT", "as": "log_count" }],
  "dimensions": ["SeverityText"],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

## One metric series

```json
{
  "signal": "metrics",
  "mode": "aggregate",
  "measures": [{ "op": "AVG", "column": "Value", "as": "value" }],
  "filters": [
    { "column": "MetricName", "op": "eq", "value": "system.cpu.utilization" },
    { "column": "MetricType", "op": "eq", "value": "Gauge" }
  ],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

Take `MetricName`, `MetricType` and the unit from `metrics_discover`. `Value` exists on `Gauge` and `Sum` only, and needs the `MetricType` filter beside it; the schema's metric column description names the columns each other type carries. Group by an attribute key from discovery to split the series.

## Error rate for a fixed set of services (one call)

For a small workspace, or when the user names the services, skip the rank and chart directly. Every service in the window becomes a group, so this outgrows its query past roughly 38 services at `5m` over an hour; prefer the worked example's two calls when the count is unknown.

```json
{
  "signal": "traces",
  "mode": "aggregate",
  "measures": [{ "op": "ERROR_RATE", "as": "error_rate" }],
  "dimensions": ["service.name"],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

Add `{ "column": "service.name", "op": "in", "values": [...] }` to `filters` when the user named the services.
