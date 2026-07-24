# @kopai/ui-core

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
