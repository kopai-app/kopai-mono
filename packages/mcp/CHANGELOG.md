# @kopai/mcp

## 0.1.0

### Minor Changes

- d3afabc: New package: the MCP server plugin's schema layer.

  `@kopai/mcp` will expose Kopai's read-only query API to MCP hosts. This first
  release carries the package scaffold and the generated tool input schemas; the
  tools themselves and the Fastify wiring follow.

  `QUERY_TOOL_INPUT_SCHEMA` is the KopaiQuery union wrapped in a single `query`
  property — an MCP tool input schema must have an object root — converted to
  JSON Schema 2020-12 and deduplicated into `$defs`. The union repeats the same
  column enums and filter expressions across all six branches, so emitted
  verbatim it is 131,775 characters; deduplicated it is 27,433, a 79.2%
  reduction. That matters because a host carries the document in its `tools:`
  array on every turn, not once per connection.

  The reduction is lossless, which is the property the whole thing rests on: the
  deduplicated document accepts and rejects exactly what the raw one does,
  asserted over hand-written cases covering all six branches and 4,000 mutated
  inputs.

  `dedupe` is exported because the deduplication is keyword-aware rather than a
  blind object walk — in JSON Schema a nested object is not always a schema, and
  hoisting a value out of an `enum` or `const` would change what the document
  accepts.

  Both schemas are built at module scope. Generating and deduplicating costs
  several milliseconds, and the MCP transport builds a fresh server per request,
  so doing this work per request would dominate the request itself.

  `@kopai/core` is a `peerDependency`, so that a host application resolves one
  copy of it rather than this package carrying its own.

- d3afabc: Add `mcpRoutes`, the Fastify plugin that mounts the MCP endpoint.

  Registers `/mcp` relative to wherever the plugin is mounted, stateless: no
  session id, no server push, and a fresh `McpServer` per request.

  The handler is built inside the route handler rather than once at
  registration, so the tool callbacks close over the `FastifyRequest` lexically
  and the host application's per-request context reaches the datasource without
  this package knowing anything about tenants or credentials. Verified with 200
  concurrent calls across eight tenants, none misattributed.

  `GET` and `DELETE` are routed alongside `POST` purely so the SDK gets to answer
  them `405`. With only a `POST` route, Fastify's own 404 handler replies first
  and the SDK is never consulted — and a client that probes `GET` and receives
  404 reads the endpoint as gone rather than as healthy and non-streaming.
  `OPTIONS` is deliberately left unrouted, so it does not intercept CORS
  preflight; `PUT` and `PATCH` fall through to 404.

  `Allow: POST` is sent on those 405s, which RFC 9110 requires and the SDK omits.
  It has to be written to `reply.raw` — Fastify stages headers on its own reply
  object and flushes them only when it serializes a response, which never happens
  once the reply is hijacked, so `reply.header()` is silently dropped here.

  Host-header validation is mounted as an `onRequest` hook over a port-agnostic
  allow-list, which is what refuses a DNS-rebinding request. Origin validation is
  mounted the same way, but only when `allowedOriginHostnames` is set — see the
  note on that option for why it is opt-in.

  `responseMode` is not passed to `createMcpHandler`: it is byte-identical to the
  `auto` default across every combination measured, its only observable effect is
  a warning emitted once per handler — which here is once per request — and it
  silently drops mid-call notifications.

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

- d3afabc: Add opt-in origin validation, via a new `allowedOriginHostnames` option.

  Host validation alone does not stop a page that simply fetches
  `http://127.0.0.1:<port>/mcp` — there the `Host` header genuinely is loopback,
  and only `Origin` says who asked. That such a request fails today is
  incidental: it needs a CORS preflight, `OPTIONS` is unrouted, and the local app
  registers no CORS. Any one of those changing removes the protection.

  It is opt-in rather than always-on because the two mounts have different threat
  models. An unauthenticated local app has nothing but these headers between a
  web page and the data, and there the host and origin lists genuinely coincide —
  both are loopback. A deployed, authenticated mount has the credential as its
  boundary and usually already runs a CORS policy; a second, independently
  configured origin list there buys little and strands a future browser client
  behind a validator nobody remembers configuring.

  The option takes **hostnames**, deliberately not origins, and is named to say
  so. The underlying validator compares hostnames port-agnostically: passing
  `"https://app.example.com"` refuses that very origin, and passing `"*"` refuses
  everything, both silently, since either is a valid `string[]`. Two tests pin
  that trap. A request with no `Origin` passes by design, so non-browser clients
  are unaffected.

  A value that is not an array of strings is refused at registration rather than
  mounted. `null` — what a config read from JSON or an env var yields where the
  list is missing — used to count as configured, and the validator then called
  `.includes` on it inside an `onRequest` hook. Measured: a request carrying an
  `Origin` got `500 Cannot read properties of null (reading 'includes')`, while a
  request without one passed, so the endpoint looked healthy to every MCP client
  and was broken only for pages. A bare string was worse than broken:
  `String.prototype.includes` matches substrings, so `"localhost"` would have
  admitted an origin whose hostname is `"host"`. Both now throw at boot, naming
  the option and saying how to ask for no validation.

  An empty list stays mounted, and refuses every browser origin. It is a coherent
  thing to ask for, it is the safe reading of an ambiguous config, and treating it
  as "not configured" would drop a security control precisely when its list came
  back empty — leaving the caller who set the option unprotected and unaware. The
  option's documentation now says so, because non-browser clients pass either way,
  which makes an accidental `[]` present as "works from my MCP client, broken from
  every page".

