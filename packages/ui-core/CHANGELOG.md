# @kopai/ui-core

## 0.3.0

### Minor Changes

- 2868f27: Add an `AggregateTable` dashboard component that renders aggregate-mode `query` results (dimension + measure columns) as a table, with unit-aware cells and humanised headers.

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

### Patch Changes

- 5d04644: Update runtime dependencies. Notable upgrades: zod 4.5.4, fastify 5.12.1, @fastify/vite 10 (which moves to @fastify/static 10), @fastify/swagger-ui 6.1.1, @bufbuild/protobuf 2.14, kysely 0.29.5, @tanstack/react-virtual 3.14.10 and recharts 3.10.1. No public API changes in any @kopai package.
- b7ecda1: Update runtime dependencies. Notable upgrades: OpenTelemetry JS SDK 2.10 / experimental 0.221 (log record processors now take an options object), fastify-type-provider-zod 7, fastify-plugin 6, @fastify/swagger-ui 6, kysely 0.29.4, and recharts 3.10. @kopai/clickhouse-datasource also bumps @clickhouse/client to 1.23, which raises its Node.js requirement to >=20. @kopai/ui and @kopai/ui-core now require react >=19.2.8 as a peer. No public API changes in any @kopai package.
- Updated dependencies [5d04644]
  - @kopai/sdk@0.9.1

## 0.2.0

### Minor Changes

- 1fb095c: Add KopaiQuery — a unified, type-safe query surface across traces, logs, and metrics, in both raw and aggregate modes.

  KopaiQuery gives every signal type one query model with one set of semantics, compiled to backend-specific SQL and exposed end to end: a builder and client methods in the SDK, HTTP routes in the API, datasource implementations for ClickHouse and SQLite, and a dashboard `DataSource` variant in the UI.

  **`@kopai/core`** — new `kopaiQuery` (query model + zod schemas) and `kopaiQueryCompiler` (compiler + `KopaiQueryValidationError`) modules, exported from the package root; `metricsBaseSchema` is now exported too. The `ReadTelemetryDatasource` interface gains a `ReadQueryDatasource` member (7 `query*` methods).

  **`@kopai/sdk`** — new `kq` query builder and `KopaiClient` methods (`query()`, `queryTracesRaw/Aggregate`, `queryLogsRaw/Aggregate`, `queryMetricsRaw/Aggregate`), plus `KopaiQueryResponse`, `KopaiQueryBuildError`, and `KopaiQueryBuildIssue` exports. A new Node-only subpath export `@kopai/sdk/node` (`clientFromConfig`, `loadConfig`, `resolveConnection`, `DEFAULT_URL`, `CONFIG_FILENAME`) reads `.kopairc` and builds a configured client for code-mode scripts; the package root stays platform-neutral (browser-safe). `KopaiError.message` now includes the RFC 7807 `detail` text (composed as `"<title>: <detail>"`, falling back to title-only then `HTTP <status>`), so a server-side validation failure logs the actionable explanation — e.g. `"Invalid query: Percentile measures (P50-P999) are not yet supported on the sqlite backend."` — instead of just the generic title. The `detail`, `code`, `status`, and `type` fields are unchanged.

  **`@kopai/api`** — new `POST /signals/query/{traces,logs,metrics}/{raw,aggregate}` routes; the error handler maps `KopaiQueryValidationError` to a 400.

  **`@kopai/clickhouse-datasource` / `@kopai/sqlite-datasource`** — implement the new query methods. `ZeroThreshold` is excluded from the KopaiQuery surface so both backends behave identically: the ClickHouse OTel-collector schema has no `ZeroThreshold` column on the exponential-histogram table (it is coerced to `undefined` on read) while SQLite stores it, so a raw `ExponentialHistogram` query previously returned a different shape per backend, and filtering/grouping/aggregating on the field would have generated SQL against a non-existent ClickHouse column. `ZeroThreshold` is removed from the `MetricColumn` enum (moved to `METRIC_EXCLUDED`) and is no longer projected by the SQLite raw `ExponentialHistogram` query. The field remains in the underlying storage schemas and the legacy `getMetrics` read paths; only the unified KopaiQuery surface excludes it.

  **`@kopai/ui` / `@kopai/ui-core`** — the dashboard `DataSource` union gains a `query` variant (KopaiQuery), wired through `useKopaiData` and the renderer, and the observability catalog's `acceptsDataFrom` lists now include `"query"` for the log/trace/metric renderers — letting dashboard components source data from KopaiQuery. The metric renderers (`MetricTimeSeries`, `MetricHistogram`, `MetricStat`, `MetricTable`) now surface an explicit error when a `query` dataSource returns rows they can't draw — most commonly an aggregate-mode result, or a query for a different signal — instead of silently falling back to an empty panel and hiding the misconfiguration. Empty result sets and not-yet-loaded responses still render normally (no error); a shared `narrowQueryRows` helper distinguishes a genuine shape mismatch from an empty/absent response. As part of this work `@kopai/ui` now re-exports DOM-free symbols from `@kopai/ui-core` instead of shipping its own copies (public API unchanged — additive only; new code should prefer importing non-DOM symbols from `@kopai/ui-core` directly), and `CatalogueComponentProps` is added to the `@kopai/ui-core` public barrel so `@kopai/ui`'s dashboard primitives can use it.

  **`@kopai/cli`** — `.kopairc` reading and connection resolution now come from `@kopai/sdk/node` (single source of truth) instead of a private copy. No change to CLI behavior or flags.

  **Compatibility:** widening `ReadTelemetryDatasource` is purely additive for callers of the interface and for existing HTTP/SDK clients. Anyone _implementing_ `ReadTelemetryDatasource` outside this repo must add the new `query*` methods. All consumers within this repo are updated.

### Patch Changes

- Updated dependencies [1fb095c]
  - @kopai/core@0.11.0
  - @kopai/sdk@0.9.0

## 0.1.0

### Minor Changes

- c626c2b: New package `@kopai/ui-core` — DOM-free subset of `@kopai/ui` (catalog, renderer, provider, hooks, prompt-gen) for React Native / SSR / CLI consumers. `@kopai/ui` unchanged; re-export migration lands in a follow-up.
