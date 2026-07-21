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

For Gauge/Sum, aggregate over `Value` (`avg`/`sum`/`max`). For Histogram, aggregate over
`Count`/`Sum`/`Max`.

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
