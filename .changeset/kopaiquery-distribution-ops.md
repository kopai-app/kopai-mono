---
"@kopai/core": minor
"@kopai/clickhouse-datasource": minor
---

KopaiQuery can now read OTel histograms, summaries and counters correctly.
Five metric measure ops, each limited to the metric types it applies to:

- `HISTOGRAM_QUANTILE` `{op, quantile, as}`: a quantile from histogram buckets
  merged across series and the window. Each row also carries `<as>_low` and
  `<as>_high` (the bucket the true value lies in), `<as>_coarsened` (1 when
  series used different bucket layouts) and `<as>_error` (`"mixed_units"`,
  `"no_shared_bounds"` or null). A data problem makes that group's value null
  with a code; the query does not fail.
- `HISTOGRAM_AVG` `{op, as}`: increase of `Sum` ÷ increase of `Count`, plus
  `<as>_error`.
- `SUMMARY_QUANTILE` `{op, quantile, as}`: the highest of each instance's
  latest value for that quantile.
- `INCREASE` / `RATE` `{op, column, as}`: counter growth and per-second rate,
  on Sum `Value` or Histogram `Count`/`Sum`. Sum counters need an
  `{column: "IsMonotonic", op: "eq", value: true}` filter.

All of them handle delta and cumulative temporality, restarts and staleness
markers, read a baseline from up to 5 minutes before the window, and return
null rather than 0 when nothing was observed. Queries without them compile
exactly as before.

Queries that used to return a meaningless number or a server error are now
refused with a 400 that names the fix:

- A numeric measure (`SUM`, `AVG`, `P95`, …) on a structural column that is not
  numeric on any signal, e.g. `SUM(SpanName)`, `P95(BucketCounts)`, or
  `MIN`/`MAX` of `Timestamp`/`TimeUnix`.
- `P50`–`P999`, `AVG` and `RATE_AVG` on the `Sum` or `Count` of a Histogram,
  Summary or ExponentialHistogram metric. `SUM`, `MIN`, `MAX`, `RATE_SUM` and
  `RATE_MAX` there are unchanged.
- Next to one of the new ops only: filters on per-point columns (`Value`,
  `Count`, `Flags`, `AggregationTemporality`, `MetricDescription`, …) and
  `TimeUnix`/`StartTimeUnix` as dimensions.

`P50`–`P999` now compile to ClickHouse `quantileDeterministic` with a row hash
per signal, so the same rows always return the same percentile. Accuracy is
unchanged.

The new ops need **ClickHouse 24.x or later** (`groupArrayIntersect`,
`arrayFold`); they are tested on 25.6.
