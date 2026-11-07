# Service Map: requirements and implementation research

Status: draft for the grilling session · Date: 2026-11-05 · Branch: `service-map`

Constraints already decided (not up for debate here, but see Q1 for the consequences):

- **C1.** The graph is computed **at query time** from stored spans. There is no ingest-time pre-aggregation and no collector connector state. It must work on **both SQLite and ClickHouse**.
- **C2.** It appears as a **standalone UI page** and as a **dashboard component in the ui-core catalog**.

Reference IDs: **R#** = requirement, **NFR#** = non-functional requirement, **D#** = design decision, **Q#** = open question, **P#** = pitfall. Anything not backed by source code or docs in the research reports is marked **UNVERIFIED**.

---

## 1. TL;DR

- **What everyone else does.** Grafana/Tempo, the OTel `servicegraphconnector`, SigNoz and Uptrace pair spans **at ingest time** into metrics or materialized views. Jaeger (in-memory/Badger), **PostHog** (new, behind a feature flag) and **HyperDX** compute **at query time** with a parent/child self-join. That is the design Kopai has chosen, so PostHog and HyperDX are the nearest references. Kiali builds its graph from Istio metrics and uses traces only as an overlay.
- **Core algorithm (D1).** A single self-join: `child.TraceId = parent.TraceId AND child.ParentSpanId = parent.SpanId AND parent.ServiceName != child.ServiceName`, with the edge counted **once, on the child span**. Span kind is **not** required to create an edge (as in Jaeger, SigNoz and PostHog). Span kind is used for metric attribution and for diagnostics ("caller had no CLIENT span").
- **Virtual nodes (D3).** A `Client`/`Producer` span with no cross-service child becomes an edge to an inferred node. The node is named by a fixed priority list of `peer.service` / `db.*` / `messaging.*` / `server.address`, and typed as `database | messaging | external`. Node IDs are namespaced (`db:postgresql/orders`) so they never collide with real services. Kopai can beat PostHog and SigNoz here; both are criticised for not doing it.
- **Metrics.** Per edge: calls, errors (either side `StatusCode = Error`), rate, and **real p50/p95/p99** on the server side, plus client-side latency when a client span exists. Per node: RED metrics from the service's own SERVER/CONSUMER spans, falling back to root spans (PostHog). Never sum percentages (SigNoz bug).
- **Isolated services are always shown (R5).** A one-service app is Kopai's most common first experience, and SigNoz's empty map is a top complaint.
- **Kopai's differentiator (R14): instrumentation diagnostics.** Show counts and drill-down for orphan server spans, client spans with no peer attribute, INTERNAL-only services, missing CLIENT spans, and empty `service.name`. Tempo and the connector count these internally but hide them.
- **Architecture (D14, D15).** SQL returns flat aggregate rows (edges and nodes). A **shared pure TypeScript builder in `@kopai/core`** turns them into the graph: IDs, virtual nodes, health, focus/depth. The two datasources therefore differ only in SQL, and golden tests run the same fixtures against both.
- **API (D16).** `getServiceGraph(filter)` on a new optional interface `ReadServiceGraphDatasource`, exposed as `POST /signals/traces/service-graph`, plus SDK, `useKopaiData` method, ui-core `ServiceMap` component and later an MCP tool.
- **UI (D20).** `@xyflow/react` + `@dagrejs/dagre`, left-to-right layered layout, lazy-loaded (about 76 kB gz). No force layout and no particle animation by default. Kiali and SigNoz both regret theirs. The alternative is to extend the hand-rolled SVG `GraphView` that already exists for single traces (Q9).
- **Biggest risks.** SQLite queries are synchronous and **block the event loop and therefore ingest** (NFR3). On ClickHouse Kopai **cannot add indexes**, because the exporter owns the schema. Percentiles must match across the two backends.
- **Derivation traps found in review (see D3a, D6, D11, D13, D21).** Nested CLIENT spans (an HTTP-library span wrapped in an SDK span) and client spans that call back into their own service would create **phantom virtual nodes** under the original "no cross-service child" rule. Messaging `receive` spans are CLIENT kind and point the wrong way. Neither table has a uniqueness constraint, so **re-sent OTLP batches duplicate spans** and multiply join rows. Parents of in-progress traces arrive _after_ their children (a span is exported when it ends), so a live test run shows transient orphans and missing edges.

---

## 2. How the industry does it

### 2.1 Comparison

|                                       | Data source                              | Edge derivation                                                                                                                      | Compute time                                                                                                                                                             | Edge metrics                                                                                | Node metrics                                                             | Virtual nodes                                                                             | UI lib / layout                                                             | Drill-down                                                         |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Grafana / Tempo** metrics-generator | Spans → Prometheus series                | CLIENT/PRODUCER span paired with its **direct** SERVER/CONSUMER child, keyed `(traceId, clientSpanId)`                               | **Ingest** (in-memory store, `wait` 10s, `max_items` 10k), query = 4 PromQL instant queries (each with a companion `group by` `_labels` query used for `isInstrumented`) | request total, failed total, client and server latency histograms, opt-in messaging latency | Sum of **incoming** edges (server side only); arc = success/failed ratio | `user` for root servers; peer attrs → uninstrumented server; DB short-circuit             | Custom SVG Node Graph; MSAGL Sugiyama (default), d3-force, grid; web worker | Context menu → PromQL rate/p90, TraceQL search                     |
| **OTel `servicegraphconnector`**      | Spans → metrics                          | Same as Tempo, plus **span-link** consumer correlation (one edge per link, cross-trace)                                              | **Ingest** (`ttl` 2s, `max_items` 1000)                                                                                                                                  | Same as Tempo, `failed` as a label                                                          | none                                                                     | `user` (root only), peer attr → server, else `unknown`; messaging edges never virtualised | n/a                                                                         | n/a                                                                |
| **Jaeger** in-memory/Badger           | Stored spans                             | Any parent/child pair whose service differs, **kind ignored**, self-calls skipped                                                    | **Query** (brute force; Badger uses only **100 traces**)                                                                                                                 | `callCount` only                                                                            | none                                                                     | none                                                                                      | plexus + Graphviz WASM (`dot` / `sfdp`)                                     | Node menu: "Set focus", "View traces"                              |
| **Jaeger** Cassandra/ES/CH            | Spark job → daily snapshots              | Shared-span + references, leaf `peer.service`                                                                                        | **Batch** (daily), nothing writes it for CH                                                                                                                              | `callCount`                                                                                 | none                                                                     | Leaf `peer.service` only                                                                  | same                                                                        | same                                                               |
| **SigNoz**                            | CH MVs → `dependency_graph_minutes_v2`   | Cross-service parent/child, **kind ignored**, join on `span_id` only; + `db.system`, `messaging.system`                              | **Ingest** (MV per insert block, likely same-batch only, UNVERIFIED)                                                                                                     | p50–p99 (callee), callCount, callRate, errorRate %                                          | Frontend, from incoming edges, **sums %** (bug)                          | Only one node per `db.system` / `messaging.system`                                        | `react-force-graph-2d` canvas, d3-force                                     | **None** (hover only)                                              |
| **Kiali**                             | Istio Prometheus metrics                 | `istio_requests_total` source/dest labels, dedup of double reporting                                                                 | **Query** (instant PromQL over range)                                                                                                                                    | per-protocol rps, 3xx/4xx/5xx, %err, %share, one latency quantile                           | Summed from edges; server-side health with tolerances                    | `unknown` source, ServiceEntry, Passthrough, out-of-mesh                                  | PatternFly Topology (was Cytoscape), dagre LR                               | Side panel, node graph, traces tab, trace overlay                  |
| **PostHog** (flagged, unreleased)     | `trace_spans` (CH)                       | Cross-service parent/child, **kind ignored**, counted on callee                                                                      | **Query** (first 2000 trace IDs, 200k span budget, 1000 edges)                                                                                                           | calls, error_count (callee), p95 (callee), sampled                                          | Separate unsampled query on SERVER/CONSUMER, root fallback; 1%/5% bands  | **None** (explicitly out of scope)                                                        | `@xyflow/react` + `elkjs` layered RIGHT, worker                             | Details panel: Called by / Calls, links to Endpoints, Traces, Logs |
| **HyperDX**                           | `otel_traces` (CH, same schema as Kopai) | `ServerSpans` LEFT JOIN `ClientSpans` on parent; kind-strict                                                                         | **Query**, `cityHash64(TraceId) % N` sampling, counts scaled                                                                                                             | quantiles(0.5,0.95,0.99)                                                                    | `GROUPING SETS` in the same pass                                         | Uninstrumented callers only in node totals                                                | React Flow + dagre LR                                                       | Metric switcher, SQL preview, per-trace map                        |
| **OpenObserve**                       | Stored traces → scheduled SQL → metrics  | Child kind ∈ (Internal, Server, Consumer) with parent kind ∈ (Client, Producer), on a trace-suffix sample; learns peer→service table | **Scheduled rollup**                                                                                                                                                     | `traces_service_graph_*`                                                                    | —                                                                        | Resolves peers via learned table                                                          | —                                                                           | —                                                                  |
| **Uptrace**                           | Ingest metrics                           | Client/server pairs (closed source, UNVERIFIED)                                                                                      | Ingest                                                                                                                                                                   | client/server duration, failed                                                              | —                                                                        | `rpc.service`, `db.name`, socket address                                                  | ECharts graph                                                               | —                                                                  |
| **Coroot**                            | eBPF TCP                                 | Not trace based                                                                                                                      | —                                                                                                                                                                        | —                                                                                           | —                                                                        | —                                                                                         | —                                                                           | —                                                                  |

### 2.2 Per-tool insights that are not obvious

**Grafana / Tempo** (`modules/generator/processor/servicegraphs`, `grafana-tempo-datasource/src/graphTransform.ts`)