- d3afabc: Add the two read-only tools, `query` and `metrics_discover`.

  `query` takes one KopaiQuery under a `query` property and returns the same
  JSON the REST query routes return. `metrics_discover` takes no arguments and
  returns the metric discovery payload. Both declare `readOnlyHint`,
  `idempotentHint` and `openWorldHint: false`, and neither advertises an
  `outputSchema`.

  Every result carries its payload in **both** channels — as
  `structuredContent` and as one text block holding exactly `JSON.stringify` of
  the same object. The two consumers read different channels and neither reads
  both: a live page reads the structured value, while a conversational agent
  reads `content` and discards `structuredContent` whenever `content` is
  non-empty. Rows in one channel and a prose summary in the other is the single
  combination that fails silently, and it fails hardest on the error path, where
  the fallback to the structured value never fires at all.

  Row caps are per mode — 200 raw, 500 aggregate — because a raw row is an order
  of magnitude larger than an aggregate one, and at 500 every raw shape overruns
  the 150,000-character ceiling. An over-cap `limit` is refused, never clamped: a
  caller that asked for 500 rows and silently got 200 would read the result as
  complete.

  An aggregate query runs one row over its cap so an overflow is detectable, and
  an overflow is refused outright with no rows — whether or not the query carries
  an `orderBy`. An ordering would make truncation well defined, but a live page
  cannot act on a remedy: its query was fixed when the page was authored and its
  viewer did not write it, so a partial result would simply be drawn as though it
  were the whole set. Refusing is what makes ADR-059's "never draw a partial
  chart" hold without every page having to check a flag. Without an ordering it
  would be worse again, since the aggregate compiler emits no `ORDER BY` when
  `orderBy` is absent and a limit would drop an arbitrary subset — for a time
  series, a scatter of (group, bucket) pairs that reads as real data.

  Overflow remedies are ordered by whichever factor caused the overflow. An
  aggregate returns groups times buckets rows, and the two need opposite advice:
  a summary query grouping by a high-cardinality column has no granularity to
  coarsen, while a window cut into more buckets than the cap allows cannot be
  regrouped out of. The bucket count is derived from the window and the
  granularity, which is enough to tell the two apart. It counts boundaries rather
  than whole spans: both backends snap a timestamp to a fixed offset from the
  epoch, so a window that does not start on a boundary straddles one bucket more
  than it has whole granularities — an hour at `5m` starting at :02:30 is
  thirteen buckets, not twelve. An absolute window is counted exactly; a relative
  one ends at the clock reading taken when the query runs, so it carries the
  extra bucket unconditionally.

  Errors are `isError: true` with a `{ error, message, issues?, remedies? }`
  payload, `error` first so the serialized JSON opens with the code. Codes reuse
  the four outcome labels. A `KopaiQueryValidationError` becomes `invalid_input`
  carrying its own message; anything unrecognised becomes `upstream_error` with a
  generic string, mirroring the REST handler's no-leak posture.

  The `query` tool is registered with a pass-through validator so the handler is
  what validates — the SDK's default would reject before dispatch with one line
  listing all six branches, recompile the schema on every request, and hide
  `invalid_input` from the observer.

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

- d3afabc: Add the integration test layer — the tools driven over JSON-RPC against a real
  in-memory SQLite datasource, rather than a fake.

  The unit tests assert the contract's shape; these assert its behaviour, and
  they caught things a fake could not. The aggregate response genuinely carries
  no `nextCursor`, where the raw response does. A metric query with no
  `MetricType` filter is rejected by the datasource's own validator and arrives
  as `invalid_input` at `query`. And the success payload is asserted
  byte-identical to what the REST route returns for the same query — the
  same-JSON-as-REST promise, now checked rather than stated.

  Overflow behaviour is exercised against real rows too: an aggregate over its
  cap is refused with no rows, ordered or not.

- d3afabc: Name the branch a failed query was judged against.

  An `invalid_input` result said only "The query is not valid.", and its issues
  name fields. The six query shapes share field names — `measures` is on three of
  them, `filters` on all six — so `query.measures.0.column` does not tell a caller
  which shape its query was read as, and the `signal`/`mode` pair that decides
  that is the one thing it can get wrong without any issue pointing at it. The
  message now reads "The traces/aggregate query is not valid." Where the pair
  itself is wrong there is no branch to name, the message stays as it was, and the
  issues on `signal` and `mode` are what the caller needs instead.

  This restores something KOP-95 asked for and the JSON text block dropped: a
  failed call naming the branch as well as the field. KOP-106's acceptance gate
  reads it back.

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

- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
- Updated dependencies [d3afabc]
  - @kopai/core@0.12.0
