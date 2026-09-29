# @kopai/core

## 0.12.0

### Minor Changes

- d3afabc: Make query validation issues name the field that is actually wrong.

  `KopaiQuery`'s branches contain further unions — a measure expression, a column
  reference, a filter node — and when one of those fails, zod reports the failure
  at the union itself with the bare message `Invalid input`. That was the least
  useful message on the three fields a caller is most likely to get wrong.

  `parseKopaiQuery` now answers the question zod declines to: it re-parses the
  value against each member, works out which one the caller was reaching for, and
  reports that member's own issues. So `measures.0: Invalid input` becomes
  `measures.0.column: Unknown value "NoSuchColumn"`, and the self-referential
  filter schema is descended into rather than stopping at `filters.0`.

  Near misses are suggested, folding case and punctuation: `"ServiceName"` is
  answered with `Did you mean "service.name"?`, and `"count"` with
  `Did you mean "COUNT"?`. Where no member fits, the message lists what the union
  accepts across all of its variants — so a bad measure operator names `COUNT`
  alongside the numeric operators, rather than only the variant zod happened to
  compare against last. Long enums are sampled rather than printed in full; the
  complete list is already in the schema callers hold.

  This rewrites message text and issue paths only. Nothing changes about what is
  accepted or rejected, and `@kopai/sdk`'s query builder — the other caller —
  needed no edit.

- d3afabc: Share the KopaiQuery branch dispatch and validation between the query builder
  and future callers.

  `@kopai/core` gains two exports. `kopaiQuery.branchSchemaFor(signal, mode)`
  returns the one branch of the `KopaiQuery` union that a signal/mode pair
  selects, alongside `SIGNALS`, `MODES`, `isSignal` and `isQueryMode` for
  reporting the accepted values back. `kopaiQueryCompiler.parseKopaiQuery(input)`
  takes unknown input, selects that branch, parses it and runs the cross-field
  checks `validateKopaiQuery` holds, returning `{ ok: true, data }` or
  `{ ok: false, issues }` where each issue is a `{ path, message }` pair.

  Why the pair matters: parsing an input against the whole six-branch union makes
  zod report every branch's failures at once, so one wrong field arrives buried in
  five irrelevant schemas' worth of noise. Selecting the branch first means the
  issues name the field the caller actually got wrong.

  `parseKopaiQuery` returns issues rather than throwing because its callers want
  different error types from the same checks — the query builder wraps them in a
  `KopaiQueryBuildError`, and other surfaces map them into their own error shape.

  `@kopai/sdk`'s query builder now delegates to it and drops its private
  `SCHEMA_MAP`. `kq` and `KopaiQueryBuildError` are unchanged and the builder's
  tests pass untouched, but the issues that error carries are not. The builder
  used to map zod's raw output straight through; it now receives what
  `explainIssues` rewrote, so both paths and messages move — `filters.0` becomes
  `filters.0.column`, and `dimensions.0`'s bare `Invalid input` becomes
  `Unknown value "ServiceName". Did you mean "service.name"?`. Nothing changes
  about what is accepted or rejected, but a caller matching on `issue.path` or
  `issue.message` sees different values, which is why `@kopai/sdk` takes a minor
  bump rather than a patch.

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

- d3afabc: Tell the agent which levers control the size of a result, before it queries.

  The `KopaiQuery` schema is shared with the REST routes, and part of what it
  said was true there and false here: its `limit` field advertised
  `Hard cap = 10000`, which is REST's cap, while this tool refuses anything above
  200 raw or 500 aggregate. A model reading the field-level description — the
  text nearest the decision — wrote a limit it would be refused for.

  `@kopai/mcp` now rewrites descriptions in the copy of the schema it advertises,
  leaving the shared one alone. `limit` states the caps this tool enforces, that
  it refuses rather than lowers, and that the two modes part company once a
  result overruns — raw truncates and returns a cursor, aggregate refuses
  outright — so the default is not read as a row count the tool will hand back;
  `granularity` says a time series returns a row per group per bucket, so halving
  it doubles the rows; `dimensions` says the row count is the distinct groupings
  multiplied by the bucket count, and that a high-cardinality column can exceed
  the cap by itself. Matching is by
  description prefix, and a test asserts every override still matches something,
  so a reworded schema fails loudly instead of quietly dropping the guidance.

  The `query` tool description gains three sentences: that the row cap applies to
  groups times buckets rather than to records scanned; that ranking over time
  takes two calls, a `summary` to find the top groups and a `timeSeries` filtered
  to them; and that `metrics_discover` reports attribute values, which is how to
  judge a grouping column's cardinality before querying.

  `@kopai/core` gains the two `dimensions` descriptions that were missing
  entirely from the logs and metrics aggregate branches — only traces documented
  that field. Additive, and REST callers see them too.

- d3afabc: Write down an upstream failure, report every tool call, and stop spending the
  explanation budget on nesting.

  **An upstream failure is logged.** `"The query could not be completed."` is the
  whole of what a model can act on, and it was also the whole of what anyone got:
  a datasource refusing connections left nothing for whoever runs the server, in
  a product whose purpose is making failures visible. `mcpRoutes` now hands the
  tools the Fastify request logger — so the cause lands beside everything else
  written about that request — and `logger` on the route options redirects it.
  A validation error is still not logged: it is the caller's own mistake, it is
  reported back in full, and logging every malformed query would bury the
  outages.

  **Every tool call reports, including one that throws.** Nothing in the tools is
  expected to throw, which is the reason to handle it rather than assume it: a
  throw skipped `observe` altogether, so a host's counter lost exactly the calls
  most worth seeing, and reached the SDK as a bare message with no
  `structuredContent` — the one error shape a live page cannot read. The
  registration layer converts an unexpected failure into the same contract as an
  expected one: a structured payload, a logged cause, and one observer event.

  **A deeply nested filter is still explained.** Each `and`/`or` level spent one
  unit of the recursion budget before any of it reached the leaf, so a filter
  four wrappers deep fell back to the bare `Invalid input` this module exists to
  remove. A level costs one member re-parse of a value that shrinks as it
  descends, so the budget can afford to be generous; it now covers about ten
  levels of nesting.