- Pairing is strict: the CLIENT span must be the **direct parent** of the SERVER span. Istio client→client chains break edges (tempo#1418), and INTERNAL-only services produce no edges (grafana#109905).
- DB edges complete **immediately from one client span** (`ServerLatencySec = client duration`). The server name comes from `peer.service` → `server.address` → `network.peer.address[:port]` → db name.
- Node stats are attributed to the **server** side only. Client-only roots get `NaN` and render blank.
- Edge `mainstat` is the **average** latency, not a percentile.
- Samples are timestamped at **pairing time**, not span time (contrib#36613).
- The single `"user"` root merges separate apps (tempo#2746) and collides with a real service named `user` (grafana#92674).
- Node Graph: the visible limit is 200 nodes, found by BFS from roots, with "+N hidden" markers. Layout is cached by a data signature, but the panel still flickers on refresh (grafana#112117) and has no zoom-to-fit (grafana#128622).
- Filters were applied to two queries with different label sets, which blanked the graph (grafana#80822).

**OTel servicegraphconnector** (contrib `connector/servicegraphconnector`)

- It is the only reference that implements **span-link messaging correlation** (#48610), including fan-out from one producer to many consumers across traces.
- **Orphan** server spans (parent missing, as opposed to root) are **dropped**, not attached to `user` (#19764).
- A DB node is named by **db name**, not `db.system`. `postgresql` without `db.namespace` waits for the TTL and then becomes a virtual node named by `db.system`.
- `server.address` is not a default peer attribute, so many third-party HTTP calls become `unknown`.
- The README lists unpaired/dropped metrics that the code does not emit.

**Jaeger**

- The in-memory algorithm is the whole of Kopai's base rule: a self-join where the service differs. It ignores kind, skips self-calls and counts only `callCount`.
- Badger silently uses **100 traces** (`defaultNumTraces`). In-memory requires the **whole trace to be inside** `[start, end]`.
- "Why is the dependencies page empty?" is a top FAQ entry.
- The DDG (`/api/deep-dependencies`) backend is a **hard-coded stub**. The real DDG is built in the browser from search results.
- The layout auto-switch to `sfdp` compares **link** count to `dagMaxNumServices`, which looks like a bug. The hard cap is 1200.
- Useful UI ideas: focal service + depth (undirected BFS, default 5), a search/highlight box, "View traces" opening trace search.

**SigNoz**

- Edge metrics come entirely from the **callee** span, including environment and latency. A down service (refused connection) produces **no edge**, so the dead service disappears while its callers go red (#13088).
- Node error rate is a **sum of incoming percentages** (three callers at 40% give 120%). Any error makes the node red. Roots are always green.
- The layout is non-deterministic and gets rebuilt every render, so the graph jumps (#1846, #1954).
- No click, no drill-down. The page is still marked Beta.
- A React Flow + dagre rewrite (PR #11177) was explored as a PoC. The roadmap in #13088 is effectively a requirements list: neutral healthy colour, error bands at 1% and 5%, grey under 20 calls, non-colour cues, log edge width, arrows, a legend, a side panel, search, focus, URL state, and requiring an env filter.

**Kiali**

- Pipeline: aggregate rows → `TrafficMap` → ordered **appenders** (deadNode, responseTime, health, idleNode, root marking …). This is a good structure for the shared TS builder (D14).
- **Deterministic node IDs** per granularity (`svc_<cluster>_<ns>_<name>`), with four graph types (app, versioned app, workload, service).
- **Double-reporting dedup**: both proxies report each request. The equivalent risk for Kopai is counting both the client span and the server span. Count once (D1).
- Health tolerances: 5xx any >0 is degraded and ≥10% is failure; 4xx ≥10%/≥20%. They are configurable.
- Moved from Cytoscape to PatternFly Topology for consistency, not speed. Afterwards came CPU regressions (#8520) and costly animation (#9701). Force layouts (cose/cola) were dropped for large graphs (#4601). Idle edges are off by default because they are "obsolete pathways" (#3519). There is no graph export (#7884).
- The highlighter admits it is not request-accurate: "this is not trace-based". Kopai can link each edge to the actual traces behind it.

**PostHog** (PR #123559)

- The design is nearly identical to Kopai's and its review threads are a ready-made list of pitfalls:
  - environment leakage across traces
  - `GROUP BY … LIMIT` still scanning the whole window (fixed with `DISTINCT … LIMIT`)
  - unbounded join memory (fixed with a 200k-span budget with stable `ORDER BY`)
  - stale health after a filter change
  - silent layout failure looking like "no services"
  - React Flow swallowing node clicks
  - non-focusable nodes
- Remaining flaws: the sample is **first N in read order** (biased); edges are sampled but nodes are not (different populations); window-boundary parents are dropped; no virtual nodes.
- `spanSummary.ts` deliberately **excludes `server.address`** from peer inference: "would render a misleading 'service → 10.0.0.5:5432' peer arrow".

**HyperDX**: a query-time map on the **same `otel_traces` schema**. It uses `GROUPING SETS` for nodes and edges in one pass, user-selectable hash sampling scaled back up, no sampling for a single-trace map, and React Flow + dagre LR with a node-colour metric switcher.

**OpenObserve**: learns a `client peer identity → callee service` table from paired spans and then resolves unpaired client spans through it. This is a clever way to name virtual nodes as the real service when the peer is instrumented elsewhere (later idea, R-L6).

---

## 3. Edge derivation algorithm for Kopai (query time)

Storage facts (verified in the codebase scout):

- `SpanKind` strings are `Unspecified | Internal | Server | Client | Producer | Consumer`.
- `StatusCode` is `Unset | Ok | Error` (`STATUS_CODE_ERROR_LITERAL = "Error"`).
- `ParentSpanId = ''` marks a root.
- `ServiceName = ''` when `service.name` is missing.
- `Timestamp` is the span start in ns.
- SQLite attributes are JSON (`json_extract`, native types). ClickHouse attributes are `Map(String,String)`, where a missing key reads as `''`.
- **Neither table has a uniqueness constraint on `(TraceId, SpanId)`.** SQLite `otel_traces` has no primary key (only secondary indexes) and `writeTraces` does a plain insert. The ClickHouse exporter table is a plain `MergeTree`, not `ReplacingMergeTree`. An OTLP exporter that retries after a timeout therefore stores the same span twice (verified in the DDL; the retry behaviour is standard OTLP exporter behaviour). See D21.
- **`ServiceName` is `service.name` only.** `service.namespace`, `service.version`, `service.instance.id` and `deployment.environment.name` live only in `ResourceAttributes`. Anything that becomes part of node identity (Q18) must be pulled out of the JSON/Map in SQL, on both sides of the join.
- Links: SQLite stores `"Links.TraceId"` / `"Links.SpanId"` as parallel JSON arrays (TEXT); ClickHouse stores them as parallel `Array(String)` columns. Zipping the two arrays is required on both backends (`json_each` twice joined on `key` in SQLite; `ARRAY JOIN` of both columns together in ClickHouse).

### D1. Edge rule: kind-agnostic cross-service parent/child, counted once on the child

- **Decision.** An **instrumented edge** `A → B` exists for each span `c` in service B whose parent `p` (same `TraceId`, `p.SpanId = c.ParentSpanId`) is in service A, with A ≠ B. Each such child span counts as **one call**.
- **Rationale.**
  - It is tolerant of imperfect instrumentation: missing CLIENT spans, INTERNAL→SERVER, client→client proxy chains. That suits a tool for testing instrumentation.
  - Counting on the child means "each call counts once however many client spans the caller wraps around it" (PostHog).
  - It avoids Kiali-style double counting.
- **Alternatives.**
  - (a) Tempo/connector strict `Client|Producer → Server|Consumer`. This is spec-pure but silently loses edges (tempo#1418, grafana#109905, contrib#29148/#29531).
  - (b) HyperDX's server-spans LEFT JOIN client-spans.
- **Evidence.** Jaeger `tenant.go:313`, SigNoz MV 1002, PostHog `sources.py`.
- **Identity caveat.** "A ≠ B" must compare the full node identity, not just `ServiceName`. If Q18 makes `service.namespace` part of identity, `orders` in namespace `shop` calling `orders` in namespace `legacy` is a real edge that a plain `p.ServiceName != c.ServiceName` predicate would drop as a self-call. The SQL must compare `(namespace, name)` tuples extracted from `ResourceAttributes`.
- **Fan-out caveat.** Counting on the child means a Producer with N consumers (or a client span with several server children, e.g. a proxy that is not instrumented but forwards to two backends) yields N calls. That is correct for call counts, but client-side metrics derived from the parent (client latency, client errors) must be **deduplicated by parent span** (`uniqExact(pSpan)` / `COUNT(DISTINCT ...)`) or they are weighted N times (D9, D10).
- **Mitigation for spec purists.** The edge carries `kindPair` counts (for example `Client→Server: 40, Internal→Server: 2`), so the UI can flag non-conformant edges (R14) and a later "strict" toggle can filter them (Q2).

### D2. Kind attribution on an edge

| Parent kind   | Child kind | `connectionType`                                 | Client latency         | Server latency         |
| ------------- | ---------- | ------------------------------------------------ | ---------------------- | ---------------------- |
| Client        | Server     | `rpc` (HTTP/gRPC, refined by attributes, see D7) | `p.Duration`           | `c.Duration`           |
| Producer      | Consumer   | `messaging`                                      | `p.Duration` (publish) | `c.Duration` (process) |
| anything else | anything   | `rpc` with a `nonStandardKinds` flag             | none                   | `c.Duration`           |

- For Producer→Consumer, "server latency" is **processing time**, which is not comparable with RPC latency, and the interesting number is usually **messaging lag** = `c.Timestamp − (p.Timestamp + p.Duration)` (Tempo's opt-in histogram). It crosses hosts, so it is **clock-skew sensitive**: Tempo skips values ≤ 0 with a warning. Kopai should do the same and count the skipped values as a diagnostic, rather than clamping them to 0.
- Clock skew also makes the "client p50 − server p50 = network overhead" figure in D10 negative on some edges. Show it only when it is positive, and never use span timestamps to _decide_ a parent/child relationship: only IDs.

### D3. Virtual (uninstrumented) server nodes

- **Decision.** A `Client` or `Producer` span `c` with **no child in a different service** produces an edge `c.ServiceName → virtual target`.
- **Target name** is the first non-empty value in this list. It lives in one shared TS constant (`SERVICE_GRAPH_PEER_KEYS`) that generates the SQL for both backends:
  1. `peer.service.name`, `peer.service` → type `external` (or `database` / `messaging` if `db.*` / `messaging.*` is also present)
  2. `db.system.name` / `db.system` (+ `db.namespace` / `db.name`) → type `database`, id `db:<system>/<namespace>` (D4)
  3. `messaging.system` (+ `messaging.destination.name`) → type `messaging`, id `mq:<system>/<destination>` (D6)
  4. `rpc.service` → `external`
  5. `server.address[:server.port]`, `net.peer.name` → `external`, id `ext:<host>` (D5)
  6. otherwise → **no edge**, counted in diagnostics as "client span without peer attributes" (R14). There is no `unknown` node: the connector's `unknown` node is noise.
- **Rationale.** Tempo and the connector default lists miss `server.address` and messaging. SigNoz (collector #178, #8272) and PostHog are criticised for having no virtual nodes. The type drives the icon or shape, which avoids grafana#54843 and SigNoz #10728.
- **Namespaced IDs** (`svc:`, `db:`, `mq:`, `ext:`, `client:`) prevent collisions with real services (grafana#92674) and the merging of unrelated DBs.
- **Note.** The scout's draft SQL puts `db.system` before `messaging.destination.name` and `server.address`. The order above is the proposal; the order itself is contested (Q4).
- **ID for rule 1 is ambiguous as written.** When `peer.service` is set _and_ `db.*` is present, is the id `db:<peer.service>` or `db:<system>/<namespace>`? Proposal: the **type** comes from the attribute family (`db.*` → database, `messaging.*` → messaging, else external) and the **id** comes from the highest-priority name, so `peer.service=orders-db` + `db.system=postgresql` → `db:orders-db`, label `orders-db (postgresql)`. Write this down in `peer-keys.ts` with tests, because the two SQL generators must agree.

### D3a. When is a Client/Producer span "unpaired"? (correction to the scout draft)

The scout draft (and D3 as first written) marks a Client/Producer span as virtual when it has **no child in a different service**. That rule creates phantom nodes in three common cases:

1. **Nested client spans in the same service.** An SDK or framework span (e.g. AWS SDK, Spring `RestTemplate`, a gRPC stub) wraps an HTTP-library CLIENT span, and only the inner one has the cross-service SERVER child. HTTP semconv also produces one CLIENT span per retry or redirect attempt, under a logical parent. The outer span has a child, but in its own service, so the draft rule draws an extra `ext:<host>` node **next to the real service B**.
2. **Calls back into the same service** (D7). The child SERVER span is in the same service, so the draft rule emits a virtual `ext:<own host>` edge.
3. **A Client span whose cross-service child is not yet ingested** (in-flight, see D11) or was dropped by sampling. Showing a virtual node here is arguably right (Tempo does it after `wait`), but it then _disappears_ on refresh once the child lands.

- **Decision (revised).** A Client/Producer span is a virtual-edge candidate only if it is a **leaf among exit spans**: it has **no child span at all** in the store, _or_ its only children are same-service spans that are not themselves Client/Producer and that are not paired. In practice the simpler and nearly equivalent MVP rule is **"no child span of any kind"** (Jaeger spark-dependencies uses "leaf span with `peer.service`"). The nested case is then counted once, on the innermost span.
- **Same-name collision with a real service.** If the inferred name (`peer.service`, or `server.address` host) equals a `ServiceName` that exists in the window, attach the edge to the real `svc:` node and flag it `inferred: true` rather than creating `ext:payments` next to `svc:payments`. This is a query-time, in-window version of OpenObserve's learned table (R-L6), not a persisted one, so it stays within C1.
- **High-cardinality peers.** `server.address` / `network.peer.address` can be IPs, ephemeral pod IPs or per-tenant hostnames; `messaging.destination.name` can be a temporary reply queue (`amq.gen-…`) or a per-request topic. Mitigations: prefer `messaging.destination.template` when set; collapse destinations flagged `messaging.destination.temporary` / `.anonymous` into `mq:<system>/(temporary)`; and cap virtual targets **per source** (e.g. top 20 by calls, the rest folded into one `ext:<source>/other` node with a count). Without a per-source cap one chatty service can consume the global 1000-edge cap (NFR4) and push real edges out.

### D4. Database node identity

- **Decision.** `db:<db.system.name|db.system>/<db.namespace|db.name>`, falling back to `db:<system>` when there is no namespace. The node label shows `namespace (system)`. `server.address` is **not** part of the identity in MVP.
- **Alternatives.**
  - Connector: db name only, so two clusters with the same database name merge.
  - SigNoz: `db.system` only, so all Postgres databases merge into one (#178).
  - `(system, address, namespace)`: most precise, but IPs fragment the graph.
- **Open:** Q5.

### D5. `server.address` as a last resort

- **Decision.** Use it, but **only after** all semantic attributes, and only for `external`.
- **Rationale.** Without it, third-party HTTP calls are invisible (contrib default list). PostHog warns that it yields IP-address nodes. Its position at the end of the priority list keeps DB and Redis calls named by `db.*` first.
- **Open:** Q4.

### D6. Messaging, producer/consumer and span links

- **MVP**
  - Producer → Consumer via parent/child (D1).
  - An unconsumed Producer span becomes a virtual `mq:` node (D3). The connector drops these; Kopai should not.
  - **No broker node in the middle** of a paired producer→consumer edge (tempo#3348 asks for it; keep it out for now).
- **Later (R-L1).** Span links: a Consumer span whose `Links.SpanId` points at a Producer span, possibly in **another trace**.
  - ClickHouse: `ARRAY JOIN Links`. SQLite: `json_each`.
  - Tempo rejected this (tempo#7215 NOT_PLANNED). The connector has it (#48610). Messaging semconv recommends links for batch receive.
  - A cross-trace link join is **not bounded by `TraceId`**, so it cannot use the per-trace index seek on SQLite or the `TraceId IN (window)` prune on ClickHouse. It needs its own bounded lookup (producer spans by `(TraceId, SpanId)` from the link arrays, with a time pad). This is a cost reason, not just a scope reason, to keep it out of MVP.
- **Span kinds in messaging are not just Producer/Consumer.** In current messaging semconv, `create` and `send` spans are PRODUCER (`send` may be CLIENT when it is not the creation context), **`receive` and `settle` spans are CLIENT**, and `process` spans are CONSUMER (exact version rules to be verified against semconv before implementation). Consequences for D3/D3a:
  - A `receive` CLIENT span in a consumer service has no cross-service child, so it would become an edge **consumer → `mq:kafka/orders`**, pointing the wrong way. This is exactly SigNoz's direction bug (#4701).
  - Rule: when `messaging.operation.type` (or the older `messaging.operation`) is `receive`, the virtual edge is drawn **`mq:<…>` → consumer**; `settle` spans are ignored for topology (they are acks).
  - The `process` CONSUMER span is often a child of the `receive` span **in the same service**, or a root with a link. Neither yields an instrumented edge. Without links, the only way the map shows producer → broker → consumer is through two virtual edges meeting at the same `mq:` node, which argues for making the `mq:` id identical on both sides (system + destination, not host).
- **Open:** Q6.

### D7. Self-calls

- **Decision.** No `A → A` edges. Same-service parent/child is internal structure (Jaeger, SigNoz and PostHog all exclude it, and PostHog has a test for it).
- **Exception:** a Client span calling back into its own service through a Server span is still `A → A`. Count it as a `selfCalls` stat on the node, not as an edge (later). Such a client span must **not** become a virtual edge either; the scout draft's "no cross-service child" rule would turn it into `ext:<own host>` (fixed by D3a).
- **Different instances of the same service** (two pods, two versions) calling each other are also `A → A` at service granularity and are hidden. That is fine for MVP but is a reason for an instance/version granularity later (R-L5).

### D8. Entry / "user" node

- **Decision (MVP).** No synthetic client node by default. Nodes whose inbound traffic includes root SERVER/CONSUMER spans get an `isEntry: true` badge plus an `entryCalls` count.
- **Toggle (`showEntryNodes`).** Adds one virtual client **per entry service**, `client:<entryService>`, as Tempo #2746 suggests. A single global `user` node is never added.
- **Orphans.** Server spans whose parent is **missing** (not root) are never attached to the entry node. They are reported as diagnostics ("parent span not found": sampling, in-flight, lost). The connector behaves the same way (#19764).
- **Orphans are not all equal.** Distinguish: (a) the parent span ID's trace has _no_ spans from any other service in the store (the caller is not instrumented, or propagated `traceparent` from an uninstrumented gateway/browser); (b) the trace has other spans but not that parent (sampling mismatch or lost export); (c) the child is younger than a grace period (in-flight, D11). (a) is really an entry and could feed `isEntry`; (b) is an instrumentation bug; (c) is noise. Lumping them together makes the diagnostic useless during a live test run.
- **Open:** Q7.

### D9. Error definition

- **Decision.**
  - `errorCount` on an instrumented edge counts calls where **either** `p.StatusCode = 'Error'` (only when `p` is Client/Producer) **or** `c.StatusCode = 'Error'`. This is the connector's OR rule.
  - The edge also carries `serverErrorCount` and `clientErrorCount` separately.
  - Virtual edges use the client span's status.
  - With fan-out (one parent, N children) the parent's error must be counted once per _child_ for the OR rule (each call failed or not), but `clientErrorCount` should count distinct parent spans. State this explicitly in the schema docs, because the two will not add up.
  - `StatusCode = Unset` is the norm for successful server spans, and HTTP semconv says a server span must **not** be marked Error for 4xx. A client span **is** marked Error for 4xx. So the OR rule makes 4xx edges red while the callee node stays healthy. That is consistent with the semconv, but it will surprise users; show the split in the panel.
- **Rationale.** The OR rule catches client-side failures such as timeouts or refused connections that the callee never sees. SigNoz uses callee-only and loses exactly these (#13088). Span status rather than HTTP status follows SigNoz's reasoning in #2291 (4xx semantics depend on the kind).
- **Later.** An HTTP/gRPC status breakdown per edge, like Kiali's `responses` (R-L3).
- **Open:** Q8.

### D10. Latency: which side

- **Decision.**
  - Primary edge latency = **server-side** `c.Duration` percentiles (p50/p95/p99).
  - Also return **client-side** percentiles when the parent is Client/Producer.
  - Virtual edges only have client latency, which the UI labels as such.
  - The difference (client p50 − server p50) can be shown as "network/queue overhead" on hover. This is the reason to keep both.
- **Evidence.** Tempo and the connector keep both histograms. SigNoz and PostHog keep only the callee. Grafana shows average only (a known weakness).
- **Open:** Q3 (percentiles on SQLite).

### D11. Time-window semantics

- **Decision.** A call belongs to the window if the **child span's `Timestamp` (start)** is in `[timestampMin, timestampMax]`. The parent lookup is **not** time-bounded on SQLite (an index seek by TraceId). On ClickHouse it is padded by **1 hour** before `timestampMin` and pruned with `TraceId IN (window trace ids)`.
- **For virtual edges** the client span's start must be in the window.
- **Rationale.** This avoids PostHog's dropped boundary parents and Jaeger's "whole trace inside the window" exclusion. It uses span time rather than processing time (contrib#36613).
- **Known gap.** A child span that starts in the window and whose parent started more than 1h earlier loses the edge on ClickHouse only. This is a parity difference that must be documented and tested (NFR6).
- **Clock skew (correction).** The ClickHouse `par` CTE bounds the parent to `Timestamp <= tsMax`. Parent and child are usually on different hosts; with skew, a child near the end of the window can have a start time _before_ its parent's recorded start, so the parent can fall after `tsMax` and the edge is lost. Pad the **upper** bound too (e.g. `tsMax + 5 min`). The SQLite path is unaffected because it does not bound the parent by time.
- **In-flight traces (Kopai-specific, important for a testing tool).** SDKs export a span when it **ends**, so a parent span always arrives _after_ its children. During a live run, or right after one, the newest children have no parent yet: edges are missing, the D3a rule draws transient virtual nodes for client spans whose server child has not arrived, and orphan counts spike. Tempo hides this behind its `wait` window. Options: (a) by default exclude spans that started within the last _G_ seconds (`ingestGraceMs`, e.g. 10–30 s) when the window ends at "now", and say so in the UI; (b) keep them but mark the resulting orphans and virtual nodes as "pending". (a) is simpler and deterministic; Q20.
- **`TraceId IN (SELECT TraceId FROM win)` is not free.** For a large window the set can hold millions of IDs and is built in memory before the bloom-filter prune. Bound it with the same span cap as `win` (NFR4), and measure its size in the NFR2 benchmarks.

### D12. Sampling

- **MVP.** No query-time sampling. Counts are counts of **stored** spans. If the user's SDK head-samples, the UI says "counts reflect stored (possibly sampled) spans".
- **Later (R-L4).** Deterministic whole-trace sampling for large ClickHouse windows: `cityHash64(TraceId) % N = 0` (HyperDX) or the portable `substr(TraceId, -2) IN (...)` (OpenObserve). Counts are scaled, `sampled: true` is returned, and there is never "first N traces" sampling (PostHog's bias).
- **Rule.** Nodes and edges must always use the **same span population** (PostHog flaw).
- **Open:** Q10.

### D13. Node metrics

- **Decision.**
  - A node's inbound RED comes from its own SERVER/CONSUMER spans in the window: count, errors, p50/p95/p99, rate. If the service has none (a cron job, a worker), use its **root** spans (PostHog).
  - Outbound totals come from summed edges.
  - Virtual nodes: inbound = sum of their incoming virtual edges.
  - The node error rate is `sum(errors) / sum(calls)`, **never a sum of percentages**.
- **Isolated services**: every `DISTINCT ServiceName` in the window becomes a node, even without edges (R5).
- **Inconsistency to resolve (review finding).** Edges are kind-agnostic (D1) but node inbound stats are kind-based (SERVER/CONSUMER). If service B receives calls through an INTERNAL or unset-kind span (common with manual instrumentation, Lambdas, or a framework missing a SERVER span), the edge `A → B` shows 40 calls while node B shows 0 inbound requests, or falls back to root spans and shows a different number. Proposal: define a node's inbound requests as its **entry spans** = spans whose parent is empty, missing, or in another service. That is exactly "child side of D1 + roots + orphans", it is already computed by the `pairs` CTE, and it makes `node.inbound == Σ inbound edges + entry/orphan calls` an invariant the golden tests can assert. Keep the SERVER/CONSUMER count as a secondary field for the "missing SERVER span" diagnostic.
- **Multiple resources per service.** All resources with the same identity (Q18) merge into one node: several instances, several `service.version`s, and **unrelated apps that share a `service.name`** (the SDK default `unknown_service:<process>` is the usual culprit in instrumentation testing). Return `instanceCount` (distinct `service.instance.id`) and `versions[]` per node so the panel can show that a node is a merge, and flag `unknown_service*` names as a diagnostic (R14).

### D14. Where graph logic lives

- **Decision.**
  - Each datasource runs **two aggregate queries**, edge rows and node rows, and returns flat zod-typed rows.
  - A **pure TS builder** `buildServiceGraph(rows, options)` in `@kopai/core` does the rest: assigns IDs, merges by `(source, target)` **in exactly one place**, applies focus/depth BFS, health, caps and `truncated`.
  - The same builder powers a TS reference `graphFromSpans(spans)` used as the test oracle and potentially by the existing `GraphView.buildDAG`.
- **Rationale.** Kiali's appender pipeline; Jaeger #9957 (two merge paths diverged); PostHog's `buildServiceGraph` unit tests.
- **Alternative.** All logic in SQL, which doubles the dialect-specific logic.
- **Caveat.** "Flat rows, logic in TS" only holds for logic that runs _after_ aggregation (IDs, merge, BFS, health). Anything that decides **which spans pair** (D3a leaf rule, entry-span rule, messaging direction, peer-name priority, same-name collision lookups) must run inside the SQL on both backends, because rows are already aggregated by then. The parity risk therefore sits in the SQL generators, and the differential test (NFR6) is what protects it, not the builder.

### D21. Duplicate spans and join fan-out

- **Problem.** No uniqueness on `(TraceId, SpanId)` in either backend (§3 storage facts). A duplicated child counts as two calls. A duplicated **parent** doubles every child's join row, so all of its edges double. A duplicated client span produces two virtual calls. ClickHouse `MergeTree` never collapses them.
- **Decision.** Deduplicate inside the query: in `win`/`par`, take one row per `(TraceId, SpanId)` (ClickHouse `LIMIT 1 BY TraceId, SpanId` or `any()`-aggregation; SQLite `GROUP BY TraceId, SpanId` or `ROW_NUMBER() … = 1`). Measure the cost; if it is too high, at least count duplicates as a diagnostic ("N duplicate span IDs: exporter retries?"), which is itself a useful instrumentation hint.
- **Also:** SQLite could add a `UNIQUE (TraceId, SpanId)` index with `INSERT OR IGNORE`, but that changes ingest semantics for all signals and is a separate decision (Q22).

---

## 4. Functional requirements

### MVP

- **R1 – Standalone page.** A new "Service Map" tab in `observability.tsx` (`Tab = … | "servicemap"`), with a keyboard shortcut and URL state (`tab=servicemap`, `lookback`/`tsMin`/`tsMax`, `focus`, `depth`, `selected`, `env`) so views can be shared and the time range stays in sync with Traces.
- **R2 – Time range.** Reuse the `lookback` presets (5m–24h) and absolute `tsMin`/`tsMax`. Default **last 1h**. "All time" is **not offered**; the maximum is 24h on SQLite, configurable on ClickHouse (NFR1, Q11). A manual refresh button and an optional auto-refresh that is off by default (Kiali #8230).
- **R3 – Filters.**
  - `serviceName` focus with neighbourhood `depth` (default 2, undirected BFS like Jaeger, upstream and downstream counted separately later).
  - Resource-attribute equality filters (`deployment.environment.name`, `service.namespace`, any key). They are applied to **both spans of each pair** (parent and child), so an edge is kept only if both ends match (PostHog environment-isolation fix). Virtual edges apply them to the client span; node rows apply them to the node's own spans. (Earlier wording said "applied to the child span", which contradicted the both-ends rule.) This means the ClickHouse `par` CTE must also select `ResourceAttributes` (or the filtered keys), which the §6 skeleton does not do yet.
  - Cross-environment calls (prod → staging) then vanish silently. Count them in diagnostics ("N calls cross the filter boundary") so the user knows the filter hid something.
  - `includeVirtualNodes` (default true) and `showEntryNodes` (default false).
  - A single query path, so filters can never apply to two different populations (grafana#80822).
  - Unsupported filters are shown, not silently dropped (SigNoz).
- **R4 – Node data.** id, label, type (`service | database | messaging | external | client`), `isVirtual`, `isEntry`, inbound calls/errors/rate/p50/p95/p99, outbound calls/errors, plus `service.namespace` as a subtitle when present.
- **R5 – Isolated services.** Every service that has spans in the window appears as a node, edges or not.
- **R6 – Edge data.** source, target, connectionType, calls, rate (calls/window s), errorCount, clientErrorCount, serverErrorCount, server p50/p95/p99, client p50/p95/p99 (nullable), kindPair breakdown, up to 3 exemplar trace IDs.
  - **Rate is misleading for a test tool.** A 30-second test run viewed in a 1h window shows 0.01 req/s. Either compute rate over the **observed span interval** (`max(start) − min(start)` per edge, with a floor) or make **call count** the default label and rate secondary. Leaning: count by default (Q21).
  - Exemplars should prefer an **error** trace when one exists (`groupArrayIf` / `argMax` on the error flag), since that is the trace a user wants to open. ClickHouse `groupArray(3)` returns arbitrary (read-order) IDs, not "latest" ones; SQLite `MIN(TraceId)` returns lexicographically smallest. Neither is deterministic across backends, so exclude exemplars from parity assertions or pick by a defined rule (e.g. latest start time).
- **R7 – Health colouring.**
  - Nodes and edges are coloured by error rate with **neutral** (not green) for healthy, **warning ≥1%**, **critical ≥5%** (PostHog and SigNoz #13088), and **grey "low traffic"** below 20 calls (SigNoz #13088). Thresholds are configurable props.
  - A non-colour cue for each state (icon or dashed border) and a legend.
  - **Open:** Q12.
- **R8 – Visual encoding.**
  - Edge: arrow, width proportional to **log(rate)** (Tempo takeaway, SigNoz #13088). The edge label is configurable: rate, error %, p95. Default is error % when > 0, otherwise rate.
  - Node: a card with name, `rate · err% · p95`, and an icon or shape per type. Virtual nodes have a dashed border.
- **R9 – Interactions.**
  - Pan, zoom, **zoom-to-fit** (grafana#128622).
  - Hover highlights neighbours and dims the rest.
  - Click a node or edge to open a side panel (PostHog/Kiali): the RED summary, "Called by"/"Calls" lists with calls and error %, and the kind-pair breakdown.
  - Stable positions across refreshes: re-layout only when the node/edge **set** changes, not when stats change (grafana#112117, SigNoz #1846).
- **R10 – Drill-down into the existing Traces search** with the current time range:
  - service node → `serviceName=X`
  - edge → traces containing both services. Today this needs a "services contains A and B" filter that is not in `traceSummariesFilterSchema`. Until it exists, use exemplar trace IDs plus `serviceName=B` (Q13).
  - virtual node → `serviceName=<caller>` + `spanAttributes[<peer key>]=<value>`
  - Edge exemplar trace IDs open the trace directly.
- **R11 – States.** There are distinct states for:
  - loading
  - query error (keep showing the last good graph, as PostHog does)
  - layout error (PostHog)
  - empty window ("No spans in this time range, widen it")
  - spans exist but no cross-service calls ("N services, no cross-service parent/child spans found" plus the instrumentation hint: CLIENT/SERVER kinds, context propagation, `service.name`)
- **R12 – Large graphs.** A soft cap of **200 visible nodes**: when exceeded, keep the focus neighbourhood or the top-N by traffic and show "+N hidden" (Grafana `useNodeLimit`). A hard backend edge cap of 1000 with `truncated: true` surfaced as a banner.
- **R13 – Dashboard component.** `ServiceMap` in `observability-catalog.ts`, `acceptsDataFrom: ["getServiceGraph"]`, and a new `getServiceGraph` dataSource variant in `component-catalog.ts`. Props (all `.nullable()` per convention):
  ```ts
  ServiceMap: {
    props: z.object({
      height: z.number().nullable(),
      direction: z.enum(["LR", "TB"]).nullable(),
      showVirtualNodes: z.boolean().nullable(),
      showEntryNodes: z.boolean().nullable(),
      edgeLabel: z.enum(["rate", "errorRate", "p95", "none"]).nullable(),
      healthThresholds: z.object({ warning: z.number(), critical: z.number(), minCalls: z.number() }).nullable(),
      interactive: z.boolean().nullable(), // false = static thumbnail, clicks navigate only
    }),
    hasChildren: false,
    description: "Service dependency graph derived from trace spans ...",
    acceptsDataFrom: ["getServiceGraph"] as const,
  }
  ```
  - Data params = `serviceGraphFilterSchema`.
  - **Problem:** dashboard `dataSource.params` are static, and the existing trace filters only take **absolute** `timestampMin`/`timestampMax` (verified in `data-filters-zod.ts`). A saved dashboard would freeze its window. The proposal is to add an optional relative `lookbackMs` to `serviceGraphFilterSchema`, resolved server side (Q14).
  - Update `skills/create-dashboard/SKILL.md` and bump `metadata.version` (#199).
- **R14 – Instrumentation diagnostics (Kopai differentiator).** The response includes `diagnostics` counts, shown in a collapsible "Instrumentation hints" panel, each linking to sample traces:
  - orphan spans (parent not found)
  - Client/Producer spans with no peer attributes and no cross-service child
  - services with only INTERNAL spans
  - edges whose parent is not Client/Producer ("missing CLIENT span")
  - spans with empty `service.name`, and services named `unknown_service` / `unknown_service:<process>` (the SDK default when `service.name` is not configured, the most common first-run mistake)
  - orphans split by cause (D8: uninstrumented caller vs missing parent vs in-flight)
  - duplicate span IDs (D21)
  - services that have SERVER spans with `ParentSpanId != ''` but no CLIENT spans upstream (context propagated, caller not instrumented with an exit span)
  - CLIENT spans with a server child in the **same** service (likely mis-set `service.name` on a shared process)
  - messaging consumers whose links point at producers (spans not drawn until R-L1, D6)
  - negative messaging lag / clock skew counts (D2)
  - **Open:** Q15.
- **R15 – Per-trace mode.** `traceId` filter: the same query restricted to one trace, with no caps and no sampling (HyperDX, SigNoz #8216). It can replace the internals of the TraceTimeline "graph" view later.

### Later

- **R-L1** Span-link messaging edges (D6), optionally cross-trace.
- **R-L2** Broker/topic node between producer and consumer (`messaging.destination.name`).
- **R-L3** HTTP/gRPC status breakdown per edge (Kiali `responses`) and protocol-aware health (Kiali tolerances).
- **R-L4** Deterministic hash sampling with scaling for large ClickHouse windows (D12).
- **R-L5** Granularity switch: service (default) / service+version / service+operation (Kiali graph types; PostHog's call tree is `(service, spanName)`).
- **R-L6** Resolve virtual peers to real services via a learned `peer → service` table (OpenObserve). To respect C1 this table must be **learned at query time from the same window** (pairs where a client span's `server.address`/`peer.service` is followed by a server span of service X), never persisted by a background job as OpenObserve does.
- **R-L13** Instance/version granularity (`service.instance.id`, `service.version`) and pod-level nodes, to make same-service cross-instance calls (D7) and version canaries visible.
- **R-L7** Find/hide expressions (a Kiali subset: `!healthy`, `type=database`, `rps<1`), search box, namespace boxing (`service.namespace` groups).
- **R-L8** Trace overlay: highlight one trace's path on the global map (Kiali `showTrace`).
- **R-L9** SVG/PNG export (Kiali #7884).
- **R-L10** CLI `kopai traces graph --json` and MCP `service_graph` tool (respecting `mcp/src/limits.ts`).
- **R-L11** "Strict OTel" edge mode (Q2).
- **R-L12** Time comparison or deltas (SigNoz #13088 roadmap).

---

## 5. Non-functional requirements

- **NFR1 – SQLite performance.** Proposed budget: **p95 ≤ 300 ms for a 1h window with 100k spans**, and ≤ 1.5 s at 24h / 1M spans. These numbers are UNVERIFIED and must be benchmarked before they are adopted.
  - Add the index `idx_otel_traces_trace_span (TraceId, SpanId)` and possibly `(TraceId, ParentSpanId)`. Kopai owns the SQLite DDL, and it re-runs `IF NOT EXISTS` at startup.
  - Measure the extra write cost of the new index (NFR8).
  - **Do not count on the existing partial index.** `idx_otel_traces_parent_span ... WHERE ParentSpanId != ''` can only be used when the planner can prove the query's predicate implies `ParentSpanId != ''`. The draft's `NOT EXISTS (… s.ParentSpanId = c.SpanId …)` does not state that, so SQLite falls back to `idx_otel_traces_trace_id` and scans every span of the trace (the scout's plan confirms TraceId-index use). Either add `AND s.ParentSpanId != ''` to the subquery, or add a full `(TraceId, ParentSpanId)` index. Verify with `EXPLAIN QUERY PLAN` in a test.
  - The window scan uses `idx_otel_traces_timestamp_span (Timestamp, SpanId)` and then reads every row from the table for the other columns, which is fine at 100k but is the dominant cost at 1M. A covering index is not worth its write cost.
- **NFR2 – ClickHouse performance.**
  - p95 ≤ 2 s for 1h on a dataset of about 10M spans. UNVERIFIED target.
  - Always require a time window. Keep the hash-join right side small (`par` with 3 columns, `TraceId IN` prune using the exporter's `idx_trace_id` bloom filter).
  - `join_algorithm = 'parallel_hash,hash,grace_hash'` so the query degrades instead of OOMing.
  - Respect the host's `clickhouseSettings` (`max_memory_usage`, `max_execution_time`) and the existing 30s timeout.
  - Kopai **cannot add indexes or MVs** (the exporter owns the schema).
- **NFR3 – Do not block ingest.** `node:sqlite` `DatabaseSync` is synchronous, so a long service-graph query stalls the event loop and OTLP ingest. Mitigations:
  - a span-scan cap (`win … ORDER BY Timestamp DESC LIMIT 200000` → `truncated: true`)
  - the 24h max window
  - a short in-process cache keyed by `(filter, rounded end time)` with a TTL of about 10s, for dashboard refresh
  - later, a worker thread
  - **A worker thread needs WAL.** No `journal_mode` pragma is set anywhere in `packages/sqlite-datasource` or `packages/app` (grep), so the database runs in the default rollback-journal mode. A second `DatabaseSync` connection in a worker would then **block writers** while it reads (and a file DB is required; `:memory:` cannot be shared). Moving to WAL is a prerequisite for the worker option and should be evaluated together with it.
  - **Open:** Q16.
- **NFR4 – Caps.** Edges ≤ 1000 (PostHog), scanned spans ≤ 200k (SQLite) or configurable (ClickHouse), visible nodes ≤ 200 (Grafana). Every cap reports `truncated` together with which cap was hit.
- **NFR5 – Determinism.** Same input → same graph and same layout. Sort edges by `(calls DESC, source, target)` and seed the layout. Snapshot tests depend on this.
- **NFR6 – Datasource parity.**
  - A shared golden fixture suite (OTLP `TracesData` → expected `{nodes, edges, diagnostics}`) runs in both packages. SQLite is seeded via `writeTraces`; ClickHouse via JSONEachRow in testcontainers, plus one test in `e2e.integration.test.ts` on the real exporter schema.
  - A **differential test** generates seeded random traces (mulberry32, as in the existing KOP-70 harness) and compares SQLite, ClickHouse and the TS oracle `graphFromSpans`.
  - Counts must match exactly. Percentiles must match exactly if both backends use exact quantiles (Q3), otherwise within a documented tolerance.
  - Documented, tested divergence: parents earlier than 1h before the window (D11).
- **NFR7 – Bundle size.** The graph library sits only in `packages/ui`, loaded via `React.lazy`. Budget ≤ 80 kB gz for the lazy chunk; `@xyflow/react` 60 kB + dagre 16 kB fits. `ui-core` gets only zod schemas and no graph dependency.
- **NFR8 – Ingest cost.** Any new SQLite index must add ≤ 10% to `writeTraces` time on the existing benchmarks (UNVERIFIED that a benchmark exists; add one if not).
- **NFR9 – Accessibility.**
  - Nodes are focusable `<button>`s with `aria-label` "service X, 12 req/s, 3% errors" (PostHog review finding), and keyboard navigation works.
  - Health is never conveyed by colour alone (SigNoz #13088).
  - An equivalent **table view** (nodes and edges with RED metrics) is available as a toggle. It also serves screen readers and is the fallback when layout fails.
- **NFR10 – Theming.** Tailwind v4 tokens and the `.dark` class variant. React Flow `colorMode` follows `.dark`, and its CSS variables map to Kopai tokens. Service hues reuse `utils/colors.ts` so colours match the trace timeline.
- **NFR11 – Testability.** The graph builder and the layout are pure functions with unit tests. Renderer tests run in jsdom with `ResizeObserver` and `DOMMatrixReadOnly` stubs. Storybook stories cover: empty, single service, chain, fan-out, cycle (A↔B), virtual DB/MQ/external, 200+ nodes, truncated, error, dark.
- **NFR12 – Backwards compatibility.** Adding to `ReadTelemetryDatasource` must not break external implementers (D16). Ship a changeset.

---

## 6. Implementation plan mapped to the codebase

### D16. Datasource interface

- **Decision.** Add a new interface `ReadServiceGraphDatasource { getServiceGraph(filter: ServiceGraphFilter & { requestContext?: unknown }): Promise<ServiceGraphResult> }` in `packages/core/src/telemetry-datasource.ts`, **not** a member of `ReadTelemetryDatasource`.
  - The API and UI check for the capability (`"getServiceGraph" in ds`) and return 501 / hide the tab when it is absent.
  - The UI only talks HTTP, so it cannot do an `in` check. It either needs a capabilities endpoint, or it has to treat a 501 from the first request as "hide the tab / show 'not supported by this backend'". The ui-core dashboard component needs the same handling, because an LLM-generated dashboard may include `ServiceMap` against a host whose datasource lacks it.
  - Fold it into the union at the next major version.
- **Alternative.** Add it to `ReadTracesMetaDatasource` (`:140`). That is simpler but breaks third-party implementers.
- **Open:** Q17.

### Step list

1. **Core** (`packages/core`)
   - `src/data-filters-zod.ts`: `serviceGraphFilterSchema` with these fields:
     - `timestampMin` / `timestampMax` (nanos, required unless `lookbackMs` is given)
     - `lookbackMs?`
     - `serviceName?`, `depth?` (default 2)
     - `resourceAttributes?: record<string,string>`
     - `traceId?`
     - `includeVirtualNodes` (default true), `showEntryNodes` (default false)
     - `edgeLimit` (default 1000, max 5000). Do not call it `limit`, which clashes with the CH CLI parameter name.

     Also define the row schemas (`serviceGraphEdgeRowSchema`, `serviceGraphNodeRowSchema`) and the result schema `{nodes, edges, diagnostics, truncated, truncatedBy?, window:{fromNs,toNs}}`. Export them through `dataFilterSchemas`. No `z.lazy`, to avoid the OpenAPI `schema0` workaround.

   - `src/service-graph/peer-keys.ts`: the priority list (D3) as data, plus the two SQL fragment generators (SQLite `json_extract` / ClickHouse `multiIf`), generated from the same list so the orders cannot drift.
   - `src/service-graph/build.ts`: `buildServiceGraph(rows, opts)` (ID namespacing, merge, BFS focus, health, caps).
   - `src/service-graph/reference.ts`: `graphFromSpans(spans)`, the oracle.
   - `src/service-graph/quantile.ts`: one exact quantile implementation used by SQLite and the oracle (Q3).
2. **SQLite** (`packages/sqlite-datasource`)
   - `sqlite-opentelemetry-ddl.ts` **and** `.sql` (keep both in sync): `CREATE INDEX IF NOT EXISTS idx_otel_traces_trace_span ON otel_traces(TraceId, SpanId)`.
   - `db-datasource.ts`: `getServiceGraph`, raw SQL like `getTraceSummaries` (`:1129`). The verified draft is in the scout report §5a. Changes against that draft:
     - (a) a **pairs** CTE computed once, from which both edges and the anti-join are derived
     - (b) add `p.SpanKind` / `p.StatusCode` / `p.Duration` for client-side metrics and kindPair
     - (c) percentiles: select `(edgeKey, dur)` rows capped per edge (`ROW_NUMBER() OVER (PARTITION BY source,target ORDER BY dur)` → read the percentile rank directly, or return sorted durations) and finish in TS. Shipping durations is unnecessary: with `ROW_NUMBER()` plus `COUNT(*) OVER (PARTITION BY …)` the query can keep only the rows where `rn` equals the target rank for p50/p95/p99 (three rows per edge), which is exact and cheap. Whatever rank formula is chosen must be **identical** to the ClickHouse function (Q3): `quantileExact` returns the element at index `floor(level·n)` (0-based, no interpolation) and `quantileExactInclusive`/`Exclusive` interpolate (per the ClickHouse docs; verify on 25.6 with a golden case). Pick one and implement exactly that in `quantile.ts`.
     - (c2) dedupe `(TraceId, SpanId)` (D21) and apply the D3a leaf rule instead of the scout's "no cross-service child" `NOT EXISTS`
     - (d) `CAST(json_extract(...) AS TEXT)` for non-string attribute values
     - (e) resource filters via `json_extract(ResourceAttributes, '$."k"')`
     - (f) node query: `GROUP BY ServiceName` with `SUM(CASE WHEN SpanKind IN ('Server','Consumer') …)` and root fallback
   - `optimized-datasource.ts:22`: delegate.
3. **ClickHouse** (`packages/clickhouse-datasource`)
   - `src/query-service-graph.ts`: `buildServiceGraphQuery`, parameterised `{name:Type}`, following `buildTraceSummariesQuery`. Start from the verified draft (scout report §5b) with these fixes:
     - one `pairs` CTE, because CH inlines CTEs and evaluates `win`/`par` per reference
     - `quantiles(0.5,0.95,0.99)` or `quantilesExact` (Q3)
     - `groupArray(3)(TraceId)` for exemplars
     - `edgeLimit` parameter name
     - `errorStatus = STATUS_CODE_ERROR_LITERAL`
     - `nanosToDateTime64` for timestamps
   - Draft skeleton:

     ```sql
     WITH
     win AS (SELECT TraceId, SpanId, ParentSpanId, ServiceName, SpanKind, StatusCode, Duration, SpanAttributes
             FROM otel_traces WHERE Timestamp BETWEEN {tsMin:DateTime64(9)} AND {tsMax:DateTime64(9)} {resourceFilter}),
     par AS (SELECT TraceId, SpanId, ServiceName, SpanKind, StatusCode, Duration FROM otel_traces
             WHERE Timestamp BETWEEN {tsMin:DateTime64(9)} - INTERVAL 1 HOUR AND {tsMax:DateTime64(9)}
               AND TraceId IN (SELECT TraceId FROM win)),
     pairs AS (SELECT p.ServiceName src, c.ServiceName dst, p.SpanId pSpan, c.TraceId TraceId,
                      p.SpanKind pKind, c.SpanKind cKind, p.StatusCode pStatus, c.StatusCode cStatus,
                      p.Duration pDur, c.Duration cDur
               FROM win c INNER JOIN par p ON p.TraceId = c.TraceId AND p.SpanId = c.ParentSpanId
               WHERE c.ParentSpanId != '' AND p.ServiceName != c.ServiceName)
     SELECT src, dst, count() calls,
            countIf(cStatus = {err:String} OR (pKind IN ('Client','Producer') AND pStatus = {err:String})) errors,
            quantiles(0.5,0.95,0.99)(cDur) serverQ,
            quantilesIf(0.5,0.95,0.99)(pDur, pKind IN ('Client','Producer')) clientQ,
            groupArray(3)(TraceId) exemplars, sumMap([concat(pKind,'>',cKind)],[1]) kindPairs
     FROM pairs GROUP BY src, dst
     -- UNION ALL virtual branch: win WHERE SpanKind IN ('Client','Producer')
     --   LEFT ANTI JOIN (SELECT TraceId, pSpan FROM pairs) ... target = {peerKeyMultiIf}
     ORDER BY calls DESC, src, dst LIMIT {edgeLimit:UInt32}
     SETTINGS join_algorithm = 'parallel_hash,hash,grace_hash'
     ```

     This skeleton is UNVERIFIED as written. The scout verified the simpler draft. `sumMap` and `quantilesIf` need checking on CH 25.6.

     **Review notes on the skeleton** (fix before implementing):
     - **`win` is still referenced three times** (in `par`'s `IN` subquery, in `pairs`, and in the virtual branch's anti-join), so the "one pairs CTE" change does not remove repeated scans of the window. ClickHouse inlines non-materialized CTEs. Measure; if it hurts, either split into two round-trips (first fetch the bounded set of TraceIds, then pass them as a parameter, PostHog-style) or use the no-join `GROUP BY TraceId` + `groupArray` variant.
     - **The UNION ALL cannot work as sketched.** The virtual branch has no server quantiles, kind pairs or parent fields, so the branch column lists and types diverge, and `ORDER BY … LIMIT` binds to the last branch only unless the union is wrapped in a subquery. Simpler: run the virtual-edge query as a **separate statement** and merge in the TS builder (D14), which also lets the per-source virtual cap (D3a) be applied in SQL independently.
     - **`clientQ` is weighted by fan-out**: with N children, `pDur` appears N times. Use a sub-aggregation by `pSpan` first, or accept the bias and document it (D1 fan-out caveat). Same for client errors.
     - **`par` needs `ResourceAttributes`** (or the filtered keys) for the both-ends filter rule (R3), and the identity keys if Q18 adds namespace.
     - **No dedup** of `(TraceId, SpanId)` (D21); add `LIMIT 1 BY TraceId, SpanId` in `win` and `par`.
     - **Upper time bound of `par`** must be padded for clock skew (D11).
     - The `quantiles` function is ClickHouse's reservoir-sampled `quantile` (8192-sample reservoir; it is exact while an edge has fewer samples but its rank/interpolation rule still differs from `quantileExact`). For parity use `quantilesExact` (or `quantilesExactInclusive`) on both.

   - `datasource.ts`: method following the existing pattern (assert `requestContext`, `clientQuery`, log `{database, username, method, durationMs, rowCount, chNode}`, log and rethrow). Run the node query in parallel.
   - Benchmark: `EXPLAIN indexes=1` on the e2e exporter schema. Compare against the no-join alternative (`GROUP BY TraceId` + `groupArray`), as suggested in the scout report.
4. **otel-testing-harness**: pass-through.
5. **API** (`packages/api/src/routes/traces.ts`): `POST /signals/traces/service-graph`, modelled on `POST /signals/traces/summaries` (`:105`).
   - zod body/response with `problemDetailsSchema`.
   - Resolve `lookbackMs` and enforce the max window here (one place).
   - Return 501 if the datasource lacks the capability.
   - OpenAPI is generated automatically; extend `openapi.test.ts`.
6. **SDK** (`packages/sdk/src/client.ts`): `getServiceGraph(filter, opts)` following `searchTraceSummariesPage` (`:429`), plus an MSW handler in `sdk/src/mocks/handlers.ts`.
7. **ui-core**:
   - `component-catalog.ts`: dataSource variant `{method:"getServiceGraph", params: serviceGraphFilterSchema, refetchIntervalMs?}` and a `fetchForDataSource` case. The exhaustive `never` check will force it.
   - `observability-catalog.ts`: `ServiceMap` (R13).
   - Extend `component-catalog.test.ts` and `renderer.test.tsx`.
8. **UI** (`packages/ui`):
   - `components/observability/ServiceMap/`: `ServiceMap.tsx` (lazy React Flow surface), `layout.ts` (pure dagre wrapper, cycle-safe), `ServiceMapNode.tsx`, `ServiceMapEdge.tsx`, `ServiceMapPanel.tsx` (side panel), `ServiceMapTable.tsx` (NFR9), `DiagnosticsPanel.tsx`, stories and tests, `__fixtures__/service-graph.ts`.
   - `renderers/OtelServiceMap.tsx`: typed `RendererComponentProps<typeof observabilityCatalog.components.ServiceMap>`, `NoDataSource` fallback, exported from `renderers/index.ts`, registered in `DynamicDashboard/index.tsx:29-45`.
   - `pages/observability.tsx`: Tab member, a TABS entry, the `readURLState` whitelist (`:94-99`), a `pushURLState` branch, a shortcut, and `ServiceMapView` reusing the `LOOKBACK_MS` presets minus "All time".
   - Import the `@xyflow/react/dist/base.css` file into the package CSS and map its variables to tokens.
9. **Tests**:
   - Golden fixtures in `packages/core/src/service-graph/__fixtures__/` (so both datasource packages import them). Cases:
     - same-service child (no edge)
     - orphan
     - parent before the window (SQLite pass, CH within 1h)
     - client with a server child (no virtual, no double count)
     - client without peer attributes (diagnostic only)
     - nested CLIENT spans in one service, only the inner one paired (exactly one edge, no virtual node, D3a)
     - client span calling back into its own service (no edge, no virtual node, D7)
     - duplicated span rows, parent duplicated and child duplicated (D21)
     - producer with N consumers (calls = N, client metrics counted once)
     - messaging `receive` CLIENT span (virtual edge points broker → consumer, D6)
     - child whose parent starts _after_ `tsMax` because of clock skew (D11)
     - in-flight child with parent not yet ingested (grace rule, D11)
     - `peer.service` naming an instrumented service that has no paired span in this trace (attaches to `svc:`, D3a)
     - same `service.name` in two namespaces (Q18)
     - `unknown_service:node` service name (diagnostic)
     - `ServiceName=''`
     - DB / MQ / external virtual nodes
     - Internal→Server edge (kindPair flag)
     - producer→consumer parent/child
     - span-link consumer (no edge in MVP)
     - cycle A↔B
     - multiple roots
     - environment-crossing trace
     - isolated service
     - error on client only, server only, both
     - edge cap truncation
   - Differential random test (NFR6).
   - Remember: rebuild `@kopai/core` before cross-package tests. CI has a test gap for core/ui/ui-core.
10. **Docs/skills**: `skills/create-dashboard/SKILL.md` and its version bump; a changeset for core, sqlite, clickhouse, api, sdk, ui-core, ui.

---

## 7. Graph library recommendation

### D20. `@xyflow/react` 12 + `@dagrejs/dagre`, LR layered, lazy-loaded; d3-force not in MVP

| Option                                                | Size (min+gz)                | Fit                                                                                                                                                 | Verdict                                                                 |
| ----------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **@xyflow/react + dagre**                             | 60 + 16 kB                   | React nodes, so Tailwind and dark mode work directly; best a11y; jsdom-testable with 2 stubs; MIT; used by PostHog and HyperDX, and by SigNoz's PoC | **Recommended**                                                         |
| Custom SVG + dagre (extend existing `GraphView`)      | ~16–30 kB                    | Smallest; reuses the existing visual language; but pan/zoom, hit-testing, edge routing and keyboard a11y must be built by hand                      | Strong alternative (Q9)                                                 |
| Cytoscape.js (+cytoscape-dagre)                       | 137 kB                       | Fast canvas, headless tests; styling outside Tailwind, weak a11y, no jsdom render                                                                   | Only if more than ~1–2k nodes                                           |
| elkjs                                                 | 447 kB, EPL/GPL              | Best layered quality (PostHog uses it)                                                                                                              | Optional later lazy layout; licence and size rule it out as the default |
| PatternFly Topology                                   | large (react-core, mobx, d3) | Kiali; clashes with Tailwind; CPU complaints (#8520)                                                                                                | No                                                                      |
| sigma.js, reagraph, vis-network, react-force-graph-2d | various                      | WebGL or canvas, force-only or stale wrappers, weak a11y                                                                                            | No                                                                      |

- **Rationale.**
  - Every reference that uses a deterministic layered LR layout (Grafana MSAGL, Kiali dagre LR, PostHog ELK RIGHT, HyperDX dagre LR) reads better than force layouts (SigNoz jumps; Kiali dropped cose/cola).
  - dagre tolerates cycles.
  - Kopai's realistic scale is 3–50 services and fewer than 500 nodes, so DOM rendering is fine.
- **Tips.**
  - Layout is a pure `layout(nodes, edges) => positions`, memoized on the **set** of node IDs and edges so a stats refresh does not re-layout.
  - `nodesDraggable={false}` in MVP.
  - Handle clicks via `onNodeClick` / in-node buttons (the PostHog React Flow click issue).
  - `fitView` on first layout and on a button.
  - No particle animation (Kiali #9701).
- **Caveat.** The bundle numbers come from bundlephobia, and the performance tiers are typical rather than benchmarked here.

---

## 8. Pitfalls and lessons

- **P1 – Strict kind pairing loses edges** (tempo#1418, grafana#109905, contrib#29148/#29531). → D1 kind-agnostic + diagnostics.
- **P2 – A single global `user` node** merges apps and collides with real services (tempo#2746, grafana#92674). → D8 per-entry, namespaced.
- **P3 – Technology-level DB/MQ nodes** (SigNoz #178, #4701) or same-name DB merges (grafana#54843). → D4.
- **P4 – Callee-only metrics hide dead services** (SigNoz #13088). → D9 OR rule plus client-side virtual edges.
- **P5 – Summing percentages for node error rate** (SigNoz #13088). → D13.
- **P6 – Different populations for nodes and edges** (PostHog sampled edges vs unsampled health). → D12 rule.
- **P7 – "First N traces" sampling bias and hidden caps** (PostHog's first 2000; Jaeger Badger 100 traces, silent). → No sampling in MVP; any cap is visible (`truncated`).
- **P8 – Window boundary**: parents before the window dropped (PostHog), whole-trace-inside requirement (Jaeger). → D11.
- **P9 – Unbounded join memory** (PostHog review) and **unbounded `GROUP BY … LIMIT`**. → NFR2/NFR4 caps, small right side, grace_hash.
- **P10 – Filters applied to differently-labelled queries blank the graph** (grafana#80822); filters silently ignored (SigNoz). → R3.
- **P11 – Cross-environment leakage** through shared traces (PostHog review). → R3 both-ends rule.
- **P12 – Re-layout and jumping on refresh** (grafana#112117, SigNoz #1846/#1954). → R9, NFR5.
- **P13 – Silent layout failure that looks like "no data"** (PostHog), and **a spinner that never stops on error** (SigNoz #13088). → R11.
- **P14 – Empty page with no explanation**, Jaeger's top FAQ; SigNoz hides single services. → R5, R11, R14.
- **P15 – Two merge code paths drift** (Jaeger #9957). → D14 merge in one place.
- **P16 – Semconv renames** (`db.system` → `db.system.name`, tempo#4640; `deployment.environment` → `.name`). → Peer keys include old and new names; one constant.
- **P17 – Expensive animation and heavy topology frameworks** (Kiali #8520, #9701). → D20, no animation.
- **P18 – Average latency hides tails** (Grafana mainstat); `histogram_quantile` is unreliable at low counts. → Exact percentiles from spans; label low-traffic edges grey.
- **P19 – Inaccessible canvas/SVG nodes** (PostHog review). → NFR9.
- **P20 – Kopai-specific: a synchronous SQLite query blocks ingest.** → NFR3.
- **P21 – Kopai-specific: we cannot index ClickHouse**, and the test DDL lacks the production bloom filter and partitions. → Benchmark on `e2e.integration.test.ts` with the exporter-created schema.
- **P22 – Phantom virtual nodes from nested or self-calling client spans** (found in review of the scout draft). → D3a leaf rule.
- **P23 – Duplicate spans from exporter retries multiply join rows** (no uniqueness in either schema). → D21.
- **P24 – Parents arrive after children** (span export on end), so live windows show transient orphans and virtual nodes. → D11 grace period.
- **P25 – Messaging `receive` spans are CLIENT kind**, so a naive virtual-node rule draws consumer → broker (SigNoz #4701). → D6 direction rule.
- **P26 – `unknown_service:*` and shared `service.name`s silently merge unrelated apps** into one node. → D13 `instanceCount`/`versions`, R14 diagnostic.

---

## 9. Open questions for the grilling session

Each has a current leaning. These are the points most likely to be contested.

- **Q1. Is query time viable at the ClickHouse scale a host app might have?** Every high-volume tool (Tempo, connector, SigNoz, Uptrace, OpenObserve) pre-aggregates; only PostHog and HyperDX don't, and both had to add sampling or caps. _Leaning:_ yes for Kopai's purpose (instrumentation testing, small windows), with caps and `truncated` now and hash sampling (R-L4) as the escape hatch. Revisit if NFR2 benchmarks fail.
- **Q2. Kind-agnostic edges (D1) vs strict OTel pairing?** A testing tool could argue the map should show only _spec-correct_ calls, so missing CLIENT spans are visible as missing edges. _Leaning:_ kind-agnostic plus a visible "non-standard kinds" badge and a diagnostic, with strict mode later. The badge makes the problem visible without hiding the topology.
- **Q3. Percentiles: exact everywhere, approximate on ClickHouse, or none on SQLite?** CH `quantiles` is approximate (reservoir), SQLite has no quantile function, and exact parity needs either `quantilesExact` (more memory) or shipping durations to TS. _Leaning:_ exact on both (`quantilesExact` on CH, a capped per-edge duration fetch on SQLite with the shared TS quantile), so golden tests can assert equality. Fall back to approximate CH quantiles only if benchmarks demand it.
- **Q4. Virtual-node priority order and `server.address`.** Should `server.address` produce nodes at all, given PostHog's IP-noise warning? Should `messaging.*` beat `db.*`? _Leaning:_ the D3 order, `server.address` last and labelled `external`, with the per-peer-key breakdown shown in the panel so the user can see why a node was named.
- **Q5. DB node identity:** `system/namespace`, `system` only, or including `server.address`? _Leaning:_ `system/namespace` (D4).
- **Q6. Span links in MVP?** It is the semconv-recommended way to correlate batch messaging and the only cross-trace path. Tempo refused it; the connector built it. _Leaning:_ defer to R-L1, but emit a diagnostic "N consumer spans have links to producers (not drawn yet)" so the gap is visible.
- **Q7. Entry node: none, per-entry `client:<svc>`, or global `user`?** _Leaning:_ none by default with an `isEntry` badge; per-entry toggle; never global.
- **Q8. Error definition: either side (OR) vs callee only?** The OR rule may show an edge as failing while the server node looks healthy (client timeout). _Leaning:_ OR for the edge colour, plus separate client and server error counts in the panel.
- **Q9. React Flow + dagre vs extending the existing hand-rolled SVG `GraphView`?** The existing component already has cycle-safe layered layout, service colours and the visual language at zero dependency cost. _Leaning:_ React Flow + dagre for pan/zoom/a11y, sharing colours and `buildDAG` logic with `GraphView`. Concede if the team weights bundle size and zero dependencies above development time.
- **Q10. Truncation policy when a window is too large:** cap scanned spans (biased toward recent spans), hash-sample (unbiased but approximate), or refuse with 422 ("narrow the window")? _Leaning:_ MVP caps recent spans and shows a loud `truncated` banner with "narrow the window"; hash sampling later.
- **Q11. Default and maximum window per backend.** _Leaning:_ default 1h; max 24h on SQLite; on ClickHouse max 7d (PostHog), configurable by the host.
- **Q12. Health thresholds:** PostHog 1%/5% vs Kiali "any error = degraded". For a test tool, a single 500 in a run may matter. _Leaning:_ warning on any error >0, critical ≥5%, grey under 20 calls, configurable per dashboard component.
- **Q13. Edge drill-down needs a "trace contains services A and B" filter** that `traceSummariesFilterSchema` lacks. Add a `services: string[]` (all-of) filter to trace summaries as part of this work, or rely on exemplars? _Leaning:_ add the filter; it is generally useful.
- **Q14. Relative time in dashboards.** Dashboard `params` are static and filters only take absolute nanos. Add `lookbackMs` just to the service-graph filter, or introduce a generic relative-time concept across all dataSource methods? _Leaning:_ generic, but scoped to `getServiceGraph` first to avoid scope creep. This needs a decision because LLM-generated dashboards will hit it.
- **Q15. How prominent are diagnostics (R14)?** A side panel, inline node badges, or a separate "instrumentation lint" feature shared with CLI/MCP? _Leaning:_ counts in the response and a collapsible panel in MVP; the MCP tool later, because agents testing instrumentation are a core Kopai user.
- **Q16. SQLite event-loop blocking:** is a span cap plus a short cache enough, or should the query run in a worker thread from day one? _Leaning:_ cap plus cache for MVP, with a benchmark gate; a worker if a 24h query exceeds ~500 ms.
- **Q17. Interface placement (D16):** optional capability interface vs adding to `ReadTelemetryDatasource` with a major bump. _Leaning:_ optional interface now.
- **Q18. Node granularity:** is `service.name` alone enough, or must `service.namespace` / `deployment.environment` be part of node identity from day one (Kiali IDs include cluster and namespace)? _Leaning:_ identity is `service.namespace` + `service.name` when the namespace is present; environment is a filter, not identity.
- **Q19. Should the per-trace graph (R15) replace the TraceTimeline `GraphView` internals in the same project?** _Leaning:_ share the builder now and swap the renderer later.
- **Q20. In-flight traces: grace period or "pending" marking?** Excluding the last _G_ seconds hides exactly the spans a developer just generated; including them shows edges that flicker into existence and virtual nodes that vanish. _Leaning:_ a default grace of ~15 s only when the window ends at "now", with a visible "last 15 s excluded (spans still arriving)" note and a toggle. Who decides _G_, and does the per-trace mode (R15) skip it?
- **Q21. Count or rate as the default edge label?** Rate over a mostly empty 1h window is near zero for a short test run. _Leaning:_ count by default; rate over the observed interval as secondary.
- **Q22. Dedupe in every query, or make SQLite reject duplicates at ingest (`UNIQUE` + `INSERT OR IGNORE`)?** The latter is cheaper per query but changes ingest for everyone and does nothing for ClickHouse. _Leaning:_ dedupe in query plus a duplicate-span diagnostic; raise the ingest change separately.
- **Q23. Is the kind-agnostic rule (D1) compatible with the virtual-node rule (D3a)?** D1 says "any cross-service child is a call", but D3a only fires on CLIENT/PRODUCER spans. A service whose outbound call is an INTERNAL span with `server.address` (no kind set) gets an edge if the callee is instrumented and **nothing** if it is not. Is that asymmetry acceptable, or should D3a also consider unset/INTERNAL leaf spans that carry `db.*`/`server.address` (more coverage, more noise)?
- **Q24. Who owns the semantics if the TS builder cannot see pairing logic?** Since D3a, entry spans, messaging direction and dedup all live in two SQL dialects (D14 caveat), is a golden + differential suite enough, or should the SQLite path simply _be_ the reference (fetch spans, run `graphFromSpans` in TS) and only ClickHouse get a SQL implementation? For SQLite at Kopai's scale, a TS implementation over a bounded span fetch could be simpler and exactly as fast.
- **Q25. How do edges on the page and the ui-core component stay consistent when filters differ?** The page has focus/depth and URL state; the dashboard component has static params. Does focus/depth BFS run server-side (part of `getServiceGraph`) or client-side in the shared builder? If server-side, the result for the same window differs between page and dashboard; if client-side, the edge cap is applied before focus, so a focused neighbourhood can be truncated away.
- **Q26. What is the node identity when Q18 adds `service.namespace` but a service only sometimes sets it?** Old and new deployments of the same service then appear as two nodes (`svc:orders` and `svc:shop/orders`). Merge by name when the namespace is empty, or keep them apart?
- **Q27. Does the map need to scale counts for head sampling at all?** If spans carry `TraceState` `ot=th:` thresholds, Tempo multiplies counts. Kopai is a test backend where sampling is usually off; is ignoring it (D12) acceptable, or is "my sampler config produces the right ratio" itself an instrumentation test Kopai should support?

---

## 10. Sources

**Grafana / Tempo**

- grafana/tempo @ `265006bc`: `modules/generator/processor/servicegraphs/{servicegraphs.go,config.go,store/store.go,store/edge.go}`, https://github.com/grafana/tempo/tree/main/modules/generator/processor/servicegraphs
- Tempo docs: https://grafana.com/docs/tempo/latest/metrics-from-traces/service_graphs/ (`_index.md`, `service-graph-view.md`, `custom-service-graphs.md`), TraceQL `construct-traceql-queries.md`
- grafana/grafana-tempo-datasource @ `14b03d49`: `src/graphTransform.ts`, `src/datasource.ts`
- grafana/grafana @ `2aa67a3b`: `public/app/plugins/panel/nodeGraph/*`, `packages/grafana-o11y-ds-frontend/src/createNodeGraphFrames.ts`; https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/
- grafana/traces-drilldown @ `83d11467`: `Structure/StructureScene.tsx`, `utils/trace-merge/merge.ts`
- Issues: tempo #1418, #2746, #3348, #4640, #7215, #8085; grafana #54843, #80822, #88022, #90079, #92674, #109905, #112117, #128622, #133391

**OTel Collector contrib**

- `connector/servicegraphconnector` @ `45ba1835` / `e38304f1`: https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/connector/servicegraphconnector
- Issues: #19764, #27488, #29148, #29531, #30634, #32689 (PR #34562), #34169, #34843, #35287, #35358, #36613, #39160, #40127, #41441, #42289, #44308, #45397, #47418, #48610

**Jaeger**

- jaegertracing/jaeger @ `d723f914`: `internal/storage/v2/memory/tenant.go`, `internal/storage/v1/badger/{dependencystore/storage.go,spanstore/reader.go}`, `internal/storage/v2/clickhouse/{depstore,sql}`, `cmd/jaeger/internal/extension/jaegerquery/internal/*`
- jaeger-ui @ `7066ae45`: `components/DependencyGraph/*`, `components/DeepDependencies/*`, `model/ddg/*`
- spark-dependencies @ `f61c81d4`: `SpansToDependencyLinks.java`
- Issues: #3804, #4939, #5910, #5911, PR #6560, #6606, #7136, PR #8329, #8588, #9470, #9784, #9957; FAQ https://www.jaegertracing.io/docs/latest/faq/

**SigNoz**

- SigNoz/signoz @ `e0802b82`: `pkg/query-service/app/clickhouseReader/reader.go` (`GetDependencyGraph`), `app/services/map.go`, `model/response.go`, `frontend/src/modules/Servicemap/*`
- signoz-otel-collector @ `6355ea5b`: `schema_migrator/{squashed_traces_migrations.go,traces_migrations.go}`
- Docs: https://signoz.io/docs/userguide/service-map/, https://clickhouse.com/docs/materialized-view/incremental-materialized-view
- Issues/PRs: #13088, #11177, #4701, #1667, #9600, #4096, #8272, #10728, #7929, #1504, #2291, #2425, #1846, #1954, #8216; collector #178, #470

**Kiali**

- kiali/kiali @ `a1c59e75` (2.35.0): `graph/{types.go,protocol.go,config/common/common.go,telemetry/istio/istio.go,telemetry/istio/appender/*,graph_cache.go,refresh_job.go}`, `frontend/src/pages/Graph/*`
- https://kiali.io/docs/features/topology/; Kiali 2.0 blog https://medium.com/kialiproject/kiali-2-0-for-istio-2087810f337e
- Issues: #3519, #4601, #7884, #7934, #8053, #8230, #8520, #9701

**PostHog and others**

- PostHog/posthog @ `739ff369`: `products/apm/backend/logic/health/{sources.py,contract.py}`, `products/apm/frontend/{serviceMap.ts,ServiceMapTab.tsx,ServiceMapNode.tsx,ServiceMapDetails.tsx}`, `frontend/src/lib/elk.ts`, `products/tracing/frontend/{spanSummary.ts,traceCallTree.ts}`, `posthog/clickhouse/traces/spans.py`; PR https://github.com/PostHog/posthog/pull/123559
- HyperDX @ `af17e8ff`: `packages/app/src/hooks/useServiceMap.tsx`, `components/ServiceMap/ServiceMap.tsx`, https://github.com/hyperdxio/hyperdx
- OpenObserve @ `66634fb8`: `src/core/src/traces/service_graph/{mod.rs,v4/sql.rs}`
- Uptrace @ `1e622fff`: `vue/src/tracing/*`, `pkg/metrics/metric.go` (backend generator not in the open repo, UNVERIFIED)
- Coroot: https://coroot.com/blog/building-a-service-map-using-ebpf/

**Graph libraries**

- npm registry and bundlephobia (2026-11-05); https://reactflow.dev/learn, https://github.com/dagrejs/dagre, https://github.com/kieler/elkjs, https://js.cytoscape.org, https://www.sigmajs.org, https://www.patternfly.org/topology/about-topology

**Kopai codebase** (worktree `/home/ovca/.herdr/worktrees/kopai-mono/service-map`)

- `packages/sqlite-datasource/src/{sqlite-opentelemetry-ddl.ts,sqlite-opentelemetry-ddl.sql,db-datasource.ts,optimized-datasource.ts,initialize-database.ts}`
- `packages/clickhouse-datasource/src/{datasource.ts,query-traces.ts,ch-row-schemas.ts,types.ts,test/otel-ddl.ts,test/e2e.integration.test.ts,test/golden-cases.ts,test/differential.ts}`
- `packages/core/src/{telemetry-datasource.ts,data-filters-zod.ts,kopai-query-compiler.ts,index.ts}`
- `packages/api/src/routes/traces.ts`, `packages/app/src/{server.ts,openapi.ts,routes/index.ts}`, `packages/sdk/src/{client.ts,mocks/handlers.ts}`, `packages/mcp/src/{tools.ts,register.ts,limits.ts}`
- `packages/ui-core/src/lib/{component-catalog.ts,observability-catalog.ts,renderer.tsx}`, `packages/ui-core/src/hooks/use-kopai-data.ts`
- `packages/ui/src/pages/observability.tsx`, `packages/ui/src/components/observability/{TraceTimeline/GraphView.tsx,renderers/*,DynamicDashboard/index.tsx}`, `packages/ui/src/styles/globals.css`
- Verified draft SQL (scout): `/tmp/claude-1000/-home-ovca--herdr-worktrees-kopai-mono-service-map/6977803a-5ad9-4e1d-878f-862f03c0d91e/scratchpad/{sm.sql,ch.sql,ch-setup.sql,sm.mjs}`

**UNVERIFIED summary**

- SigNoz same-insert-batch edge loss
- Uptrace backend
- Grafana Cloud internals
- the CH skeleton in §6 (only the scout's simpler draft was run)
- all performance budgets in §5
- React Flow a11y/SSR claims (from its docs)
- library performance tiers
- whether a `writeTraces` benchmark exists

---

## 11. Revision notes (staff-engineer review, 2026-11-05)

Changes made in this review pass, checked against the seven research reports and the Kopai codebase (`sqlite-opentelemetry-ddl.sql`, `clickhouse-datasource/src/test/otel-ddl.ts`, `data-filters-zod.ts`, `component-catalog.ts`, grep for SQLite pragmas):

1. **TL;DR**: added a bullet on the derivation traps found in review.
2. **§2.1 table**: Grafana runs 4 instant queries _plus_ 4 companion `_labels` queries, not 4 in total.
3. **§3 storage facts**: there is no uniqueness on `(TraceId, SpanId)` in either backend; `ServiceName` is `service.name` only (namespace/version/instance live in `ResourceAttributes`); link columns are parallel arrays in both backends.
4. **D1**: node-identity caveat (namespace-aware self-call check) and the fan-out caveat (client metrics must be deduplicated by parent span).
5. **D2**: messaging lag and clock-skew handling; negative "network overhead" values.
6. **D3**: clarified the id/type rule when `peer.service` and `db.*` are both present.
7. **New D3a**: corrected the "unpaired client span" rule. The scout's "no cross-service child" rule creates phantom virtual nodes for nested CLIENT spans, retries and self-calls. Added the same-name-as-real-service rule and the high-cardinality peer mitigations (destination template, temporary queues, per-source cap).
8. **D6**: messaging span kinds (`receive`/`settle` are CLIENT), direction rule, why links cost more than parent/child (not bounded by TraceId).
9. **D7**: self-call client spans must not become virtual edges; cross-instance same-service calls are hidden.
10. **D8**: orphan causes split into three kinds.
11. **D9**: fan-out effect on client errors; the semconv 4xx client/server status asymmetry.
12. **D11**: pad the parent's _upper_ time bound for clock skew; the in-flight-trace problem (parents arrive after children) and a grace-period option; the cost of the `TraceId IN (win)` set.
13. **D13**: node inbound vs edge inconsistency under kind-agnostic edges, resolved with an "entry span" definition; merged resources, `unknown_service`, `instanceCount`/`versions`.
14. **D14**: pairing logic cannot live in the TS builder; the parity risk is in SQL.
15. **New D21**: duplicate spans and join fan-out.
16. **R3**: fixed the contradictory filter wording (filters apply to both ends; `par` needs `ResourceAttributes`); cross-boundary diagnostic.
17. **R6**: rate vs count for short test runs; exemplar choice and non-determinism.
18. **R14**: more diagnostics (`unknown_service`, orphan causes, duplicates, same-service client→server, links, skew).
19. **R-L6**: must be learned per query to stay within C1. **New R-L13**: instance/version granularity.
20. **NFR1**: the partial `ParentSpanId` index cannot be used by the draft `NOT EXISTS`; window-scan cost note.
21. **NFR3**: no WAL is configured, so a worker-thread reader would block writers; WAL is a prerequisite.
22. **§6 SQLite step**: exact percentiles in SQL with window functions, rank formula matched to ClickHouse; dedup and D3a.
23. **§6 ClickHouse skeleton**: `win` is still scanned three times; the UNION ALL branches do not type-match and `LIMIT` binds to the last branch; `clientQ` fan-out weighting; `par` missing resource attributes; dedup; skew pad; `quantiles` is reservoir-sampled.
24. **D16**: the UI cannot use an `in` check over HTTP; it needs a capabilities endpoint or 501 handling, in the dashboard component too.
25. **Golden cases**: ten new cases. **Pitfalls**: P22–P26. **Open questions**: Q20–Q27.

**Remaining concerns not resolved here.** The messaging span-kind rules come from memory of the current semconv and should be checked against the pinned semconv version. The ClickHouse `quantileExact` rank rule is cited from the docs, not tested. All performance budgets are still unbenchmarked. Every derivation rule added here (D3a, entry spans, dedup, direction) increases the SQL that has to stay identical across two dialects, which is the strongest argument for Q24.
