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

## p95 latency from a histogram metric

When latency arrives as an OTel histogram (e.g. `http.server.request.duration`) rather than as spans, merge its buckets with `HISTOGRAM_QUANTILE`. Never take `P95` of the histogram's `Sum` or `Count`: each row is a batch, not a request, and the query is refused.

```json
{
  "signal": "metrics",
  "mode": "aggregate",
  "measures": [{ "op": "HISTOGRAM_QUANTILE", "quantile": 0.95, "as": "p95" }],
  "dimensions": ["service.name"],
  "filters": [
    { "column": "MetricType", "op": "eq", "value": "Histogram" },
    {
      "column": "MetricName",
      "op": "eq",
      "value": "http.server.request.duration"
    }
  ],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

Each row also carries `p95_low`, `p95_high`, `p95_coarsened` and `p95_error`. Chart and label only `p95`, in the metric's unit ("p95 ≈ 430 ms"); the other keys are for you. A non-null `p95_error` means that group has no honest value: `"mixed_units"` (filter to one `MetricUnit`) or `"no_shared_bounds"` (split by series). Leave the gap rather than plotting a number.

## Request rate from a histogram

A histogram's `Count` is a request counter. `RATE` turns it into requests per second, handling cumulative data and restarts:

```json
"measures": [{ "op": "RATE", "column": "Count", "as": "requests_per_second" }]
```

Use the histogram filters from the recipe above. `HISTOGRAM_AVG` (no column) gives the mean latency over the same rows.

## Counter rate

For a `Sum` metric that only goes up (requests, errors, bytes sent), `RATE` needs the `IsMonotonic` filter; without it the query is refused, because an up-down counter's real drops would read as restarts:

```json
{
  "signal": "metrics",
  "mode": "aggregate",
  "measures": [{ "op": "RATE", "column": "Value", "as": "per_second" }],
  "filters": [
    { "column": "MetricType", "op": "eq", "value": "Sum" },
    { "column": "MetricName", "op": "eq", "value": "http.server.errors" },
    { "column": "IsMonotonic", "op": "eq", "value": true }
  ],
  "timeDimension": { "type": "relative", "lookback": "1h" },
  "output": { "type": "timeSeries", "granularity": "5m" },
  "limit": 500
}
```

`INCREASE` gives the total over each bucket instead of a rate. For an up-down counter (`IsMonotonic` false: queue depth, active connections) chart `AVG` or `MAX` of `Value`.

**On SQLite** these ops are refused like percentiles: _"Distribution and counter measures (HISTOGRAM_QUANTILE, …) are supported on the ClickHouse backend only."_ Say so; don't substitute an average of `Sum`.

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
