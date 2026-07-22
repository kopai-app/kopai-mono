---
"@kopai/ui-core": minor
"@kopai/ui": minor
---

Add an `AggregateTable` dashboard component that renders aggregate-mode `query` results (dimension + measure columns) as a table.

Previously every data-bound SDUI renderer validated for raw signal rows, so an aggregate query (e.g. top spans by `AVG(Duration)`, request counts grouped by `StatusCode`) had no renderer and, if bound to `MetricTable`, failed at render with "This panel displays raw metric rows…". `AggregateTable` accepts the polymorphic aggregate result and derives its columns from the rows, so any signal's aggregate output can be displayed.
