# Service Map — progressive client-side build: research, requirements and grilling prep

Status: research input for the grilling session · 2026-11-06
Builds on [`research.md`](./research.md) (called **R1** below; its IDs are written `R1-D1`, `R1-P12`, …). R1 assumed a server-side self-join and a new endpoint. This doc studies the product owner's **client-side, progressive, SDK-only** design instead. R1's edge rules (D1, D3, D3a, D4, D6, D7, D13, D21) still apply. R1's server-SQL parts (D14–D16) do not. R1-D20 (dagre LR) is challenged in §5.

ID schemes in this doc: `R#`/`NFR#` = requirements, `P#` = pitfalls, `Q#` = grilling questions, `A#` = algorithm decisions.

---

## 0. Decisions from grilling (round 1, 2026-11-06)

| Q     | Decision                                                                                                                                                                                                          | Consequence for this doc                                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1    | **Yes.** Every existing SDK method is allowed (`queryTracesAggregate`, `queryTracesRaw`, `getTrace`, `getServices`, …).                                                                                           | A1 (aggregate seed) is in.                                                                                                                                                                                               |
| Q2    | **Bounded aggregate state is fine.** The goal is to **never leak memory**, not to have zero state. Do not keep span rows; small, capped tuples are OK.                                                            | A3 join buffer is in. New hard NFR: **every structure has a cap that doesn't depend on how long the tab stays open** (services, edges, join buffer, buckets).                                                            |
| Q3/Q4 | **M is one product constant**, chosen to work well for about 80% of users. Not user-configurable in the MVP.                                                                                                      | The value of M is still open (round 2). Stop rule = coverage reaches M **or** budget spent; header shows the actual coverage.                                                                                            |
| Q5    | **Busiest = span count** per service (from the aggregate seed, so it is known on frame 1). **The centre never changes** during a session. The real goal is **no flashes and no large jumps** as new spans arrive. | Manual re-centre is dropped. "Stability over accuracy" becomes a design principle for layout and for adding/removing nodes.                                                                                              |
| Q10   | **Approximate is fine.** The map gives a quick mental picture; it is not an analysis tool.                                                                                                                        | Q10(b), the derived `parent.service.name` dimension, is **not needed**. A4 (parent lookup), percentiles and exact rates move out of scope. Edge counts are shown as relative weight (thickness), not as precise numbers. |

### Round 2 (2026-11-06)

| Q    | Decision                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | **M = 60 min.** Busy systems stop on the request budget first; the header shows actual coverage ("covers 6 of 60 min").                                                                                                                                                                                                                                                                                 |
| R2-2 | **Centre = the service with the most spans among services that have at least one connection**, chosen after aggregate + first page, before the first render. If nothing is connected, use the plain busiest service. It never changes afterwards.                                                                                                                                                       |
| R2-3 | **Nodes and connections never disappear during a session**; once their traffic ages out of M they turn dim. Line thickness counts only the past M minutes (per-minute buckets, about 1 MB, capped).                                                                                                                                                                                                     |
| R2-4 | **Forward poll every 10 s, with a fixed 30 s delay.** No re-read of the last 30 s. Spans longer than 30 s may be missed (acceptable). Header: "live · 30 s delay".                                                                                                                                                                                                                                      |
| R2-5 | **One `serviceName`-filtered page for each service that still has no connections** after the main scan.                                                                                                                                                                                                                                                                                                 |
| R2-6 | **Databases, queues and external APIs are nodes in the MVP**, taken from the aggregate seed.                                                                                                                                                                                                                                                                                                            |
| R2-7 | **MVP is a standalone page**; the dashboard component comes later. The work runs in **one Web Worker per tab**, shared by every view of the map.                                                                                                                                                                                                                                                        |
| R2-8 | **Layout D, "centred flow"**: the busiest connected service sits in the middle column, callers to its left, callees to its right, one column per hop. A node keeps its position once placed. **Keep the "not connected yet" tray** for services the aggregate lists but that have no known connection to the map. Mock-ups: https://claude.ai/artifact/9hBXUcqb7y1HSbuK76FABK                           |
| R2-9 | **The layout must never break and must always keep every node reachable, from 0 services to hundreds.** It is tested at both extremes (see §5.5).                                                                                                                                                                                                                                                       |
| Q19  | **Reserve lanes up front from frame 1**, with an animated block shift as the fallback when the prediction is too low. Prediction per column c: `lanes(c) = ceil((placed_c + tray × share_c) / K)`, where `placed_c` is the number of nodes placed in column c on frame 1, `share_c` is c's share of all placed nodes, and `tray` is the frame-1 tray count. Reservations never shrink during a session. |

### Round 3 (2026-11-06): accepted recommendations

| Q   | Decision                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q9  | **Pairing horizon H = 120 s, fixed.** A child that waits longer for its parent is counted as `lateUnpaired`.                                                                                                       |
| Q11 | **SQLite budget:** one request at a time, at least 100 ms between requests, at most 200 requests per scan, at most 1,000 spans per page. **CI benchmark:** ingest p99 while a scan runs.                           |
| Q13 | **Span-link messaging connections are out of the MVP.** Queue nodes come from the aggregate seed.                                                                                                                  |
| Q16 | **No visible node limit** (R2-9). **Internal safety cap of 2,000 nodes.** Above it, the header says the map is incomplete. The cap also protects against high-cardinality `service.name` values such as pod names. |
| Q18 | **Bad timestamps** (future, zero, or outside the window) are counted as a diagnostic and never move the time window.                                                                                               |
| Q20 | **No grouping in the MVP** (no namespace boxes, no collapsing). Lanes, level of detail and Find cover about 500 nodes.                                                                                             |

Decisions already covered by earlier rounds: Q7 and Q8 by R2-3, Q12 by R2-6, Q14 by R2-7, Q15 by R2-4, Q17 by the §5.5 fixtures.

> **§0 overrides the rest of this doc.** Sections 1–8 are the research input. Where they recommend something different (for example a user-chosen M of 15 min, the A4 parent lookup, percentiles, or re-reading the last 30 s), the decision in §0 wins.

---

## 1. TL;DR

- **The industry computes service graphs on the server or at ingest, never progressively in the browser.** Tempo and the OTel connector pair spans in a streaming store with a TTL. SigNoz pairs them in a ClickHouse materialized view at ingest. PostHog and Jaeger run a self-join over a bounded sample. Kiali reads Istio metrics. Jaeger's DDG builds in the browser but loads everything first. **Kopai's progressive client-side discovery has no precedent in these tools**, so its correctness risks are our own to solve.
- **The rules we can reuse:** count each call once, on the child span (R1-D1). Pair spans through a bounded keyed buffer with expiry and a hard cap, and **count what falls out** (Tempo `store.go`). Never retain whole spans.
- **Risk 1, edges get lost (critical).** A parent and its child often sit on different pages. With only "two timestamps + counts" in state, those edges are lost, and the loss is biased against deep, slow and high-throughput calls. **Fix:** a bounded, time-evicted pairing index of small tuples (`spanId → service`). No span rows are kept, but the PO's state rule has to be relaxed.
- **Risk 2, forward polling misses late spans (critical).** Spans are exported when they **end**, and `Timestamp` is the **start**. Polling with `timestampMin = newestSeen` permanently misses long spans and slow exporters. Data-derived watermarks also break under clock skew. **Fix:** anchor the window to the wall clock. Seal only `[…, now − L)` and re-read a provisional tail.
- **Risk 3, the stop rule stops too early (high).** "No new services for 2 pages" really measures the chattiest service. At 2k spans/s, two 1000-span pages cover about 1 s. Cron jobs and quiet consumers never appear, and "past M minutes" turns into "past 1 s". **Fix:** stop on time coverage, budget, or (nodes **and** edges stable **and** a minimum coverage). Take the exact node list from `queryTracesAggregate`.
- **Risk 4, counts never expire (high).** A min/max watermark plus running counts cannot describe a sliding window or gaps in coverage. **Fix:** keep per-minute buckets in a ring buffer plus a coverage interval set. Memory stays small (about 1 MB).
- **Risk 5, wire cost and backend load (high).** `/signals/traces/search` always returns full rows (about 1.5–3 KB per span, UNVERIFIED), and there is no projection on any path. SQLite blocks ingest on every page. ClickHouse re-sorts the remaining window on every page. Fully covering 15 min at 2k spans/s would take about 1800 requests and several GB (UNVERIFIED estimate).
- **Do not drop the "no new endpoint" rule, but read it to include the existing SDK aggregate methods.** `queryTracesAggregate` already returns the exact node set, node RED, the busiest service and the virtual/peer edges for an exact window, in 1–2 requests and with no spans shipped. Span paging is then needed **only** for edges between two instrumented services.
- **Recommended shape:**
  - An aggregate "seed" (nodes, centre, virtual edges) drawn instantly.
  - A Web-Worker loop that pages spans backwards and polls forward with a lag. It feeds a bounded join buffer and per-minute buckets, and posts throttled snapshots to the UI.
  - A user-chosen `M` (default 15 min), with the header showing actual coverage.
