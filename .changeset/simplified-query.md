---
"@kopai/clickhouse-datasource": minor
"@kopai/sqlite-datasource": minor
"@kopai/core": minor
"@kopai/sdk": minor
"@kopai/api": minor
---

Add KopaiQuery — a unified, type-safe query surface across traces, logs, and metrics (raw + aggregate modes).

- `@kopai/core`: new `kopaiQuery` (query model + zod schemas) and `kopaiQueryCompiler` (compiler + `KopaiQueryValidationError`) modules, exported from the package root. `metricsBaseSchema` is now exported.
- `@kopai/sdk`: new `kq` query builder and `KopaiClient` methods — `query()`, `queryTracesRaw/Aggregate`, `queryLogsRaw/Aggregate`, `queryMetricsRaw/Aggregate` — plus `KopaiQueryResponse`, `KopaiQueryBuildError`, and `KopaiQueryBuildIssue` exports.
- `@kopai/api`: new `POST /signals/query/{traces,logs,metrics}/{raw,aggregate}` routes; the error handler now maps `KopaiQueryValidationError` to a 400.
- `@kopai/clickhouse-datasource` / `@kopai/sqlite-datasource`: implement the new query methods.

Note: this widens the `ReadTelemetryDatasource` interface in `@kopai/core` with a new `ReadQueryDatasource` member (7 methods). All consumers within this repo are updated. Anyone _implementing_ `ReadTelemetryDatasource` outside the repo must add the new `query*` methods. Callers of the interface and existing HTTP/SDK clients are unaffected (purely additive).
