---
"@kopai/ui-core": minor
"@kopai/ui": minor
---

Add an `AggregateTable` dashboard component that renders aggregate-mode `query` results (dimension + measure columns) as a table, with unit-aware cells and humanised headers.

Previously every data-bound SDUI renderer validated for raw signal rows, so an aggregate query (e.g. top spans by `AVG(Duration)`, request counts grouped by `StatusCode`) had no renderer and, if bound to `MetricTable`, failed at render with "This panel displays raw metric rows…". `AggregateTable` accepts the polymorphic aggregate result and derives its columns from the rows, so any signal's aggregate output can be displayed.

Because the columns come from the query rather than a fixed schema, the component carries no unit or naming metadata of its own. Two further props supply it, alongside the existing `maxRows`. Following the rest of the catalog, both are nullable but must be present — pass `null` when unused.

**`units`** maps a column name to its OTel unit, so the cell renders in human terms:

```ts
props: {
  maxRows: 10,
  units: { avg_duration_ns: "ns", error_rate: "1" },
  labels: null,
}
```

This matters most for durations. OTel stores span `Duration` in nanoseconds, so an unannotated `AVG(Duration)` of `23070000` renders as `23.07M` — digits that coincidentally match the millisecond value, which is what makes the bare SI suffix misleading. Annotated, the same cell reads `23.07 ms`. Units resolve through the same scale resolver the charts and `MetricStat` already use, so `ns`/`us`/`ms`/`s` render as durations, `By` as bytes, `"1"` as a percentage, and an unknown unit as a scaled number with the unit appended (`{spans}` → `2.50 M spans`). Unannotated columns keep plain K/M/G scaling.

**`labels`** overrides the header for any column. Headers are otherwise derived automatically: snake_case, dotted and PascalCase names become Title Case (`span_count` → "Span Count", `service.name` → "Service Name", `SpanName` → "Span Name"), acronym runs stay whole (`HTTPRoute` → "HTTP Route"), and a trailing unit token is dropped when the column is unit-annotated (`avg_duration_ns` + `ns` → "Avg Duration") since the unit already appears in the cell. The drop only fires when name and annotation agree — `avg_duration_ms` annotated `ns` keeps its suffix rather than being relabelled to something the values contradict. Humanising flattens dotted OTel attribute names (`SpanAttributes.http.route` → "Span Attributes Http Route"), which is the case `labels` exists to fix.

Separately, nanoseconds gained a scale family in the shared unit resolver. Any metric whose OTel unit is `ns` previously fell through to generic scaling and rendered as `23.1 M ns`; it now renders as `23.1 ms`. This affects `MetricStat`, `MetricTimeSeries`, and `MetricHistogram` as well as the new table. No other unit changes behaviour.