- d3afabc: Explain the five discriminators, report the sibling mistake, and degrade the
  metrics listing instead of refusing it.

  **Issue paths walk into unions.** zod reports a discriminator mismatch at the
  discriminator, not at the union — `filters.0.op`, not `filters.0` — and the
  path walk stopped at the first union it met, so every such issue kept zod's own
  `Invalid discriminator value` text. That covered `op`, `orderBy.type`,
  `timeDimension.type`, `output.type` and any enum inside a member
  (`direction`): the fields a caller is most likely to get wrong were the ones
  the explainer could not reach. A union has no shape of its own, so the schema
  at a key is now whatever its members declare there — collapsed into one enum
  over every value they accept where those are literals or enums. So
  `op: "EQ"` is answered with `Did you mean "eq"?`, `output: {type:
"TimeSeries"}` with `Did you mean "timeSeries"?`, and a two-mistake filter
  leaf, which used to report two bare `Invalid input`s at the right paths, now
  names the column it did not recognise and the type it expected.

  **A suggestion carries its variant's other issues.** `{op: "avg", as: "c"}` is
  two mistakes — a lower-cased operator, and `column`, which a numeric measure
  requires — and only the first was reported, so fixing it bought a second round
  trip to discover the second. The suggestion identifies the variant the caller
  meant, so that variant's remaining issues are reported alongside it. Not
  without a suggestion: which variant was meant is then unknown, and one member's
  requirements are not another's — a COUNT measure needs no `column`, and
  inventing that requirement would send the caller to add a field they do not
  need.

  **A misspelled key no longer reports the key it should have been as missing.**
  `valu` for `value` produced both an unrecognized-key issue and a missing-`value`
  issue. One mistake, and the half worth reporting is the key that was actually
  written. Suppressed only where the suggested key really is absent, so a genuine
  problem with a key the caller did send always survives.

  **`metrics_discover` degrades rather than dead-ends.** The tool takes no
  arguments, so a caller handed `result_too_large` had nothing to change — and
  the remedies it was given named a `limit`, a time window and a `granularity`,
  none of which it accepts. An over-size listing now drops the values seen on
  each attribute (keys kept, under `attributeKeys`), then the attributes, and the
  response names what was omitted under `omitted` so a thinner answer cannot pass
  as the whole one. Only a listing whose metric names alone overrun is refused,
  and its remedies name what is still possible: query a metric by name, or reduce
  what the deployment ingests.

  **One-bucket time series are classified as time series.** `overflowRemedies`
  read `output.type` off the bucket count, so a window spanning a single bucket —
  a 30-second window at `5m` — took the summary branch: the `output: {type:
"summary"}` remedy was dropped, and the query was described as having no
  granularity when it has one. It now reads the query's own `output.type`, and
  the bucket count only orders the advice. A single bucket also drops the coarser-
  granularity line, which had nothing to merge, and an ungrouped time series is
  offered the summary it was previously denied.

- d3afabc: Suggest a key the chosen filter member actually accepts.

  The candidate list for an unknown key was every union member's keys merged,
  which answers "what may appear at this node" but not "what is accepted given
  what the caller already wrote". So a key a sibling member declares was offered
  as a correction for itself: `{column, op: "in", value: [...]}` was answered with
  `Unknown key "value". Did you mean "value"?`, and the same on `eq` or `gt` with
  `values`.

  The candidates are now the members the value could still be — a member is out
  when a literal or enum key it declares rejects what the value carries there,
  and out when it shares no key with the value at all, which is the `and`/`or`
  wrapper beside a leaf. An `in` filter carrying `value` is now answered with
  `Did you mean "values"?`, and `eq` or `gt` carrying `values` with
  `Did you mean "value"?`. An operator that takes neither — `isNull`,
  `isNotNull` — is answered with the keys it does accept rather than a key that
  would also be refused. A key is never offered back as a correction for itself.

  Raised in review on PR #180.

## 0.11.0

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

## 0.10.0

### Minor Changes

- b88c36f: Fix problem with ISO timestamps being passed instead of timestamps in nanos

## 0.9.0

### Minor Changes

- 3894c34: Add aggregate metrics

## 0.8.0

### Minor Changes

- 5aea6c3: Add new trace-related API methods

## 0.7.0

### Minor Changes

- 4731538: Add dynamic dashboard

## 0.6.0

### Minor Changes

- 56f9607: Add clickhouse datasource

## 0.5.0

### Minor Changes

- 853f95e: improve performance

## 0.4.0

### Minor Changes

- c9fe7a3: Add support for http/proto, update fix exemplar types

## 0.3.0

### Minor Changes

- 03ebb7d: Extended support for attribute values to include arrays of strings, numbers, and booleans alongside primitive values, broadening the allowed data types for OpenTelemetry resource and span attributes.

## 0.2.0

### Minor Changes

- 1da61f2: Publish all on same version

## 0.1.0

### Minor Changes

- b5074c3: Initial provenance publish for dependencies
