# Metric query reference

Columns, filters, and measures for `kq.metrics("<Type>").aggregate()` / `kq.metrics("<Type>").raw()`
(and the `client.searchMetrics(...)` / `client.discoverMetrics()` shapes). Run a built query with
`client.query(q)` (fully typed: returns `{ data }` for aggregate, `{ data, nextCursor }` for raw).

> Dashboard tiles render **raw** rows: when feeding a metric tile via `dataSource:{method:"query"}`,
> build it with `kq.metrics("<Type>").raw()` (not `.aggregate()`) — see the `create-dashboard` skill.

## Discover first

`const { metrics } = await client.discoverMetrics();` — each entry is
`{ name, type, unit, description, attributes, resourceAttributes }`. Use it to pick a
metric's exact `name` and `type` before querying.

## Choose the MetricType (builder arg)

Choose the `MetricType` as the builder argument: `kq.metrics("Gauge")…` auto-pins it (type
∈ `"Gauge"` | `"Sum"` | `"Histogram"` | `"ExponentialHistogram"` | `"Summary"`). No manual
`MetricType` filter is needed. Value columns are typed per type, since each type stores its
value in different structural columns.

```ts
kq.metrics("Gauge") // auto-pins MetricType: "Gauge"
  .aggregate()
  .where((f) => f.eq("MetricName", "system.cpu.utilization"));
```

| Type                   | Value column(s)                                                | Use case                                  |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `Gauge`                | `Value`                                                        | Point-in-time: CPU, memory, connections   |
| `Sum`                  | `Value`                                                        | Cumulative counters: request/error counts |
| `Histogram`            | `Count`, `Sum`, `Min`, `Max`, `BucketCounts`, `ExplicitBounds` | Latency distributions                     |
| `ExponentialHistogram` | `Count`, `Sum`, `Positive/NegativeBucketCounts`, …             | Distributions                             |
| `Summary`              | `Count`, `Sum`, `ValueAtQuantiles.*`                           | Pre-computed quantiles                    |

For Gauge, aggregate over `Value` (`avg`/`max`). For a counter (Sum) or a Histogram, use the
distribution and counter measures below: `avg`/`p95` of a counter's `Value` or a histogram's
`Sum`/`Count` mean nothing. On a histogram's `Sum`/`Count` they are refused; on a counter's
`Value` they are accepted, so do not reach for them.

## Structural columns

`MetricName`, `MetricType`, `MetricUnit`, `MetricDescription`, `TimeUnix`,
`StartTimeUnix`, `Value`, `Count`, `Sum`, `Min`, `Max`, `BucketCounts`, `ExplicitBounds`,
`ScopeName`, `ScopeVersion`. Containers for metric attributes: **`Attributes`**
(data-point), **`ResourceAttributes`**, **`ScopeAttributes`**.

## Example

```ts
// avg CPU by host over the last hour, bucketed every minute
kq.metrics("Gauge")
  .aggregate()
  .measure((m) => m.avg("Value", "avg_cpu"))
  .where((f) => f.eq("MetricName", "system.cpu.utilization"))
  .dimension("host.name")
  .timeRelative("1h")
  .timeSeries("1m")
  .build();
```

Percentiles (`p50`–`p999`) are **ClickHouse-only**; on SQLite use `avg`/`max`.

## Counters, histograms and summaries

Each method exists only on the builder for its type, and each handles cumulative and delta
data, restarts and staleness markers. All are **ClickHouse-only**.

| Builder                   | Method                            | Gives                                        |
| ------------------------- | --------------------------------- | -------------------------------------------- |
| `kq.metrics("Sum")`       | `rate("Value", a)`, `increase(…)` | Per-second rate / total growth of a counter  |
| `kq.metrics("Histogram")` | `histogramQuantile(0.95, a)`      | p95 from merged buckets                      |
| `kq.metrics("Histogram")` | `histogramAvg(a)`                 | Mean observation (Δ`Sum` ÷ Δ`Count`)         |
| `kq.metrics("Histogram")` | `rate("Count", a)`, `increase(…)` | Requests per second / requests in the window |
| `kq.metrics("Summary")`   | `summaryQuantile(0.99, a)`        | Highest per-instance pre-computed quantile   |

```ts
// error rate from a monotonic counter: the IsMonotonic filter is required
kq.metrics("Sum")
  .aggregate()
  .where((f) => f.eq("MetricName", "http.server.errors"))
  .where((f) => f.eq("IsMonotonic", true))
  .measure((m) => m.rate("Value", "errors_per_s"))
  .timeRelative("1h")
  .timeSeries("1m")
  .build();

// p95 latency from a histogram, per service
kq.metrics("Histogram")
  .aggregate()
  .where((f) => f.eq("MetricName", "http.server.request.duration"))
  .measure((m) => m.histogramQuantile(0.95, "p95"))
  .dimension("service.name")
  .timeRelative("1h")
  .timeSeries("5m")
  .build();
```

- Values are `number | null`, and null is never zero. What a null means depends on the
  measure:
  - `histogramQuantile`/`histogramAvg`: read `<alias>_error` first; a non-null code means
    the group has no honest value (below). With no error, nothing was observed.
  - `summaryQuantile` (no `_error` key): no instance's latest point reports that quantile;
    try another quantile before concluding there is no data.
  - `increase`/`rate` (no `_error` key): nothing was observed.
- `histogramQuantile` rows also carry `<alias>_low`/`_high` (the bucket the true value lies
  in), `_coarsened` and `_error`. **Report only the value to people** ("p95 ≈ 430 ms"); use
  the range yourself as the uncertainty around the value: the value is interpolated inside
  the bucket, so a move that stays inside one range is weak evidence. Confirm it elsewhere
  (e.g. trace latency) before calling it a regression, but don't discard it. When `_high` is
  null the value is only the lower bound of the open-ended last bucket: say "p95 > 430 ms".
  When `_low` is null, say "p95 ≤ 430 ms".
- `_error` `"mixed_units"`: filter to one `MetricUnit`. `"no_shared_bounds"`: the series'
  bucket layouts cannot be merged; group by a series attribute. `"malformed_buckets"`: an
  exporter sent bucket counts that do not fit the bounds; find and filter out that series.
- Next to these measures, filter only on series-level columns (`MetricName`, `MetricUnit`,
  `ScopeName`, `ScopeVersion`, `IsMonotonic`, attributes), and group by time with
  `.timeSeries()`, not by `TimeUnix`.

## CLI fallback (quick lookups)

| Filter                     | Flag          | Example                             |
| -------------------------- | ------------- | ----------------------------------- |
| Type (required)            | `--type`      | `--type Gauge`                      |
| Name                       | `--name`      | `--name system.cpu.utilization`     |
| Service                    | `--service`   | `--service payment`                 |
| Attribute                  | `--attr`      | `--attr "host.name=web-1"`          |
| Aggregate (Gauge/Sum only) | `--aggregate` | `--aggregate sum`                   |
| Group by                   | `--group-by`  | `--group-by host.name` (repeatable) |

```bash
npx @kopai/cli metrics discover --json
npx @kopai/cli metrics search --type Gauge --name system.cpu.utilization --json
```

`client.searchMetrics({ metricType, metricName, serviceName, attributes, aggregate, groupBy, limit })`
mirrors these (`metricType` required; `aggregate` is Gauge/Sum-only and `groupBy` requires `aggregate`; limit caps at 1000).