- **Layout:** `@xyflow/react` to render plus `d3-force` to place. Anchored radial layout: the hub is fixed at (0,0), rings are hop distance from the hub, new nodes are seeded next to their strongest neighbour, and existing nodes move at most about 40 px. The hub never changes automatically. This replaces R1-D20's dagre, which cannot do incremental layout or a centre.
- **Already solved elsewhere, copy it:** keep the last good graph on error, give every error state a retry, abort runs with `AbortController`, pause when the tab is hidden, fit the view once, scale edge width by log, and show single services. These come from PostHog's review findings and SigNoz and Grafana bugs.

---

## 2. How the reference tools do it

### 2.1 Comparison, from our angle

| Tool                           | Where pairing is computed                                           | How work and memory are bounded                                                                                                          | Sampling                                                                                       | Pairing spans that arrive separately                                                                                                                                       | How the time window is shown                                                                                | Layout and stability on refresh                                                                                                                                                  | Centre / sizing                                                   |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Tempo metrics-generator**    | Server, streaming at ingest                                         | `max_items` 10k, `wait` 10 s (wall clock), expiry tick every 2 s. When full it **drops the newest** span (TODO in code to evict instead) | None. Spans older than 30 s after their end are ignored (`metrics_ingestion_time_range_slack`) | `map[(traceId, spanId)]` plus a FIFO list. The server side is keyed under its `ParentSpanId`. `onExpire` creates virtual nodes. Counters: `expired_edges`, `dropped_spans` | Grafana time picker only; rates over `$__range`                                                             | Grafana Node Graph: data signature → **full re-layout on any topology change**, no position memory (`layout.ts`)                                                                 | Layered LR (MSAGL). Fixed radius 40. Grid view sorted by stat     |
| **OTel servicegraphconnector** | Collector, streaming                                                | `ttl` 2 s, `max_items` 1000. Evicts an expired head once, then drops. Series cache 15 min                                                | None                                                                                           | Same store as Tempo. A `pending` map handles span links (producer → consumers). Orphan server spans are dropped. Needs "all spans of a trace on the same instance"         | n/a (metrics)                                                                                               | n/a                                                                                                                                                                              | n/a                                                               |
| **Jaeger**                     | Backend batch / in-memory                                           | Badger: **newest 100 traces** in a 7-day lookback, silent. Memory: ring buffer, whole trace must sit inside the window                   | Implicit newest-N                                                                              | Whole trace in memory, linear parent scan                                                                                                                                  | **None**: 7-day lookback hidden ("no user-facing time-window UI")                                           | plexus/Graphviz in a worker; **full re-layout** when node count changes. Above 1200 nodes it asks for a focal service                                                            | "Focal service" chosen by hand; no traffic centre                 |
| **PostHog APM**                | Server, one ClickHouse query                                        | 2000 trace IDs (unordered `DISTINCT … LIMIT`), 200k spans, 1000 edges, 7-day window, 30 s timeout. **No truncated flag**                 | "Some" 2000 traces; likely biased by the sort key (UNVERIFIED)                                 | Self-join over the sampled IDs. Boundary parents are lost silently                                                                                                         | Caption "Built from N sampled traces", window only in the picker                                            | ELK layered in a worker; full re-layout; sorted input keeps it deterministic. Polls every 5 min                                                                                  | Callers on the left; fixed node size; edge width linear 1–6 px    |
| **SigNoz**                     | Ingest MV self-join, per-minute rows                                | Pre-aggregation only; no limit                                                                                                           | None                                                                                           | MV join scope UNVERIFIED (insert block vs table), so cross-batch pairs may be missed                                                                                       | Picker only; history of "last 1 min only" (#92, #433)                                                       | react-force-graph rebuilt every render → **jumps and flicker** (#1846, #1954); dagre rewrite abandoned (#11177)                                                                  | Radius by **incoming** rate (roots stay minimum and always green) |
| **Kiali**                      | Server, from Istio metrics (source and destination on every sample) | Namespace scope, manual refresh mode, server graph cache (1 GB cap)                                                                      | n/a (metrics)                                                                                  | No pairing needed                                                                                                                                                          | **Absolute range chip on the canvas** from the server's query timestamp, plus a "Last 1m, Every 1m" toolbar | dagre, deterministic; **same ID set → merge data, no layout**; changed set → reset, layout, refit (PF Topology regression: user zoom lost). Rejected position reuse (KIALI-1291) | Concentric layout ranked by degree; no traffic centre             |
| **Grafana Traces Drilldown**   | Client, one shot                                                    | 200 traces × 20 spans                                                                                                                    | Explicit sample                                                                                | Within each fetched trace                                                                                                                                                  | Caption: "aggregate view compiled using spans from multiple traces"                                         | n/a                                                                                                                                                                              | n/a                                                               |
| **Zipkin / Jaeger spark**      | Batch, per trace                                                    | Whole trace                                                                                                                              | n/a                                                                                            | `DependencyLinker` per trace, `firstRemoteAncestor`                                                                                                                        | n/a                                                                                                         | n/a                                                                                                                                                                              | n/a                                                               |

HyperDX and others are covered in R1 §2. Nothing new was found for the progressive angle.

### 2.2 Non-obvious lessons, per tool

**Tempo / OTel connector**

- The store is "read and let go" on purpose. `SetTraceID` copies bytes, and pooled `*Edge`s must not be retained.
- Wall-clock TTL makes sense only for a live stream. For backward paging, expiry should be measured in **scan distance**.
- Root server spans always wait the full `wait` before they are counted, so `user → svc` edges show up late.
- Their health counters (`expired_edges`, `dropped_spans`) exist only as backend metrics. **Kopai should show them in the UI.**
- tempo#6587: a 30 s tail-sampling delay made the whole graph disappear. Lateness allowances matter.
- Connector README: pairing breaks if the two sides of a call go to different instances. Kopai's backward and forward loops behave like two instances unless they **share one join buffer**.

**Jaeger**

- The UI shows "newest 100 traces from somewhere in 7 days" with no caption. That is exactly the PO's first page, and it is the top FAQ entry ("why is my dependencies page empty or incomplete").
- `dagMaxNumServices` compares against the number of **links**, not services (bug).
- jaeger-ui#1466: maintainers call stable or deterministic layout "mandatory".
- The DDG keeps full traces in the query cache (`useTraces`). That is the anti-pattern for us.

**Grafana Node Graph**

- `layout.ts:81-92` lays out hidden nodes too, so that "node position is stable"; moving visible nodes without animation "would be very weird".
- A heuristic signature can collide (possible cause of #100229, UNVERIFIED).
- The graph is cleared and redrawn on every refresh (#112117, open).
- Auto-fit on refresh conflicts with the user's viewport (#128622).
- `fixedX`/`fixedY` skips layout, so a data source that wants stability has to compute positions itself.
- The node limit is BFS from the roots, not traffic rank.

**PostHog**

- Every bound came from a review finding: sampled traces, the span budget, `max_execution_time`.
- The layout failure that looked like "no services" led to three separate error banners, each with a retry.
- `breakpoint()` discards superseded responses.
- The ELK worker is probed with a 5 s timeout because elk-api never rejects when the worker fails to load.

**SigNoz**

- Most of its filed bugs are about layout instability (new objects on every render reheat the force simulation).
- It shows no map unless at least two services are connected (#9600), which leaves single-service users with a blank page.
- A failed fetch leaves the spinner on forever (#13088).
- Encodings with no meaning: inverted particle speed, edge colour. The docs admit both mean nothing.
- Error rates are summed across nodes.

**Kiali**

- Detect structural change by comparing **sorted ID sets**. When only data changed, merge in place with no layout and no fit.
- Show the range taken from the data's timestamp, not the browser clock.
- "Idle edges" (traffic aged out of the window) are a separate state, off by default.
- It dropped force layouts (cola/cose) because they were slow and users thought it had hung (#1389, #4601).
- #7835: a new node added without layout landed on top of an existing node.
- The move to PatternFly Topology brought CPU and animation costs (#8520, #9701). It was done for console consistency, not rendering.

---

## 3. What Kopai's SDK and API actually give us

Facts come from the codebase scout and were spot-checked. Paths are relative to the repo root.

| Capability                              | Fact                                                                                                                                                                                                                                                                                             | Source                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchTracesPage`                      | POST `/signals/traces/search`. `limit` 1..1000 (default 100). `sortOrder` ASC/DESC (default DESC). Ordered by `(Timestamp, SpanId)`. `Timestamp` = span **start**                                                                                                                                | `sdk/src/client.ts:174-195`, `core/src/data-filters-zod.ts:99-105`, `sqlite-datasource/src/db-datasource.ts:405-409`, `clickhouse-datasource/src/query-traces.ts:341` |
| Cursor                                  | Opaque by contract. Actually `"<tsNs>:<spanId>"`, a stateless keyset with strict `<`/`>`, never expires                                                                                                                                                                                          | `db-datasource.ts:356-427`, `query-traces.ts:281-305`                                                                                                                 |
| Time filters                            | `timestampMin`/`timestampMax` are **inclusive** integer ns, so a half-open `[a,b)` is `min=a, max=b-1`                                                                                                                                                                                           | `data-filters-zod.ts:57-67`, `db-datasource.ts:346-349`                                                                                                               |
| Filters                                 | `serviceName`, single `spanKind` (no IN list), `parentSpanId`, …                                                                                                                                                                                                                                 | `data-filters-zod.ts`                                                                                                                                                 |
| Projection                              | **None** on `/search`. Raw-mode `dimensions` is "server may narrow", but both backends ignore it (`TRACE_RAW_SELECT`, `TRACE_FULL_COLUMNS`)                                                                                                                                                      | `clickhouse-datasource/src/query-kopai.ts:566-636`, `sqlite-datasource/src/query-builder.ts:474-476`                                                                  |
| `queryTracesRaw`                        | `limit` ≤ 10 000, needs `timeDimension`, `in`/`notIn` filters on any column (e.g. `SpanId IN`, `TraceId IN`). Cursor: ClickHouse keyset `ts:spanId`; **SQLite uses `ts:rowid`**                                                                                                                  | `sdk/src/client.ts:452`, `core/src/kopai-query.ts:1098-1170`, `query-builder.ts:411-428`                                                                              |
| `queryTracesAggregate`                  | GROUP BY `service.name`, `SpanKind`, semconv keys (`server.address`, `db.system.name`, `messaging.destination.name`) and `{container:"SpanAttributes", key:"peer.service"}`. COUNT, COUNT_DISTINCT, ERROR_RATE, THROUGHPUT. P50–P999 **ClickHouse only** (SQLite rejects them). **No self-join** | `client.ts:475`, `kopai-query.ts:107-110,208-245,370-383,691,791-810`                                                                                                 |
| `getServices()`                         | DISTINCT over a **fixed 7-day** lookback; no window, no counts                                                                                                                                                                                                                                   | `client.ts:395`, `query-traces.ts:9-21`                                                                                                                               |
| `searchTraceSummariesPage` + `getTrace` | Trace pages (≤1000) with `services[{name,count,hasError}]`. `getTrace` returns a whole trace (TraceId index on both backends)                                                                                                                                                                    | `client.ts:141,429`, `data-filters-zod.ts:318-351`                                                                                                                    |
| SDK transport                           | 30 s timeout, no retry, whole body `response.json()` plus zod, `signal` supported                                                                                                                                                                                                                | `sdk/src/request.ts:10,40-72`, `client.ts:159-168`                                                                                                                    |
| SQLite indexes                          | `(Timestamp, SpanId)`, `TraceId`, `ParentSpanId`. **No index on SpanId alone**                                                                                                                                                                                                                   | `sqlite-opentelemetry-ddl.sql:71-75`                                                                                                                                  |
| ClickHouse sort key                     | `ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))` (test DDL). Production partition/bloom filters UNVERIFIED in this repo (R1-P21)                                                                                                                                                        | `clickhouse-datasource/src/test/otel-ddl.ts:61`                                                                                                                       |
| UI data layer                           | `useKopaiData` = react-query keyed per params (`staleTime` 30 s, `gcTime` 5 min) → **would cache every page**. `useLiveLogs` calls the SDK directly with refs and a version counter, which is the pattern to copy                                                                                | `ui-core/src/hooks/use-kopai-data.ts:66-84`, `ui-core/src/hooks/use-live-logs.ts`, `ui-core/src/providers/kopai-provider.tsx:26-34`                                   |
| Existing graph                          | `TraceTimeline/GraphView.tsx`: hand-rolled SVG DAG for one trace (BFS layers), no pan/zoom, no stable positions. Service colours in `utils/colors.ts`                                                                                                                                            | `packages/ui/src/components/observability/TraceTimeline/GraphView.tsx`                                                                                                |
| Catalog / tab                           | Dashboard elements use a single `dataSource` → data prop. That does not fit a self-paging component. Tabs are in `ui/src/pages/observability.tsx:49-54`                                                                                                                                          | `ui-core/src/lib/observability-catalog.ts`, `ui-core/src/lib/renderer.tsx:195-230`                                                                                    |

**Hard constraints that follow**

- **C1. No join on the server.** Edges between instrumented services need span pairing on the client, or `getTrace` per trace.
- **C2. Each page carries full rows, about 1.5–3 MB per 1000 spans** (UNVERIFIED). Payload and zod parsing set the throughput, not memory. Parse in a worker.
- **C3. Backward keyset walks are stable.** No row repeats and there is no offset drift. **Rows inserted behind the cursor are never seen** (late parents). Exact duplicates are adjacent, and the strict cursor skips one that falls on a page boundary.
- **C4. No uniqueness on `(TraceId, SpanId)`.** Exporter retries create duplicate rows (R1-D21).
- **C5. Pages cost the backend.** SQLite runs synchronously and blocks ingest (R1-NFR3). ClickHouse re-sorts the window on every page, so `timestampMin` must **always** be sent. There is no server-side rate limit; the client has to throttle itself.
- **C6. Do not construct cursors.** Formats differ between `/search` and SQLite raw mode. Move between regions with time filters.
- **C7. `SpanKind` values are PascalCase** (`"Server"`, `"Client"`). The filter's description text says `SERVER`, which is misleading.

**Contradictions resolved**

- _"Cursor stability under inserts is UNVERIFIED"_ (Grafana report) versus _"stable, skips rows behind the cursor"_ (codebase scout and algorithm report). **We go with the scout:** the strict keyset predicates are in the cited code.
- _"Raw `dimensions` projection is honoured on ClickHouse (UNVERIFIED)"_ (critic) versus _"ignored on both"_ (scout). **We go with the scout:** it cites `TRACE_RAW_SELECT` usage at `query-kopai.ts:631-636`.
- _"Raw mode uses the same keyset"_ (scout) versus _"SQLite raw uses rowid"_ (critic, algorithm report). **Both are right:** ClickHouse uses `ts:spanId`, SQLite raw uses `ts:rowid` (verified at `query-builder.ts:411-428`). Hence C6.

---

## 4. Proposed algorithm

### 4.1 The original proposal: kept, adjusted, challenged

| PO proposal                                              | Verdict                                                                                         | Change                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only the existing SDK, no new endpoint or method         | **Kept**, read as including the existing `queryTracesAggregate` / `queryTracesRaw` / `getTrace` | Q1                                                                                                                                                      |
| Page of the N latest spans, then older pages             | **Kept**                                                                                        | Backward walk anchored at `T0 = now − L` (wall clock), with `timestampMin = now − M` always sent (C5)                                                   |
| Busiest service at the centre                            | **Kept, but defined and frozen**                                                                | Busiest = entry (Server/Consumer) span count from the aggregate, known on frame 1. Never re-centre automatically (Q5)                                   |
| Existing nodes don't move much                           | **Kept, hardened**                                                                              | Anchored radial layout, ≤40 px per update, layout only when the ID set changes (§5)                                                                     |
| Stop when the service set hasn't grown for 2 pages       | **Challenged**                                                                                  | Stop on coverage ≥ M, or budget, or (nodes **and** edges stable for K pages **and** coverage ≥ T_min **and** every aggregate-known service placed) (A6) |
| Poll the newest spans concurrently                       | **Adjusted**                                                                                    | Seal `[Wf, now − L)` with L ≈ 30 s; re-read the provisional tail `[now − L, now)` each poll and _replace_ it (A5)                                       |
| Order of spans doesn't matter                            | **Partly true**                                                                                 | True for counts. False for pairing and coverage (P10)                                                                                                   |
| State = oldest/newest ts + services + interaction counts | **Challenged**                                                                                  | Add (a) a bounded join buffer of tuples, (b) per-minute buckets, (c) a coverage interval set, (d) diagnostics counters. Still **no span rows** (Q2)     |
| Spans never retained                                     | **Kept**                                                                                        | Rows are reduced to tuples in the worker and dropped. Never routed through react-query (P8)                                                             |
| "Based on traces from the past M minutes"                | **Adjusted**                                                                                    | M is chosen by the user. The header shows **actual coverage** and the scan state (§5.3)                                                                 |

### 4.2 Decisions

- **A1, seed from the aggregate (if Q1 = yes).** Before any paging, run two calls over `[now − M, now]`:
  - Nodes: `dims [service.name, SpanKind]`, `COUNT`, `ERROR_RATE` (+ `P95` on ClickHouse). This gives the exact node set, node RED and the hub.
  - Virtual edges: `filter SpanKind in [Client, Producer]`, `dims [service.name, peer.service, db.system.name, messaging.destination.name, server.address]`, `COUNT`, `ERROR_RATE`. These are virtual and peer edges (R1-D3/D4/D6), with phantom-node filtering per R1-D3a (exclude a `server.address` that maps to a known service). Before relying on it, test that the dotted-attribute dimensions return the same results on SQLite and ClickHouse (UNVERIFIED).
- **A2, the edge rule.** Kind-agnostic: a child whose cross-service parent is found counts once, on the child (R1-D1, Zipkin/Jaeger/SigNoz convention). Self-calls are excluded (R1-D7).
- **A3, the join buffer** (the Tempo store, reduced):
  - `seen: spanId → {svc, kind, ts, endTs, hadXChild, peerId}`
  - `pending: parentSpanId → [{svc, kind, ts, err}]`
  - Both are capped (default `B = 50k` entries in total; about 5–8 MB, UNVERIFIED). They expire by **scan distance**, not wall clock.
  - Backward scan: children come first, so `pending` lives for horizon H (default 120 s) and `seen` only needs a skew pad (5 s).
  - Forward scan: the reverse.
  - A capacity eviction counts as `dropped` and is **never** turned into a virtual edge.
  - Key on `spanId` (64-bit random; collision ≈1e-10 at 50k). Use `traceId:spanId` if we want to tolerate weak ID generators.
- **A4, parent lookup (later; recovers long parents).** Once a `pending` child is older than the frontier minus H, batch its parent IDs into `queryTracesRaw({filters: [TraceId in […], SpanId in […]], timeDimension})`. Include `TraceId` so that SQLite uses `idx_otel_traces_trace_id`; there is no index on SpanId alone. Resolve, then drop the rows.
- **A5, regions and watermarks** (disjoint by construction, so no Bloom filter is needed):
  - Backward: DESC with `timestampMin = now − M`, `timestampMax = T0 − 1`, following its own cursor. Coverage = `[lastRowTs, T0)`.
  - Forward, every 5–10 s:
    - Page ASC over `[Wf, now − L − 1]` until there is no cursor, then `Wf ← now − L`.
    - Re-read `[now − L, now)` into a separate **provisional** aggregate, which _replaces_ the previous one.
  - Duplicates: skip a row whose `(Timestamp, SpanId)` equals the previous row's (O(1), C3).
  - **Watermarks come from the wall clock, never from data min/max** (protects against clock skew, P4). Spans with timestamps outside the region are clamped and counted as `badTimestamp`.
- **A6, the stop rule.** Stop backwards when **any** of these holds:
  - coverage reaches `now − M`
  - `spanBudget` (e.g. 200k) is spent
  - `timeBudget` (e.g. 60 s) is spent
  - `requestBudget` (e.g. 200 on SQLite) is spent
  - there is no cursor

  **Or** when **all** of these hold:
  - no new node and no new edge for K = 2 pages
  - coverage ≥ `T_min` (5 min, or all the data)
  - every node from the aggregate is placed (later: targeted `serviceName` probes for missing ones)

  Show the reason in the header. Offer **"Scan further"** afterwards.

- **A7, buckets and expiry.**
  - Per node and per edge, a ring of 1-minute buckets keyed by the child's start time: `{calls, errors, durSum, durN}`, plus a fixed log histogram later if p95 is needed.
  - Per-bucket coverage comes from the interval set.
  - Rate = Σcalls / Σcovered seconds.
  - Buckets older than `newestSealed − M` are dropped. An edge with no calls left fades for one refresh, then goes (Kiali "idle"; Q8).
  - Memory: 500 edges × 60 buckets × 4 numbers ≈ 1 MB.
- **A8, execution.**
  - A Web Worker owns a `KopaiClient` (`baseUrl` and headers passed in) and does fetch → zod → tuples → join → buckets.
  - It posts snapshots of at most about 1 per 750 ms: nodes, edges, rates, coverage, diagnostics.
  - At most 1 request in flight per direction, and **strictly serial on SQLite** with a ≥100 ms gap.
  - Adaptive page size targeting 300–800 ms per request.
  - One `AbortController` per run. Pause when the tab is hidden. If the hidden gap is longer than M, restart.

### 4.3 Pseudocode (worker)

```ts
// ---------- bounded state ----------
svcIds: Map<string, number>                                     // intern
seen:    CappedMap<SpanId, {svc, kind, ts, endTs, hadXChild, peerId}>
pending: CappedMap<SpanId /*parent*/, {svc, kind, ts, err}[]>
buckets: Map<NodeOrEdgeKey, Ring<minute, {calls, errors, durSum, durN}>>
coverage: IntervalSet<ns>                                        // sealed regions
provisional: Aggregate | null                                    // replaced each poll
diag = {dupes, dropped, lateUnpaired, virtualFromExpiry, resolvedByLookup, badTimestamp, orphans}
T0 = now() - L; Wf = T0; floor = now() - M; lastKey = null

function ingest(row, target = buckets):            // row unreachable after return
  if (row.Timestamp, row.SpanId) == lastKey: diag.dupes++; return
  lastKey = (row.Timestamp, row.SpanId)
  if row.Timestamp outside [floor, now()+skew]: diag.badTimestamp++; return
  s = intern(row.ServiceName)
  for c of pending.take(row.SpanId) ?? []:           // my children were waiting
    if c.svc != s: addEdge(target, s, c); markXChild(row.SpanId)
  if row.ParentSpanId == "": countEntry(target, s, row)          // R1-D8/D13
  else if (p = seen.get(row.ParentSpanId)):
    if p.svc != s: addEdge(target, p.svc, childOf(row)); p.hadXChild = true
  else pending.push(row.ParentSpanId, childOf(row)) || diag.dropped++
  if isDbClient(row): addVirtual(target, s, dbPeer(row))         // R1-D3/D4 short-circuit
  else seen.set(row.SpanId, tuple(row)) || diag.dropped++
  countNode(target, s, row)

function expire(backFrontier, fwdFrontier):
  for e of seen where e.endTs + SKEW < fwdFrontier and e.ts > backFrontier + SKEW:
    if e.kind in (Client, Producer) and !e.hadXChild and e.peerId:
      addVirtual(buckets, e.svc, e.peerId); diag.virtualFromExpiry++  // streaming R1-D3a
    seen.delete(e)
  for (pk, kids) of pending where min(kids.ts) - H > backFrontier:
    queueParentLookup(pk, kids) /* A4, later */ ; else diag.lateUnpaired += kids.length

async function backward(signal):
  cursor = undefined
  do:
    page = await sdk.searchTracesPage({timestampMin: floor, timestampMax: T0 - 1n,
              sortOrder: "DESC", limit: adaptiveN(), cursor}, {signal})
    for r of page.data: ingest(r)
    if page.data.length: coverage.add([page.data.at(-1).Timestamp, T0))
    expire(...); publishThrottled()
    cursor = page.nextCursor
  while cursor && !stopRule() && await pacing(signal)       // A6, A8

async function forwardTick(signal):                 // every 5–10 s, serial with backward on SQLite
  hi = now() - L
  for await r of sdk.searchTraces({timestampMin: Wf, timestampMax: hi - 1n, sortOrder: "ASC"}, {signal}): ingest(r)
  coverage.add([Wf, hi)); Wf = hi; floor = now() - M
  provisional = fresh(); for await r of sdk.searchTraces({timestampMin: hi, sortOrder: "ASC"}, {signal}):
    ingest(r, provisional)                          // probes seen read-only; budget-capped
  dropBucketsOlderThan(floor); coverage.trimBefore(floor); expire(...); publishThrottled()
```

The pseudocode is a sketch. In the provisional pass, use a separate throwaway pending/seen pair and probe the main `seen` read-only, so the provisional tail never mutates sealed state.

### 4.4 Fallback options if Q2 rejects any join state

| Option                                                      | Memory              | Edges                                                                                                          | Cost                                  |
| ----------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| (b) Attributes only (aggregate or per-span peer attributes) | 0                   | Caller-named peers: duplicate nodes (`orders` vs `orders.svc.cluster.local`), misses INTERNAL/unset-kind calls | 1–2 requests                          |
| (c) Summaries + `getTrace` per trace                        | One trace at a time | Exact per trace; no page-boundary loss                                                                         | N+1 requests; big traces cause spikes |
| (a) with B = 0                                              | 0                   | Loses every pair split across pages (≈ gap/page-span; e.g. 60% for a 300 ms gap at 2k spans/s)                 | 1 per page                            |

(c) is the cleanest way to honour "keep nothing across pages" exactly. Its weakness is request count, not correctness. It is a reasonable MVP if Q2 comes back "no".

---

## 5. Layout and UI

### 5.1 Library

**Recommended:** `@xyflow/react` 12 (≈60 kB gz) to render, plus `d3-force` 3 (≈5.8 kB gz) used headless for positions. About 66 kB gz in total, lazy-loaded.

**This changes R1-D20.** dagre has no incremental mode (one new edge can reshuffle a whole layer) and no notion of a centre. If the PO drops "busiest at centre" (Q6), go back to dagre LR, the industry default.

**Rejected:**

- cytoscape + fcose: +180 kB, draws to canvas, weak a11y.
- elkjs: 447 kB, EPL licence.
- WebCola: stale; Kiali dropped it.
- graphology/sigma: overkill for our scale.

**Fallback:** extend `GraphView.tsx` with custom SVG and the same d3 layout, if bundle size wins (R1-Q9).

### 5.2 Incremental anchored radial layout

The layout is a pure function `updateLayout(prev, snapshot)` in `packages/ui/.../ServiceMap/layout.ts`.

1. **Hub.** The busiest service per Q5, chosen on the first snapshot, ties broken by name. It is fixed at (0,0) with `fx`/`fy`. Re-centring needs one of:
   - a manual "Re-layout / Re-center" button, or
   - a suggestion pill shown after a challenger exceeds 1.5× the hub's weight for 3 or more updates.

   It **never** happens automatically. With an aggregate seed, the hub is correct from frame 1.

2. **Rings.** Undirected BFS hop distance from the hub. `R(k) = max(k·R0, n_k·labelW/2π)`. A node keeps its ring unless a shortcut lowers its distance by 2 or more. Disconnected and isolated services go on an outer band.
3. **New nodes** are placed in BFS order. Each is seeded at its strongest placed neighbour's angle ± `hash(name)` jitter (≤15°). The seed is never NaN, which would trigger phyllotaxis and a jump.
4. **Relax.** A warm pass of 60–100 ticks at alpha 0.3 (300 ticks on the first layout). Forces:
   - `forceRadial(R(ring))`
   - `forceCollide`
   - weak `forceLink`
   - `forceManyBody(-30)`
   - `forceX`/`forceY` anchors to the previous position (strength ≈0.6) for existing nodes. This is Brandes–Mader anchoring.

   Use a seeded `randomSource`. Afterwards, **clamp each existing node's movement to ≤ 40 px**.

5. **When the layout runs.** Only when the signature changes: the sorted node IDs plus edge pairs (Kiali). Count-only changes restyle edges and labels and never move anything. Layout runs at most once per second, and freezes once the backward scan stops.
6. **Motion.**
   - Tween store positions over 300–400 ms with rAF and `setNodes`. CSS transitions do not move edges (UNVERIFIED for RF12, general RF behaviour).
   - New nodes fade and scale in from their anchor neighbour.
   - Respect `prefers-reduced-motion`.
   - `fitView` once, and then only from a button. Show an "N new off-screen · fit" pill.
   - Never clear the canvas during an update (grafana#112117).
7. **Encodings.**
   - Node size fixed, or log-bucketed with fixed breakpoints, never normalised to a running max.
   - Edge width on a log scale.
   - Error colour bands at 1% and 5%, plus a non-colour cue.
   - Grey for low sample counts (< 20 calls).
   - Virtual nodes drawn in a distinct style.
   - Service hues from `getServiceColor`.
   - No particles.
   - Cap visible nodes at about 150, with "+N more" chosen by **traffic rank**, not BFS. Lay out all nodes, including hidden ones (Grafana rule).
   - Validate that every edge's endpoints exist before rendering (grafana#133391).

### 5.3 Header counter

The header shows coverage that is real, not the nominal window (Kiali chip pattern). It counts spans and edges, not "traces": our unit is spans, and a trace count would need COUNT_DISTINCT (which the aggregate seed could supply).

| State                                | Wording                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Scanning                             | `Service map · past 15 min · built from 42,180 spans, 14:21:07–14:36:07 (covers 9 min of 15) · scanning older…`   |
| Converged                            | `… 14:21:07–14:36:07 (15 min) · complete · last 30 s pending · updated 14:36:37`                                  |
| Stopped early                        | `… covers 6 min of 15 · stopped: span budget reached · [Scan further]`                                            |
| Diagnostics (tooltip or second line) | `312 calls could not be attributed (parent outside scanned range) · 18 duplicate spans skipped · 0 dropped (cap)` |
| Nodes seeded from the aggregate      | `Services and health: exact for 15 min · Connections: from sampled spans`                                         |

Times are local HH:MM:SS; the tooltip gives absolute dates and timezone. When the newest data is older than M, say so: `No spans in the past 15 min — newest span 3 days ago · [Show that range]`.

### 5.4 States

| State                                       | Behaviour                                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading (no data yet)                       | Skeleton, plus the header "Looking for spans…". If the aggregate seed is available, nodes render first                                                                               |
| Scanning                                    | Graph visible and growing; progress only in the header; never a canvas spinner                                                                                                       |
| Converged                                   | Layout frozen; forward poll continues; Pause/Live toggle (the `useLiveLogs` pattern)                                                                                                 |
| Single service                              | Draw one node, plus virtual DB/HTTP/queue edges, plus: "No calls between services found yet — the map needs ≥2 instrumented services or outgoing CLIENT spans" (SigNoz #9600 lesson) |
| No cross-service edges but several services | Draw the isolated nodes on the outer band with the same hint                                                                                                                         |
| Empty window                                | "No spans in the past M min." Offer a wider M, and the newest span's time                                                                                                            |
| Page fetch error                            | Keep the last good graph. Banner: "Couldn't load more spans · Retry". Back off. The spinner always stops                                                                             |
| Layout error                                | Separate banner. Fall back to the previous positions                                                                                                                                 |
| Truncated (caps hit)                        | "+N hidden" marker and a header note                                                                                                                                                 |
| Tab hidden                                  | Paused; on return, "Resumed — refreshing last X min"                                                                                                                                 |

---

### 5.5 Layout D at every scale (decision R2-9)

The layout must never break, and every node must stay reachable, from an empty window to hundreds of services. The scale check in the [layout mock-ups](https://claude.ai/artifact/9hBXUcqb7y1HSbuK76FABK) runs the algorithm below on 9 fixtures.

**Algorithm additions for scale**

- **Lanes.** A column holds at most `K = clamp(ceil(sqrt(N)), 6, 14)` rows, where N is the node count from the aggregate seed. A column that is full wraps into another lane on its outer side. Without lanes, a gateway with 150 callees becomes a column about 10,000 px tall.
- **Fit rule.** Fitting the view never zooms in past 100%, so a single node stays normal size. If the whole graph can only fit below a minimum scale (0.4 in the mock-up), the view opens centred on the hub instead, and zooming out shows everything.
- **Level of detail.** Labels hide when they would render below about 7.5 px. They come back on hover, on Find, and when you zoom in. Long names are cut to 20 characters with "…"; the full name is shown on hover.
- **Find.** Every node, including tray nodes, can be found by name. Finding one centres and highlights it. This is what makes "always visible" true for hundreds of nodes.
- **Tray.** The tray wraps into rows and shows its count ("Not connected to the map yet · 5"). Nothing in it is hidden.

**Measured on the mock-up's fixtures** (layout code run headless in Node; not a browser benchmark)

| Fixture                               | Nodes | Overlaps | Invalid positions | Moves across 5 steps  | Layout time |
| ------------------------------------- | ----- | -------- | ----------------- | --------------------- | ----------- |
| Empty                                 | 0     | 0        | 0                 | 0                     | 0 ms        |
| 1 service / 1 + DBs / 2 not connected | 1–4   | 0        | 0                 | 0                     | <1 ms       |
| Deep chain (15)                       | 15    | 0        | 0                 | 0                     | <1 ms       |
| Star (150 callees)                    | 156   | 0        | 0                 | **16, up to 170 px**  | 3 ms        |
| 120 services (generated)              | 143   | 0        | 0                 | **37, up to 170 px**  | 2 ms        |
| 400 services (generated)              | 473   | 0        | 0                 | **188, up to 510 px** | 9–10 ms     |

**Finding: lanes break the "never moves" rule.** When a column gains a lane, every column further out shifts sideways as a block. Relative positions stay the same, but this still conflicts with R2-3 and R2-8. See Q19.

**Test plan**

- **Property tests** (vitest plus `fast-check`, a new dev dependency) on the pure layout function, over random graphs of 0–600 nodes with random discovery order:
  - no NaN or infinite positions;
  - no two nodes closer than the minimum distance;
  - the hub is at (0,0) and never changes;
  - a placed node never moves, except a whole-column shift when a lane prediction was too low (Q19); the test tracks how many shifts happen on the generated fixtures and fails if that number goes up;
  - the output is the same for the same input;
  - layout time stays under a budget (e.g. 50 ms for 600 nodes) in CI.
- **Fixture tests** for the edge cases above, plus cycles, self-calls, a hub with only incoming calls, services with no connections at all, names longer than 60 characters, and a column that fills exactly to K.
- **Visual snapshots** of the same fixtures as Storybook stories in `packages/ui` (Storybook is already set up there), checked at desktop and phone widths in both themes.
- **Rendering performance.** At about 500 nodes and 900 edges, measure panning in React Flow with `onlyRenderVisibleElements`, and set a frame budget.

## 6. Requirements

### 6.1 Functional

**MVP**

- **R1.** A Service Map tab in `ui/src/pages/observability.tsx`. Window M is chosen by the user (5/15/60 min, default 15) and stored in the URL.
- **R2.** Data comes only from existing SDK methods (Q1 decides whether the aggregate methods count). No new route, no new SDK method.
- **R3.** Edges follow R1-D1: kind-agnostic, cross-service parent/child, counted once on the child. Self-calls are excluded.
- **R4.** Spans are paged backwards from `now − L` to `now − M`, with `timestampMin` always sent.
- **R5.** A forward poll every 5–10 s seals `[Wf, now − L)` and re-reads the provisional tail `[now − L, now)`.
- **R6.** Cross-page pairing uses a bounded join buffer (A3) shared by both directions.
- **R7.** Duplicate rows are skipped (adjacent-key rule) and counted.
- **R8.** Stop rule per A6. The stop reason is shown. "Scan further" is offered.
- **R9.** Per-minute buckets. Counts older than M expire. Rates = calls / covered seconds.
- **R10.** The header shows actual coverage, span count, scan state and the provisional tail (§5.3).
- **R11.** Diagnostics are visible: unattributed, duplicates, dropped by cap, bad timestamps.
- **R12.** Busiest service at the centre, chosen once, with a manual Re-center.
- **R13.** Existing nodes move ≤ 40 px per update. Layout runs only on a structural change. The canvas is never cleared during an update.
- **R14.** Single, isolated and empty states per §5.4.
- **R15.** Errors keep the last good graph and offer Retry. The spinner always ends.
- **R16.** Clicking a node or edge opens the existing trace search, filtered by service (and parent/child services for an edge) over the covered range.
- **R17.** Pause/Live toggle. Pause when the tab is hidden.

**Later**

- **R18.** Aggregate seed (A1): exact nodes, node RED and virtual/peer edges on frame 1. _Promote to MVP if Q1 = yes._
- **R19.** Parent lookup through `queryTracesRaw` (A4) for long-running parents.
- **R20.** Targeted `serviceName` probes for aggregate-known services that have no edges yet.
- **R21.** Virtual nodes from expired unpaired CLIENT/PRODUCER spans (streaming R1-D3a).
- **R22.** Edge p95 through a fixed log histogram per bucket.
- **R23.** Messaging edges through `messaging.destination.name` (and links), per R1-D6.
- **R24.** "Re-center suggestion" with hysteresis. Highlight newly added nodes.
- **R25.** Trace overlay: highlight one trace's path on the map (Kiali pattern).
- **R26.** Dashboard catalog component (self-fetching, no `acceptsDataFrom`).
- **R27.** Filters (environment/resource) applied to both ends of an edge (R1-P11).

### 6.2 Non-functional

- **NFR1. No span rows retained.** Retained heap is bounded by the join-buffer cap plus the buckets plus the layout state. Test: heap snapshot after 100 pages and after a 30-minute synthetic run, with flat growth.
- **NFR2. Join buffer ≤ 50k entries (configurable).** Evictions are counted, never silent.
- **NFR3. Backend etiquette.**
  - At most 1 request in flight per direction.
  - Strictly serial on SQLite with a ≥100 ms gap.
  - Adaptive page size.
  - Exponential backoff on error or slow responses.
  - Per-run request and span budgets.
- **NFR4. Ingest must not regress on SQLite.** Benchmark: ingest p99 with one map session active stays within +X% of the baseline (X to be set in the grill).
- **NFR5. Off the main thread.** Fetch, parse and pairing run in a Web Worker. Snapshots ≤ 2/s. No main-thread task over 50 ms caused by the map.
- **NFR6. Deterministic layout.** The same snapshot sequence gives the same positions (seeded random, sorted iteration). Layout of 150 nodes takes under 15 ms.
- **NFR7. Bundle:** ≤ 80 kB gz lazy chunk (R1-NFR7).
- **NFR8. Cancellation.** Changing the window or filters, or unmounting, aborts everything. StrictMode double-mount must not start two loops.
- **NFR9. Accessibility.** Nodes are focusable buttons. Health is never shown by colour alone. Reduced motion is respected (R1-NFR9).
- **NFR10. Cardinality caps:** ≤ 200 nodes and ≤ 1000 edges kept; the rest folds into "Other" (R1-NFR4).
- **NFR11. Both backends** must pass the same integration tests: SQLite plus ClickHouse testcontainers.

---

## 7. Implementation tips and pitfalls

These are new beyond R1-P1…P26.

| #   | Pitfall                                            | Failure scenario                                                                                                                                                  | Mitigation                                                                               |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1  | No state across pages                              | At 2k spans/s a page spans 0.5 s. A→B with a 300 ms gap is split about 60% of the time. Busier systems show **fewer** edges                                       | Join buffer (A3)                                                                         |
| P2  | Start-time watermark on the forward poll           | A 20 s request in A is inserted at t+20 s with `Timestamp = t`. The poll is already at t+5 s, so A→B is never counted                                             | Wall-clock seal at `now − L`, provisional tail, parent lookup (A4)                       |
| P3  | Stop after 2 stable pages                          | One service produces 50 INTERNAL spans per request and fills pages 1–4. A cron job F (every 5 min) never appears, and the header says "complete"                  | A6 + aggregate node list                                                                 |
| P4  | Watermark taken from data maxima                   | Service C's clock runs 5 min fast. `newest` jumps ahead, and every poll returns only C until the wall clock catches up. A zero timestamp turns "oldest" into 1970 | Wall-clock regions, clamping, `badTimestamp` counter                                     |
| P5  | Counts never expire                                | A tab left open for 8 h shows lifetime averages. An outage 30 s ago is invisible                                                                                  | Bucket ring (A7)                                                                         |
| P6  | Coverage holes                                     | The tab sleeps for 10 min and the poll misses that span of time, but min/max still claims full coverage                                                           | Interval set. Mark the gap missing or re-scan it                                         |
| P7  | Overlap double count                               | Forward and backward both read `T0`, or an inclusive `timestampMax` re-reads a boundary row                                                                       | Half-open regions as `max = b − 1`. One `T0` shared by both loops                        |
| P8  | Paging through `useKopaiData` / `useInfiniteQuery` | Every page stays in the react-query cache for 5 min, adding hundreds of MB                                                                                        | Call the SDK directly in a worker (`useLiveLogs` pattern)                                |
| P9  | Constructed cursors                                | A forward cursor built as `ts:spanId` breaks on SQLite raw mode (`ts:rowid`) or after a format change                                                             | Time filters only. Treat cursors as opaque                                               |
| P10 | "Order doesn't matter"                             | Pairing needs the buffer to hold the side that arrives first: children going backward, parents going forward                                                      | Symmetric buffer that expires in each direction                                          |
| P11 | Capacity eviction turned into a virtual node       | A burst overflows the buffer, and evicted CLIENT spans become phantom `db`/`external` nodes                                                                       | Only _natural_ expiry creates virtual edges. Capacity eviction only increments `dropped` |
| P12 | Hub recomputed per page                            | Page 1 is dominated by a health-check service. Page 3 finds the real gateway, and the whole map rotates and rescales                                              | Hub from the aggregate on frame 1, frozen, manual re-centre                              |
| P13 | Size normalised to the running max                 | Every page rescales every edge, so the map "breathes" during the scan                                                                                             | Log scale with fixed breakpoints                                                         |
| P14 | Full re-layout on new node (Grafana/Jaeger/Kiali)  | Each page that adds one service makes the whole graph jump                                                                                                        | Anchored incremental layout, clamped                                                     |
| P15 | Adding a node without layout (Kiali #7835)         | The new node lands on top of an existing one                                                                                                                      | Seed next to its neighbour plus a collide force                                          |
| P16 | Auto-fit on every update                           | The user zooms into a cluster, the next page refits, and the user loses their place                                                                               | Fit once, then a button or pill only                                                     |
| P17 | Main-thread zod on 3 MB pages                      | 100–300 ms jank per page, and the map stutters while panning                                                                                                      | Worker (NFR5)                                                                            |
| P18 | Two loops hammering SQLite                         | Backward and forward requests plus parsing on the API event loop raise ingest latency, and OTLP clients retry, causing more duplicates                            | Serial scheduler, gap, budgets, benchmark (NFR4)                                         |
| P19 | ClickHouse first page without `timestampMin`       | A full-table top-N sort hits the 30 s timeout on page 1                                                                                                           | Always send `floor = now − M`                                                            |
| P20 | StrictMode double effects                          | Two workers page in parallel and counts double                                                                                                                    | Single-flight guard keyed by run ID; abort on cleanup                                    |
| P21 | Rates over nominal M                               | A 2-minute burst inside a 60-minute window shows ≈0 r/s (R1-Q21)                                                                                                  | Divide by covered seconds; show counts in the tooltip                                    |
| P22 | High-cardinality `service.name` (pod names)        | Rolling deploys add new names every few minutes, and S² edges grow in a long session                                                                              | Caps, bucket expiry, a "looks like pod names" diagnostic                                 |
| P23 | Nodes and edges from different populations         | Exact node RED from the aggregate next to sampled edge counts look inconsistent: an edge shows more calls than the node                                           | Label edges "sampled". Never compare them numerically. Edge rate is coverage-scaled      |
| P24 | `spanKind` filter is single-valued and PascalCase  | `spanKind: "SERVER"` silently matches nothing                                                                                                                     | Use `"Server"`, or raw mode `in` filters                                                 |
| P25 | Hidden-tab timers                                  | Chrome throttles chained timers after 5 min hidden. Polls bunch up and coverage gets holes                                                                        | `visibilitychange` pause; on resume, re-scan or restart                                  |

---

## 8. Grilling session

Each question has its options, the recommended answer and the reason.

**Q1. Does "only the usual SDK" include `queryTracesAggregate`, `queryTracesRaw` and `getTrace`?** — ✅ **Decided, see §0**

- Options: (a) only `searchTracesPage`; (b) any existing SDK method.
- **Recommend (b).** They are existing methods on existing routes. With them, nodes, node RED, the busiest service and virtual edges are exact on frame 1, the stop rule gets a ground truth, and paging is needed only for service-to-service edges. Without them, every number on the map is a sample.

**Q2. Is a bounded, time-evicted `spanId → service` tuple index "storing spans"?** — ✅ **Decided, see §0**

- Options:
  - (a) Yes: forbid it, accept a biased loss of cross-page edges.
  - (b) No: allow ≤B tuples for ≤H scan distance, with loss counters.
  - (c) Avoid it with summaries + `getTrace` per trace.
- **Recommend (b).** It is about 100 B per entry against 2 KB per span. Every streaming tool does it (Tempo, connector). Without it, the busier the system, the fewer edges it shows.
- Fallback to (c) if the PO insists. It is exact, but costs N+1 requests.

**Q3. What is M: chosen by the user, or derived from where discovery stopped?** — ✅ **Decided, see §0**

- Options: (a) derived (`now − oldestConsumed`); (b) chosen by the user, with coverage shown.
- **Recommend (b).** With (a), M depends on throughput and changes between reloads (7 s now, 3 min later), which makes the label meaningless.

**Q4. What is the stop rule?** — ✅ **Decided, see §0**

- Options:
  - (a) the PO rule (services stable for 2 pages);
  - (b) A6 (coverage, budgets, nodes **and** edges stable **and** T_min **and** aggregate nodes placed);
  - (c) always scan the full M.
- **Recommend (b).** Rule (a) stops on the chattiest service's sub-second slice. Rule (c) can be thousands of requests on busy ClickHouse.

**Q5. How is "busiest" defined, and when can the centre change?** — ✅ **Decided, see §0**

- Options: span count; entry (Server/Consumer) spans; calls in+out; degree.
- **Recommend entry-span count from the aggregate, frozen after frame 1, manual re-centre only.** Span count rewards verbose instrumentation. Incoming-only makes roots tiny (SigNoz). The aggregate makes the hub correct before paging starts, so it never has to move.

**Q6. Radial "busiest at centre", or layered left-to-right?** — ✅ **Decided: layout D, centred flow (R2-8)**

- Every reference tool chose layered LR, because direction reads naturally. Radial hides direction (arrows must carry it) but shows centrality.
- **Recommend radial for the MVP, as the PO asked**, using d3-force + React Flow and keeping the layout function swappable. Revisit after dogfooding. This decides the library: d3-force vs R1-D20's dagre.

**Q7. Sliding window or cumulative since the tab opened?** — ✅ **Decided, see §0**

- **Recommend sliding with per-minute buckets (A7).** A cumulative map hides current incidents, and min/max cannot describe gaps. The cost is about 1 MB.

**Q8. Do aged-out edges fade or vanish?** — ✅ **Decided, see §0**

- **Recommend: fade for one refresh, then remove, but keep their positions reserved for a while** so a returning edge or node lands in the same place. This conflicts slightly with "nodes don't move", so decide it explicitly.

**Q9. What are L (lateness/provisional tail) and H (pairing horizon)? Fixed or configurable?** — ✅ **Decided, see §0**

- **Recommend L = 30 s** (Tempo slack default), with the tail shown dimmed as "last 30 s pending". **H = 120 s**, and later `max(60 s, observed p99 duration)`. Long parents are recovered by A4 (later).

**Q10. Exact edge counts or sampled/relative?** — ✅ **Decided, see §0**

- If edge counts must be exact for the whole of M on busy systems, client paging cannot deliver that cheaply (≈1800 requests for 15 min at 2k spans/s, UNVERIFIED estimate).
- Options:
  - (a) accept sampled, coverage-scaled edge rates labelled "estimated";
  - (b) **revisit "no new endpoint" minimally**: add a derived `parent.service.name` dimension to the existing KopaiQuery trace aggregate. That is a server self-join behind the **existing** `/signals/query/traces/aggregate` route, with no new route and no new SDK method;
  - (c) a new endpoint (R1).
- **Recommend (a) for the MVP and keep (b) as the planned upgrade.** (b) needs compiler and datasource work and is bound by SQLite cost (R1-NFR1/NFR3).

**Q11. What request and byte budget per session is acceptable on SQLite while it ingests, and who owns the benchmark?** — ✅ **Decided, see §0**

- **Recommend** strictly serial requests, ≥100 ms gap, ≤200 requests per run, ≤1000 rows per page, plus a CI benchmark for ingest p99 (NFR4).
- **Recommend one shared session per tab, not per dashboard widget** (critic L4: no server cache is shared).

**Q12. Are virtual nodes (DB, external, queue) in the MVP?** — ✅ **Decided, see §0**

- **Recommend yes, from the aggregate seed.** That is cheap and exact. Pairing alone never produces them, and a single-service app would otherwise show one lonely node.

**Q13. Are messaging edges through span links in scope?** — ✅ **Decided, see §0**

- **Recommend no for the MVP.** Links point into other traces at arbitrary times, so a bounded H rarely resolves them. Later, use `messaging.destination.name` on both sides (R1-D6).

**Q14. Is a Web Worker acceptable (build config, SDK in a worker, auth headers)?** — ✅ **Decided, see §0**

- **Recommend yes.** MBs of zod parsing per page on the main thread would make the map stutter. Check that the ui package's bundler supports `new Worker(new URL(...))`.

**Q15. Show the provisional tail, or hide it?** — ✅ **Decided, see §0**

- **Recommend show it, dimmed, with a label.** Hiding it makes the "live" map lag by 30 s with no explanation.

**Q16. Node and edge caps, and what "+N more" means.** — ✅ **Decided, see §0**

- **Recommend** ≤150 visible nodes and ≤200 kept. Hide by lowest traffic rank. Lay out hidden nodes too.

**Q17. What does a first-run, single-service user see?** — ✅ **Decided, see §0**

- **Recommend** one node with RED, its virtual DB/HTTP edges, and an explanatory hint. Never a blank page (SigNoz #9600).

**Q18. How do clock skew and bad timestamps (future, zero) get handled?** — ✅ **Decided, see §0**

- **Recommend** clamp to the region, count as a diagnostic, never let them move watermarks.

**Q19. Lanes and movement at scale.** — ✅ **Decided, see §0** When a column wraps into a new lane, columns further out shift as a block (188 moves at 400 services).

- Options:
  - (a) Accept block shifts, animated, because relative positions are kept.
  - (b) Reserve lanes up front from frame 1: hub fan-out plus tray size predicts column load. Shifts become rarer but there is more empty space.
  - (c) Let columns grow taller instead of wider. Nothing moves, but the map gets very tall.
- **Decided: (b) + (a)**: predict the lanes, and when the prediction is wrong, do an animated block shift.

**Q20. Grouping at hundreds of services.** — ✅ **Decided, see §0** Should services group by `service.namespace` (Kiali-style boxes), or should nodes with identical connections collapse ("37 jobs → postgres")?

- **Recommend not in the MVP.** Lanes, level of detail and Find handle 500 nodes. Revisit when grouping data exists.

### The design critic's sharpest challenges, condensed

1. "Read and let go" plus "only counts" **cannot** produce correct service-to-service edges. Either allow tuple state (Q2) or switch to per-trace fetches.
2. The stop rule measures the noisiest service, not the system (Q4).
3. Forward polling from the newest start time is **permanently lossy** (P2), and data-derived watermarks freeze under clock skew (P4).
4. Covering a real M-minute window by shipping full rows costs orders of magnitude more than an aggregate. The existing aggregate route already answers most of the map, so the real question is whether to add one derived dimension to it (Q10b).

---

## 9. Sources

**Earlier Kopai research:** `docs/service-map/research.md` (R1). Its §2 has the full tool table and sources for HyperDX, Grafana, SigNoz and Kiali.

**Kopai code**

- `packages/sdk/src/{client.ts,pagination.ts,request.ts}`
- `packages/core/src/{data-filters-zod.ts,denormalized-signals-zod.ts,kopai-query.ts,kopai-query-compiler.ts}`
- `packages/sqlite-datasource/src/{db-datasource.ts,query-builder.ts,sqlite-opentelemetry-ddl.sql}`
- `packages/clickhouse-datasource/src/{query-traces.ts,query-kopai.ts,datasource.ts,test/otel-ddl.ts}`
- `packages/api/src/routes/{traces.ts,query.ts}`
- `packages/ui-core/src/{hooks/use-kopai-data.ts,hooks/use-live-logs.ts,providers/kopai-provider.tsx,lib/observability-catalog.ts,lib/component-catalog.ts,lib/renderer.tsx}`
- `packages/ui/src/components/observability/{TraceTimeline/GraphView.tsx,utils/colors.ts}`
- `packages/ui/src/pages/observability.tsx`

**Grafana / Tempo**

- Tempo source: `grafana/tempo` `modules/generator/processor/servicegraphs/{servicegraphs.go,config.go,store/store.go,store/edge.go}` and `modules/generator/config.go` (commit `0d1800ae`)
- Grafana source: `grafana/grafana` `public/app/plugins/panel/nodeGraph/{layout.ts,layeredLayout.js,forceLayout.js,useNodeLimit.ts,NodeGraph.tsx,Node.tsx}` (commit `79abb094`)
- Grafana Traces Drilldown: `StructureScene.tsx`
- Docs:
  - https://grafana.com/docs/tempo/latest/troubleshooting/metrics-generator
  - https://grafana.com/docs/tempo/latest/metrics-from-traces/service_graphs/
  - https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/
- Issues: grafana#112117, #100229, #128622, #68540, #133391; PR #78957; tempo#6587

**OTel collector:** `open-telemetry/opentelemetry-collector-contrib` `connector/servicegraphconnector/{connector.go,factory.go,internal/store/store.go,README.md}` (commit `c8390e10`); contrib#36613, #19764.

**Jaeger**

- Backend: `jaegertracing/jaeger` `internal/storage/v1/badger/dependencystore/storage.go`, `internal/storage/v2/memory/tenant.go`
- UI: `jaegertracing/jaeger-ui` `components/DependencyGraph/*`, `hooks/useDependenciesQuery.ts`, `model/ddg/transformTracesToPaths.ts`, `plexus/src/LayoutManager/*`
- Issues: jaeger#5910, #5911; jaeger-ui#1081, #1466
- `jaegertracing/spark-dependencies` `DependenciesSparkHelper.java`

**Zipkin:** https://github.com/openzipkin/zipkin/blob/master/zipkin/src/main/java/zipkin2/internal/DependencyLinker.java

**PostHog**

- Source: `products/apm/backend/logic/health/sources.py`, `products/apm/backend/presentation/views.py`, `products/apm/frontend/{serviceMap.ts,ServiceMapTab.tsx,ServiceMapNode.tsx,applicationObservabilityLogic.ts}`, `frontend/src/lib/elk.ts`, `posthog/clickhouse/traces/spans.py` (commit `99e258df`)
- PR: https://github.com/PostHog/posthog/pull/123559

**SigNoz**

- Frontend: `frontend/src/modules/Servicemap/{ServiceMap.tsx,Map.tsx,utils.ts}`, `frontend/src/store/actions/serviceMap.ts`
- Backend: `pkg/query-service/app/clickhouseReader/reader.go:860-911`
- Collector: signoz-otel-collector `cmd/signozschemamigrator/schema_migrator/traces_migrations.go`
- Docs: https://signoz.io/docs/userguide/service-map/
- Issues: #92, #103, #114, #142, #151, #433, #910, #1161, #1457, #1667, #1846, #1954, #4096, #7929, #9600, #9878, #13088; PR #11177

**Kiali**

- Source: `kiali/kiali@035e037` `frontend/src/pages/Graph/{GraphPage.tsx,Graph.tsx,GraphScore.ts}`, `frontend/src/helpers/GraphHelpers.tsx`, `frontend/src/components/Time/TimeDurationIndicator.tsx`, `graph/{graph_cache.go,refresh_job.go,appender.go}`. Cytoscape implementation at `v2.4.0`
- Docs: https://kiali.io/docs/faq/graph/
- Issues: #1389, #1524, #2957, #4601, #7030, #7770, #7785, #7835, #8053, #8230, #8520, #8871, #9701, #10053

**Layout**

- Library docs:
  - https://d3js.org/d3-force/simulation
  - https://github.com/iVis-at-Bilkent/cytoscape.js-fcose
  - https://eclipse.dev/elk/reference/options/org-eclipse-elk-interactive.html
- Bundle sizes: bundlephobia API, fetched 2026-11-06
- Papers:
  - Frishman & Tal, _Online Dynamic Graph Drawing_, IEEE TVCG 14(4), 2008: https://hgpu.org/?p=1976
  - Brandes & Pich, _More Flexible Radial Layout_, JGAA 15(1), 2011: https://jgaa.info/index.php/jgaa/article/view/paper221
- Cited from memory, not re-fetched (UNVERIFIED):
  - Misue et al., _Layout adjustment and the mental map_ (1995)
  - Brandes & Wagner (GD'97)
  - Brandes & Mader (GD 2011)
  - Purchase et al. (GD 2006); Archambault & Purchase (2013/2016)
  - Beck et al. (CGF 2017)

**Stream processing / estimation** (cited from general knowledge, UNVERIFIED)

- Akidau et al., _The Dataflow Model_, VLDB 2015
- Flink "Timely Stream Processing" docs
- Good (1953), _Biometrika_ 40
- Chao (1987), _Biometrics_ 43. This is the basis for an optional "≈N more connections likely" hint, which is not a stop rule.

**Other:** https://oneuptime.com/blog/post/2026-08-30-why-is-grafanas-service-graph-empty-even-though-beyla-traces-reach-tempo/markdown
