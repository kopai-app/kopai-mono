# @kopai/clickhouse-datasource

## 0.10.0

### Minor Changes

- d3afabc: Reject an unknown key or an inverted time window instead of running a different
  query.

  Every object in the query language was a `z.object`, which drops a key it does
  not recognise. A caller that wrote `filter` for `filters` got back the entire
  unfiltered window, with no issue raised and nothing in the response to say a
  field had been ignored — the query ran, so the result read as an answer rather
  than as a mistake. The MCP `query` tool is driven by a model, which makes a
  near-miss key the normal case rather than a rare one, and its advertised schema
  made this worse: in `io: "input"` mode zod emits no `additionalProperties` for a
  plain `z.object`, so the document stated no rule a host could have enforced
  either. (The same failure, one layer up, is the `spanAttributes` bug in the
  trace Tags filter — a key zod stripped, and a search that silently ran
  unfiltered.)

  All of them are now `z.strictObject`, so an unrecognized key is reported. The
  generated tool schema says `additionalProperties: false` on every node, and
  `runQueryTool` also rejects an argument written beside `query` rather than
  inside it — `{query, limit}` used to drop the `limit` and run with the default.

  `parseKopaiQuery` names the key in the issue path and, where one is close
  enough, the key that was probably meant: `filter` is answered with
  `Did you mean "filters"?`, and so are `limitt`, `dimension` and `colunm`. The
  budget is one insertion, deletion, substitution or transposition, scaled so a
  short key cannot be corrected into an unrelated one, and a tie yields no
  suggestion. Where nothing is close, the message lists the keys accepted at that
  path. Each unknown key gets its own issue rather than one issue for the object.

  `validateKopaiQuery` now also rejects an absolute window whose `startTime` is
  not before its `endTime`. Both bounds are valid datetimes, so no schema can
  catch it; left through, the query matched nothing and the empty result was
  indistinguishable from "there is no telemetry in that window", which sends the
  caller to widen a window that was inverted. Equal bounds are rejected too —
  `endTime` is exclusive.

  Behaviour that changes with this, all of it previously silent:

  - A field removed from the query language is reported rather than dropped:
    `kind` on a filter leaf, `compareOffset` on a time dimension.
  - The HTTP query routes answer 400 for an unknown field in the body instead of
    stripping it and running the query.
  - `KopaiClient`'s query methods throw on an unknown field instead of dropping
    it before the request, and the query builder rejects reversed
    `timeAbsolute` bounds at `build()`.
  - A dashboard definition whose `query` datasource carries an extra key in
    `params` now fails validation rather than running a narrower query than it
    describes.

### Patch Changes

- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
  - @kopai/core@0.12.0

## 0.9.0

### Minor Changes

- b7ecda1: Update runtime dependencies. Notable upgrades: OpenTelemetry JS SDK 2.10 / experimental 0.221 (log record processors now take an options object), fastify-type-provider-zod 7, fastify-plugin 6, @fastify/swagger-ui 6, kysely 0.29.4, and recharts 3.10. @kopai/clickhouse-datasource also bumps @clickhouse/client to 1.23, which raises its Node.js requirement to >=20. @kopai/ui and @kopai/ui-core now require react >=19.2.8 as a peer. No public API changes in any @kopai package.

### Patch Changes

- 5d04644: Update runtime dependencies. Notable upgrades: zod 4.5.4, fastify 5.12.1, @fastify/vite 10 (which moves to @fastify/static 10), @fastify/swagger-ui 6.1.1, @bufbuild/protobuf 2.14, kysely 0.29.5, @tanstack/react-virtual 3.14.10 and recharts 3.10.1. No public API changes in any @kopai package.

## 0.8.0

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

## 0.7.0

### Minor Changes

- f3edc9f: Allow setting clickhouseSettings in filter context
- f3edc9f: Use latest Opentelemetry collector's clickhouse exporter DB schema

## 0.6.1

### Patch Changes

- Updated dependencies [b88c36f]
  - @kopai/core@0.10.0

## 0.6.0

### Minor Changes

- 343a649: Fix trace duration calculation in older ClickHouse version

## 0.5.0

### Minor Changes

- 3894c34: Add aggregate metrics

### Patch Changes

- Updated dependencies [3894c34]
  - @kopai/core@0.9.0

## 0.4.0

### Minor Changes

- 5aea6c3: Add new trace-related API methods

### Patch Changes

- Updated dependencies [5aea6c3]
  - @kopai/core@0.8.0

## 0.3.1

### Patch Changes

- Updated dependencies [4731538]
  - @kopai/core@0.7.0

## 0.3.0

### Minor Changes

- 4d35733: Simplify MV discovery, improve logging

## 0.2.0

### Minor Changes

- 7542c2b: Make debugging easier

## 0.1.2

### Patch Changes

- ed34f9e: Add option to optimize metrics discover performance using materialized views

## 0.1.1

### Patch Changes

- 56f9607: Add clickhouse datasource
- Updated dependencies [56f9607]
  - @kopai/core@0.6.0
