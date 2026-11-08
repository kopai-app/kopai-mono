# Service Map: implementation plan

Status: plan, revised after review (see "Review notes" at the end) · 2026-11-06 · branch `service-map`

> **As built (differs from the plan below; the code is authoritative):** the shared scan budget is `SCAN_MAX_REQUESTS = 50` with `PROBE_RESERVE = 15` (not 200 / 30). The seed starts with `getServices` (every known service is a node from the start), then the 2 aggregates, all counted. A session nobody shows is **paused** after the 1 s grace period (graph and layout kept) and **stopped** after M = 60 min unused; it is not terminated after the grace period. When page 1 of the backward scan fails, the hub is chosen from the seed if the seed connects anything. Other user-requested changes are listed in the changeset.

The plan builds the Service Map MVP. The map is built step by step in the browser from trace pages and uses **only existing `@kopai/sdk` `KopaiClient` methods**. There is no new endpoint and no new SDK method.

## Sources

| Short name   | Document                                                                                                       | Used for                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR**       | [`progressive-research.md`](./progressive-research.md)                                                         | **§0 (Round 1, Round 2 R2-1…R2-9, Q19, Round 3) is binding.** §4.2/§4.3 (A1–A8, worker pseudocode) only where it agrees with §0. §5.5 (layout D at every scale, test plan). |
| **R1**       | [`research.md`](./research.md)                                                                                 | Edge rules only: R1-D1, D3, D3a, D4, D6, D7, D13, D21.                                                                                                                      |
| **Mock-up**  | [`mockup-layouts.html`](./mockup-layouts.html), published at https://claude.ai/artifact/9hBXUcqb7y1HSbuK76FABK | Panel D `layoutFlow()`, the "Scale check for layout D" section, and the shop fixture (`NODES`/`EDGES`, lines 236–290).                                                      |
| **Ref impl** | [`mockup-scale.js`](./mockup-scale.js)                                                                         | `computeFlow(G)` is the **reference implementation of layout D with lanes**. `genSystem`, `chain` and `star` are the fixture generators.                                    |

**Rejected paths. Do not implement:** PR §4.4 fallbacks, PR §5.2 radial/d3-force layout, a user-chosen M, re-reading the provisional tail (A5 "provisional"), the "stop after two pages with no new services" rule, the A6 "stable for K pages" clause, A4 parent lookup, layouts A/B/C, grouping (Q20), span-link messaging edges (Q13), and manual re-centre.

---

## 1. Decisions this plan implements

| ID                      | Decision (short form)                                                                                                                                                                                                                                                                                                                                                                           | Where in this plan                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R2-1                    | M = 60 min, fixed. Header shows the actual coverage: "covers 6 of 60 min".                                                                                                                                                                                                                                                                                                                      | `engine/config.ts`, header                         |
| R2-2                    | Hub = the service with the most spans among services that have ≥1 connection, chosen after the aggregate and the first page and before the first render. Fallback: the plain busiest service. It never changes. **A connection is any edge, real or virtual**: a seed edge service → db/mq/ext counts (same as the mock-up's `computeFlow`). The hub is always a service, never a virtual node. | `engine/graph-state.ts`                            |
| R2-3                    | Nodes and edges never disappear during a session. They **dim** when their traffic ages out of M. Thickness counts only the last M (per-minute buckets, about 1 MB, capped).                                                                                                                                                                                                                     | `engine/buckets.ts`, snapshot `active`, components |
| R2-4                    | Forward poll every 10 s with a fixed 30 s delay. No tail re-read. Header: "Live · 30 s delay".                                                                                                                                                                                                                                                                                                  | `engine/scheduler.ts`                              |
| R2-5                    | One `serviceName`-filtered page for each service that still has no connection after the main scan.                                                                                                                                                                                                                                                                                              | `engine/scheduler.ts` probe phase                  |
| R2-6                    | DB, queue and external nodes come from the aggregate seed.                                                                                                                                                                                                                                                                                                                                      | `engine/aggregate-seed.ts`, `engine/peer-keys.ts`  |
| R2-7                    | Standalone view (a tab). One Web Worker per browser tab, shared by every view.                                                                                                                                                                                                                                                                                                                  | `session/*`, `worker/*`, tab                       |
| R2-8                    | Layout D, "centred flow", anchored. The tray holds services not connected to the hub's component.                                                                                                                                                                                                                                                                                               | `layout/layout-d.ts`                               |
| R2-9                    | The layout never breaks and every node stays reachable, from 0 nodes to hundreds.                                                                                                                                                                                                                                                                                                               | property and fixture tests, Find, tray             |
| Q19                     | Lanes are reserved on frame 1: `lanes(c) = ceil((placed_c + tray × share_c) / K)`. Reservations never shrink. An under-prediction shifts a column as one animated block.                                                                                                                                                                                                                        | `layout/layout-d.ts`, `ServiceMapCanvas` tween     |
| Q9                      | Pairing horizon H = 120 s. Late children are counted as `lateUnpaired`.                                                                                                                                                                                                                                                                                                                         | `engine/join-buffer.ts`                            |
| Q11                     | SQLite budget: 1 request at a time, ≥100 ms gap, ≤200 requests per scan, ≤1000 spans per page. Benchmark of ingest p99 during a scan. **One shared 200-request budget** covers every request issued before the session goes live: seed (2), backward pages, forward ticks interleaved during the scan, and probes. Only live-phase forward ticks and the 5-min seed refresh are outside it.     | `engine/scheduler.ts`, Unit 7                      |
| Q13                     | No span-link messaging edges.                                                                                                                                                                                                                                                                                                                                                                   | —                                                  |
| Q16                     | No visible node limit. Internal safety cap of 2000 nodes. Above it, the header says the map is incomplete.                                                                                                                                                                                                                                                                                      | `engine/graph-state.ts`, header                    |
| Q18                     | Bad timestamps are counted as a diagnostic and never move the window.                                                                                                                                                                                                                                                                                                                           | `engine/tuples.ts`                                 |
| Q20                     | No grouping.                                                                                                                                                                                                                                                                                                                                                                                    | —                                                  |
| Q2 / NFR                | No span rows are retained. **Every structure has a cap that does not depend on how long the tab stays open.**                                                                                                                                                                                                                                                                                   | all engine modules, long-run test                  |
| A1                      | Aggregate seed on frame 1, in two queries (nodes; virtual edges).                                                                                                                                                                                                                                                                                                                               | `engine/aggregate-seed.ts`                         |
| A2                      | Edge = a cross-service parent/child pair, counted once on the child. Self-calls are excluded. (R1-D1, D7)                                                                                                                                                                                                                                                                                       | `engine/join-buffer.ts`                            |
| A3                      | Bounded join buffer `seen` / `pending`, with a total cap of about 50k (**every** `seen` entry plus **every child entry inside the `pending` lists** counts, not just the parent keys). Capacity evictions count as `dropped` and **never** become virtual edges. Entries are tagged with their region (back/fwd) and expire only under that region's rules (§2.1 step 6).                       | `engine/join-buffer.ts`                            |
| A5 (backward part only) | Backward DESC scan with `timestampMin = now − M`, `timestampMax = T0 − 1`, following the cursor. Watermarks come from the wall clock. Adjacent duplicates are skipped.                                                                                                                                                                                                                          | `engine/scheduler.ts`                              |
| A6 (reduced per §0)     | Stop on coverage ≥ M, the request budget, no cursor, or an error.                                                                                                                                                                                                                                                                                                                               | `engine/scheduler.ts`                              |
| A7                      | Per-minute buckets, ring of 61.                                                                                                                                                                                                                                                                                                                                                                 | `engine/buckets.ts`                                |
| A8                      | Worker owns a `KopaiClient`: fetch → zod → tuples → join → buckets. Throttled snapshots (750 ms), `AbortController`, pause while hidden, restart if hidden for more than M.                                                                                                                                                                                                                     | `worker/*`, `session/*`                            |
| §5.5                    | Lanes `K = clamp(ceil(sqrt(N)), 6, 14)`, fit ≤ 100 %, open centred on the hub when the fit scale is < 0.4, level of detail (LOD) for labels < 7.5 px, truncation at 20 chars, Find, tray, fixtures, test plan.                                                                                                                                                                                  | layout and components                              |

### Plan-level decisions (not in §0; flagged for review)

These fill gaps that §0 leaves open. Each is the smallest choice that stays consistent with §0.

- **PD-1 Probes need the other end of the call.** A `serviceName`-filtered page (R2-5) holds only service X's spans, so it cannot pair X with anyone on its own. The probe is therefore: one page (`serviceName = X`, DESC, window `[now − M, coverageFrom − 1]`, limit 1000), then `getTrace` for **at most 2** distinct trace IDs from that page that contain an X span with a non-empty `ParentSpanId` or kind Client/Producer. Pairs inside each trace feed the normal edge path. Only children whose start is before `coverageFrom` are counted, so nothing is counted twice with the main scan. At most **50 services** are probed, busiest first, each costing ≤3 requests. Probes **draw from the shared 200-request scan budget** (Q11): the probe phase gets `min(remaining, 50 × 3)` requests and stops the moment the budget reaches 0, even in the middle of a service's probe. It is serial and gapped like everything else.
- **PD-2 Seed refresh.** The two A1 aggregate queries run again every **5 min** over `[now − M, now]`, through the same serial queue. Node span counts, error rates and virtual edges come from the latest seed. That is what makes virtual edges dim (R2-3). New virtual nodes therefore appear with up to 5 min of lag. The refresh is part of the live phase, so it does not count against the 200-request scan budget (the **first** seed does).
- **PD-3 Forward-tick cap.** One forward tick reads ASC pages over `[Wf, now − 30 s − 1]` until there is no cursor, or until it has read **20 pages**. If the cap is hit, `Wf` becomes the last row's timestamp. Rows at exactly that nanosecond are re-read and dropped by a boundary set of `spanId`s, and the header shows "Live · behind by N s". Otherwise `Wf ← now − 30 s`. The boundary set holds only the `spanId`s at that one nanosecond and is **capped at `PAGE_LIMIT` (1000) entries**: it is rebuilt from the last page each time, and if more than 1000 rows share one nanosecond the extras are not tracked (a rare re-read is caught by the adjacent-duplicate guard or counted as `dupes`). Forward ticks that run **during** the scan (seeding, scanning, probing) count against the 200-request budget; live-phase ticks do not.
- **PD-4 Coverage is one interval** `[coverageFrom, coverageTo)` = `[oldest backward row ts, Wf)`, trimmed to `now − M`. A hidden-tab gap shorter than M is caught up by the forward poll from `Wf`. A gap longer than M restarts the session (A8), so no interval set is needed.
- **PD-5 Edge cap 2500** (≈0.9 MB of buckets: 61 minutes × (Uint32 calls + Uint16 errors) per edge, about 366 B). Overflow counts as `edgesDropped`, and the header says the map is incomplete. Nodes use `lastSeenMs`, not buckets.
- **PD-6 Engine location.** The engine lives in `packages/ui` (not `@kopai/core`), because only the map uses it and the worker bundles it from there. It has no React or DOM imports, so it can move later.
- **PD-7 Client prop.** `ObservabilityPage` keeps `client?: KopaiClient`. A `KopaiClient`'s base URL and headers are private and cannot be passed to a worker. So when a **custom** client is passed in, the engine runs in-process on the main thread with that client (same engine, same snapshots) unless the new optional prop `serviceMapWorker={{ baseUrl, headers?, token? }}` is given. With the default client (the Kopai app), the worker is used. **Session keys:** in-process sessions are keyed by the client **instance** (`WeakMap<ServiceMapClient, Session>`), because a custom client's base URL is private and two different clients may share one. Worker sessions are keyed by `absoluteBaseUrl + "\n" + stable JSON of {headers, token}`, so two views with the same server and the same auth share one worker, and different auth never shares.
- **PD-8 Probe reserve.** Without a reserve, a large dataset spends the whole budget on backward pages and the probes (R2-5) never run, which is exactly when they matter. So the backward phase stops when `remaining ≤ PROBE_RESERVE = 15` requests (enough for 5 probed services), with `stopReason: "budget"`. Unused reserve is simply not spent. Seed (getServices + 2 aggregates) + backward + interleaved forward + probes is still ≤ `SCAN_MAX_REQUESTS = 50` in total. (Planned as 30 of 200; changed at the user's request.)
- **PD-9 Virtual targets per source.** R1-D3a's high-cardinality rule applies to the seed: per source service, the top **20** virtual targets by calls keep their own node; the rest are folded into one `ext:<src>/other` node (calls and errors summed). This keeps IP or pod-name `server.address` values from using up `EDGE_CAP`. A target that drops out of a source's top 20 at a seed refresh keeps its existing node (nodes never disappear, R2-3); it just stops getting traffic and dims.

---

## 2. Module boundaries

Everything lives under `packages/ui/src/components/observability/ServiceMap/`. Dependencies point only downward in this list.

```
ServiceMap/
  engine/            PURE. No React, no DOM, no Worker. Injectable clock + client.
    config.ts          constants (M_MS=3_600_000, DELAY_MS=30_000, POLL_MS=10_000,
                       PAGE_LIMIT=1000, GAP_MS=100, SCAN_MAX_REQUESTS=50, H_MS=120_000,
                       SKEW_MS=5_000, JOIN_CAP=50_000, NODE_CAP=2000, EDGE_CAP=2500,
                       SNAPSHOT_MS=750, SEED_REFRESH_MS=300_000, PROBE_MAX_SERVICES=50,
                       PROBE_RESERVE=15, FWD_MAX_PAGES=20, VIRTUAL_PER_SOURCE=20)
    types.ts           SpanTuple, SeedNode, SeedEdge, ServiceMapSnapshot, Diagnostics,
                       ScanState, ServiceMapClient = Pick<KopaiClient,
                       "searchTracesPage" | "queryTracesAggregate" | "getTrace">,
                       Clock = { now(): number; sleep(ms, signal): Promise<void> }
    time.ts            ns string <-> ms, minute index, ISO for timeDimension
    tuples.ts          OtelTracesRow -> SpanTuple {spanId, parentId, svc, kind, tsMs,
                       endMs, err}; bad-timestamp check (Q18); adjacent-dupe key (R1-D21)
    peer-keys.ts       R1-D3/D4/D6 priority list + ids (db:/mq:/ext:) + host normalisation
                       + D3a same-name rule + messaging receive direction flip
    aggregate-seed.ts  builds the 2 A1 KopaiQuery bodies; parses rows -> SeedNode[]/SeedEdge[];
                       per-source cap (top 20, rest -> ext:<src>/other, PD-9)
    join-buffer.ts     A3 seen/pending tagged back|fwd, capped LRU-by-insertion (cap counts
                       seen entries + every pending child), per-region horizon expiry,
                       counters {dropped, lateUnpaired, dupes, selfCalls}
    buckets.ts         A7 per-edge 61-minute ring (typed arrays), global span ring,
                       sumLastM(key, nowMs), cap EDGE_CAP
    graph-state.ts     monotonic node/edge registry (never removes), caps, hub choice
                       (R2-2), snapshot builder (active/dim flags, weights)
    scheduler.ts       scan state machine: seed -> backward -> probes -> live;
                       single serial request queue (gap, budget, abort, pause, backoff)
    engine.ts          createServiceMapEngine({client, clock, config?, onSnapshot})
                       -> {start, pause, resume, retry, stop}; snapshot throttle
    index.ts
  layout/            PURE. No React.
    constants.ts       ROW=64, LANE=170, COL_GAP=50, TRAY_COL=160, TRAY_ROW=54,
                       MIN_FIT_SCALE=0.4, LABEL_MIN_PX=7.5, LABEL_PX=11.5, NAME_MAX=20
    layout-d.ts        updateLayout(prev, graph) -> {state, positions, tray, shifts, bounds}
    viewport.ts        initialViewport(bounds, size, hubPos), labelsVisible(zoom),
                       truncateName(name)
    fixtures.ts        fixture graphs + discovery sequences (shared by tests and stories)
  worker/
    service-map.worker.ts  THIN shell: on "init" builds KopaiClient + engine with real
                           clock; relays pause/resume/retry/stop; posts snapshots
    create-worker.ts       dynamic import("./service-map.worker.ts?worker&inline")
    protocol.ts            message types (main <-> worker)
  session/
    session-manager.ts  one session per tab per key (worker: abs baseUrl + auth; in-process:
                        client instance via WeakMap); refcount; Worker or in-process
                        transport; visibilitychange pause/resume; StrictMode-safe
    use-service-map.ts  React hook (useSyncExternalStore over the session)
  components/
    ServiceMap.tsx        container: hook -> layout (only when the id signature changes)
                          -> canvas
    ServiceMapCanvas.tsx  React Flow (@xyflow/react); nodes, edges, tray band; animates shifts
    ServiceNode.tsx       custom node: shape by kind, hub ring, dim, error cue, LOD label
    TrayBandNode.tsx      "Not connected to the map yet · N" background band
    ServiceMapHeader.tsx  coverage counter, scan state, Live · 30 s delay, diagnostics,
                          incomplete, error + Retry
    FindBox.tsx           search over every node, tray included; centres + highlights
    Legend.tsx            shapes, edge thickness = calls in last 60 min, dimmed meaning
    edge-style.ts         fixed log-scale width; node size breakpoints (never normalised)
  test-utils/
    react-flow-jsdom.ts   shared jsdom stubs for React Flow (ResizeObserver, DOMMatrixReadOnly,
                          offsetWidth/offsetHeight, SVGElement.getBBox); used by every DOM
                          test that mounts the canvas
  ServiceMap.stories.tsx
  index.ts
```

### 2.1 Engine data flow (A1, A2, A3, A5, A7, A8)

1. **Seed (A1, R2-6)**, `[now − M, now]` as an absolute `timeDimension` (ISO):
   - Nodes: `dimensions: ["service.name", "SpanKind"]`, `measures: [COUNT as spans, ERROR_RATE as errRate]`, `output: {type:"summary"}`, `limit: 10000`. Sum the kinds per service. A result with 10000 rows sets `diagnostics.seedTruncated`.
   - Virtual edges: `filters: [{column:"SpanKind", op:"in", values:["Client","Producer"]}]`, `dimensions: ["service.name", {container:"SpanAttributes", key:"peer.service"}, "db.system.name", "db.namespace", "messaging.system", "messaging.destination.name", "messaging.operation.type", "server.address"]`, `measures: [COUNT as calls, ERROR_RATE as errRate]`. The result key for the container dimension is `"SpanAttributes.peer.service"` (verified against the running SQLite server).
   - Each row goes through `peer-keys.ts`:
     - priority `peer.service` → `db.system.name` (+`db.namespace`) → `messaging.*` → `server.address`, with ids `ext:<peer>`, `db:<system>/<namespace>`, `mq:<system>/<destination>`, `ext:<host>` (R1-D3/D4/D6);
     - the type comes from the attribute family (R1-D3 note);
     - **host normalisation** before any comparison or id: lower-case, strip a `:port` suffix (and the brackets of an IPv6 literal), strip a trailing dot. So `Cart:8080` → `cart`, `cart.default.svc.cluster.local.` → `cart.default.svc.cluster.local`;
     - **same-name drop** (R1-D3a, applied to `peer.service` and `server.address`): the target is dropped (returns `null`) when the normalised full host **or its first DNS label** equals a known service name (case-insensitive). So `cart:8080`, `cart.default.svc.cluster.local` and `cart.ns.svc.cluster.local` are all dropped when `cart` is a known service; span pairing covers that edge. Real HTTP/gRPC client spans always carry `server.address`, so without this every real service-to-service edge would get an `ext:<host>` twin. An IP literal is never matched by its first label;
     - `messaging.operation.type = receive` flips the direction to `mq → svc` and `settle` is ignored (R1-D6);
     - rows with no peer attribute are counted as `diagnostics.clientNoPeer`.
   - **Per-source cap (PD-9, R1-D3a high-cardinality rule):** after mapping, each source service keeps its top 20 virtual targets by calls (ties by id); the rest fold into `ext:<src>/other` (label "other (N targets)"). So IP or pod-name hosts cannot use up `EDGE_CAP`.
   - Remaining known limit: the aggregate still cannot apply the D3a **leaf** rule, so a `server.address` that names an uninstrumented host behind a real service call (or a host whose name matches no service, e.g. an ingress alias) still yields an `ext:` node. With the normalisation above this is limited to genuinely unknown hosts, and it is documented in the legend tooltip.
2. **Backward scan (A5, Q11)**: `T0 = start − 30 s`, `searchTracesPage({timestampMin: ns(now − M), timestampMax: ns(T0) − 1, sortOrder:"DESC", limit:1000, cursor})`, one request at a time. Every row → `tuples.ts` → `join-buffer.ingest(tuple, "back")`. Pairs → `buckets.add(edgeKey, child.tsMs, err)` and `graph-state.touch`. The hub is chosen after seed + page 1 (R2-2), and the first snapshot is posted then.
3. **Budget and stop rule (A6 per §0, Q11)**: one counter `scanRequests` counts every request before the session goes live: the 2 seed aggregates, backward pages, forward ticks interleaved during the scan, and probe requests. `SCAN_MAX_REQUESTS = 200` caps it. The backward phase stops when coverage reaches `now − M`, **or** `200 − scanRequests ≤ PROBE_RESERVE` (PD-8), **or** `nextCursor == null`, **or** an error. `stopReason ∈ {"coverage","budget","no-more-data","error"}`.
4. **Probes (R2-5, PD-1)** with `min(200 − scanRequests, 50 × 3)` requests, then **live**. When the backward phase ends, every remaining **back** pending child is counted as `lateUnpaired` and removed (its parent can no longer arrive).
5. **Forward (R2-4, PD-3)**: every 10 s, ASC over `[Wf, now − 30 s − 1]`, ingested with region `"fwd"`. It shares the join buffer with the backward scan (PR §2.2 "two instances" lesson). It runs between backward pages when due, and it is the only loop once the scan stops.
6. **Join buffer (A3, Q9)**:
   - `seen: spanId → {svc, kind, tsMs, endMs, hadXChild, region}` and `pending: parentSpanId → [{svc, kind, tsMs, err, region}]`.
   - **Cap accounting:** `size = seen.size + Σ pending lists' lengths` (every waiting child counts, not only the parent keys) and `size ≤ JOIN_CAP = 50 000`.
   - Insertion-order eviction (oldest inserted entry first, a `seen` entry or a single pending child). Each eviction does `dropped++` and is never turned into a virtual edge.
   - **Region tagging.** Each entry carries the region it was ingested in (`"back"` or `"fwd"`), and `expire(backFrontier, fwdFrontier, backDone)` applies **only that region's rules** to it. The two rule sets never see each other's entries:
     - `back` seen: expires when `e.ts > backFrontier + SKEW` **and** `e.endMs + SKEW < fwdFrontier` (the conjunctive PR §4.3 condition). The second clause keeps a back parent near `T0` alive until the forward scan has passed the window where its forward children can start.
     - `back` pending child: expires when `backFrontier < child.ts − H`, or when `backDone`; counted as `lateUnpaired`.
     - `fwd` seen: expires when `e.ts < fwdFrontier − H`. A forward parent therefore survives into later ticks and pairs with a child that arrives up to H later.
     - `fwd` pending child: expires when `fwdFrontier > child.ts + SKEW` **and** (`child.ts − H ≥ T0` **or** `backFrontier < child.ts − H` **or** `backDone`); counted as `lateUnpaired`. The second clause keeps a forward child whose parent may sit just below `T0` until the backward scan has had the chance to bring it.
   - Pairing is region-agnostic: an arriving row pairs with any matching entry, whatever its region.
   - Same-service pairs → `selfCalls++`, with no edge (R1-D7).
   - Each child counts once (R1-D1).
   - Rows whose `(Timestamp, SpanId)` matches the previous row's → `dupes++` (R1-D21).
7. **Buckets (A7, R2-3)**:
   - Edge weight = Σ calls in the minutes of `[now − M, now]`.
   - `active = weight > 0` for an edge.
   - `active = lastSeenMs ≥ now − M || seedSpans > 0` for a node.
   - Inactive nodes and edges are **dimmed, never removed**.
8. **Snapshot** (≤ 1 per 750 ms, plus one immediately after the hub is chosen):

```ts
interface ServiceMapSnapshot {
  seq: number;
  hub: string | null;
  nodes: {
    id: string;
    label: string;
    kind: "service" | "database" | "messaging" | "external";
    spans: number;
    errorRate: number;
    active: boolean;
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    calls: number;
    errors: number;
    active: boolean;
    virtual: boolean;
  }[];
  coverage: { fromMs: number | null; toMs: number | null; windowMs: number }; // windowMs = M
  spansInWindow: number;
  scan: {
    state:
      "idle" | "seeding" | "scanning" | "probing" | "live" | "paused" | "error";
    stopReason: "coverage" | "budget" | "no-more-data" | "error" | null;
    requests: number;
    maxRequests: number;
    behindMs: number;
  };
  diagnostics: {
    dropped: number;
    lateUnpaired: number;
    dupes: number;
    badTimestamp: number;
    selfCalls: number;
    clientNoPeer: number;
    nodeCapHit: boolean;
    edgesDropped: number;
    seedTruncated: boolean;
  };
  error: string | null; // last error; the graph is kept (last good graph)
}
```

### 2.2 Layout D (R2-8, R2-9, Q19, §5.5)

`updateLayout(prev: LayoutState | null, g: {nodes, edges, hub}) → {state, positions, tray, shifts, bounds}` is pure and deterministic. It does not mutate `prev`, and all iteration orders are sorted (calls desc, then id). It ports `computeFlow` from `mockup-scale.js` (lines 102–175), turning the mock-up's pre-staged frames into an incremental function:

- **Order:** BFS from the hub over undirected adjacency, with neighbours sorted by calls desc (mock-up `order`). Nodes not reached go to the **tray**.
- **Column:** callees get `+d` (shortest directed distance from the hub). Callers get `−d` (shortest directed distance to the hub). Otherwise the column is the strongest placed neighbour's column ±1. Once placed, a node keeps its column (anchoring).
- **Row:** `K = clamp(ceil(sqrt(N)), 6, 14)`, where N = node count on frame 1, fixed for the session. Rows run `lo = −floor((K−1)/2) … lo+K−1`. The row is the free slot nearest to an adjacent-column neighbour's row (score `|r − dRow| + 2.5·lane`). The hub sits at (0,0).
- **Q19 reservation on frame 1:** frame 1 is the first call with a non-null hub. Pass 1 assigns a column to every reachable node. Then `reserved(c) = max(1, ceil((placed_c + tray × placed_c / placedTotal) / K))`. Pass 2 assigns rows and lanes. A column created later starts with 1 reserved lane. When a column is full, it gets a new lane: `reserved(c)` grows (it never shrinks), and if any placed node sits in a column further out, a `ShiftEvent {fromColumn, dx}` is returned so the canvas can animate the block. (`ShiftEvent`s drive the animation; the regression baseline counts **node moves**, defined below, not events.)
- **x:** `xOf(c, lane)` from the mock-up, with `LANE = 170` and `COL_GAP = 50`, using `max(reserved, used)` lanes. **y:** `row × 64`.
- **Tray:** below the reserved rows, top = `(hi + 1) × 64 + 70`. `perRow` is fixed on frame 1 at `max(4, floor(reservedWidth / 160))`. **Tray order is fixed on frame 1** (spans desc at that moment, then id) and stored in `LayoutState` as a slot list. Seed refreshes (PD-2) never re-sort it. A node that enters the tray later is **appended** to the next slot after the last used one. A node that leaves the tray (it connected) frees its slot, which stays empty; the other tray nodes **do not move**. Slot `i` sits at `(i mod perRow, floor(i / perRow))`, so a tray node's position never changes while it stays in the tray. (Slot count is bounded by `NODE_CAP`.)
- **Moves (what the shift baseline counts):** like the mock-up's `runChecks`, a **node move** is a node present in two consecutive frames whose position changed by more than 1 px. Leaving the tray for the map is a placement, not a move, and is not counted.
- **Empty graph or null hub:** empty output, no NaN.

`viewport.ts` (§5.5):

- `initialViewport` fits the whole map at `zoom = min(1, fit)`, so the fit never zooms past 100 %. If `fit < 0.4`, it opens centred on the hub at zoom 0.8, with `minZoom = min(0.05, fit)` so that zooming out shows everything.
- `labelsVisible(zoom) = 11.5 × zoom ≥ 7.5`.
- `truncateName` cuts names longer than 20 characters and appends "…".

---

## 3. Web Worker packaging (R2-7, A8)

**Approach: Vite-compatible `?worker&inline` import, implemented for the tsdown library build by a small rolldown plugin. The worker becomes a self-contained IIFE string inside `@kopai/ui`'s dist and starts from a Blob URL.**

- `worker/create-worker.ts`:
  ```ts
  export async function createServiceMapWorker(): Promise<Worker> {
    const { default: ServiceMapWorker } =
      await import("./service-map.worker.ts?worker&inline");
    return new ServiceMapWorker({ name: "kopai-service-map" });
  }
  ```
  `vite/client` (already referenced by `packages/ui/src/vite-env.d.ts`) declares `*?worker&inline`. The plan checked that `tsc` with the repo's NodeNext config accepts this relative specifier.
- `packages/ui/build/inline-worker-plugin.ts` (new), registered in `packages/ui/tsdown.config.ts` `plugins: [inlineWorkerPlugin()]`:
  - `resolveId`: a specifier ending in `?worker&inline` → `\0inline-worker:<abs path>`.
  - `load`: `rolldown({ input, platform: "browser", transform: { define: { "process.env.NODE_ENV": '"production"' } } })` → `generate({ format: "iife", minify: true, codeSplitting: false })`. It **bundles everything**: `@kopai/sdk`, `@kopai/core`, `zod`. It returns:
    ```js
    const src = "<iife code>";
    export default function ServiceMapWorker(options) {
      const url = URL.createObjectURL(
        new Blob([src], { type: "text/javascript" })
      );
      try {
        return new Worker(url, { name: options?.name });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    ```
    This is the same contract and the same revoke-after-construct pattern as Vite's own inline worker.
  - New dev dependency: `rolldown@1.2.15`, the exact version tsdown 0.23.1 already uses. The plan probed it: an IIFE that bundles `@kopai/sdk` is 175 KB minified, with no `import` and no `require`. Rolldown resolves the engine's `./x.js` specifiers to `.ts` files without extra config (verified in review), so no extension alias is needed.
  - **Type-check and lint gate for the plugin:** `packages/ui/tsconfig.json` only includes `src`, and `lint` is `eslint src`. Unit 4 adds `packages/ui/tsconfig.build.json` (`extends: "@kopai/tsconfig/node.json"`, `noEmit`, `include: ["build", "tsdown.config.ts"]`) and changes the scripts to `"type-check": "tsc --noEmit && tsc --noEmit -p tsconfig.build.json"` and `"lint": "eslint src build tsdown.config.ts"`. The root ESLint config is not type-aware, so linting `build/` needs no parser project change.

**Why it works for a tsdown library plus a Vite app:**

1. The consumer (`packages/app` vite, or any other bundler) sees **only a JS string and a function**. There is no `new URL(..., import.meta.url)` for it to detect inside `node_modules`, no separate worker asset to copy, and no bare imports left in the worker. So it works the same in the ESM build, the CJS build (which has no `import.meta`), under `@fastify/vite`'s `useRelativePaths`, and in third-party apps.
2. The dynamic `import()` makes tsdown split it into its own chunk. The ~175 KB worker string and the map code load only when the Service Map tab opens (R1-NFR7, lazy).
3. Vitest and Storybook are Vite, so they understand `?worker&inline` natively. Tests never load it anyway: the session falls back to in-process when `typeof Worker === "undefined"`, and stories feed fixture snapshots straight into the canvas.
4. The Kopai app sends no CSP header (checked: no CSP or helmet in `packages/app`/`packages/api`). If a host's CSP blocks `blob:` workers, `new Worker` throws, and the session manager falls back to the in-process engine.

**Rejected alternatives:**

- `new Worker(new URL("./w.js", import.meta.url), {type:"module"})` in the library: it breaks the CJS build, depends on the consumer's bundler detecting the pattern in a dependency, and leaves `@kopai/sdk` as a bare import inside the worker.
- An app-side `?worker` entry wired by `packages/app`: it couples every consumer of `@kopai/ui` to Vite and to extra wiring.

**Fetching from a Blob worker:** relative URLs cannot resolve against `blob:`. So the session manager passes an **absolute** `baseUrl = new URL(baseUrl || "/", location.href).href.replace(/\/$/, "")` in the `init` message, plus `headers`/`token` when given (PD-7).

**Worker typing:** the repo lib is `["ES2022","DOM"]`, without `WebWorker`. The shell uses a minimal local interface `{ postMessage(m: WorkerOut): void; addEventListener("message", …) }` over `globalThis`. It does not change the tsconfig.

**Sharing (R2-7):**

- `session-manager.ts` keeps a module-level `Map<workerKey, Session>` for worker sessions, where `workerKey = absoluteBaseUrl + "\n" + stableJson({headers, token})`, and a `WeakMap<ServiceMapClient, Session>` for in-process sessions keyed by the client instance (PD-7). Each has a refcount, so every view in a tab with the same key shares one engine.
- When the refcount reaches 0, the session is **paused** after a 1 s grace period: the graph stays in the engine and the layout in the session, so returning to the tab shows the map at once and the scan continues. A session nobody comes back to within M (60 min) is stopped. The grace period means a React StrictMode double mount never starts two loops (PR P20).
- `visibilitychange` → `pause` / `resume`. When hidden for longer than M → `restart` (A8).

---

## 4. Implementation units

Every unit leaves the repo green. Shared check commands:

- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`
- the unit's targeted `pnpm vitest run …`

Run `pnpm build` (≈9 s) after Units 4, 6 and 7. `@kopai/core` and `@kopai/sdk` are not changed, so no upstream rebuild is needed. Prettier: `pnpm exec prettier --check <changed files>`.

**Test-time rules** (the root `vitest.config.ts` sets `environment: "node"` and `testTimeout: 15_000`, and notes CI runners are about 25× slower than a dev machine):

- Every test file that touches the DOM (`document`, `window`, React rendering) starts with the `/** @vitest-environment jsdom */` docblock, as the existing UI tests do. That includes `session-manager.test.ts` (it uses `document.visibilityState`).
- No hard wall-clock threshold runs on CI. Timing assertions are scaled by `KOPAI_PERF_SCALE` (default `1` locally, `25` when `process.env.CI` is set) or are local-only (`it.skipIf(process.env.CI)`); each test says which.
- Long-running tests get an explicit per-test timeout and a size chosen to finish in < 2 s locally.

**The running server on :8000 / :4318.** At planning time it was PID 667817, `node ./dist/cli.mjs start` with cwd **this worktree's** `packages/app`, and `SQLITE_DB_FILE_PATH=<scratchpad>/kopai-dev.db`: a **file** DB, not in-memory. `pnpm build` (Units 4, 6, 7) deletes and rewrites `packages/app/dist` (tsdown `clean`, vite `emptyOutDir`) under that live process, so its UI can break after the first build; the API and collector keep working because their modules are already loaded. That is expected. Unit 7 ends by **restarting** :8000 from the new build with the same `SQLITE_DB_FILE_PATH` (the data is kept) and leaving the demo script streaming, because the user asked to "keep the dev server running with populated data". Units 1–6 do not stop it and do not bind :8000/:4318.

Constraints for every unit:

- No git commits.
- No AI/Claude attribution.
- Do not stop the server on :8000/:4318 before Unit 7's final restart step.
- Do not leave a Storybook dev server or any throwaway static server running.

### Unit 1: Engine primitives (pure)

**Implements:** A2, A3, A7, Q9, Q16, Q18, R2-2, R2-3, R2-6, A1 (query building and parsing), R1-D1/D3/D3a/D4/D6/D7/D21, PD-5, PD-6.

**Files (new):**

- `ServiceMap/engine/{config,types,time,tuples,peer-keys,aggregate-seed,join-buffer,buckets,graph-state,index}.ts`
- Tests: `engine/{tuples,peer-keys,aggregate-seed,join-buffer,buckets,graph-state}.test.ts`

**Steps:**

1. `config.ts` and `types.ts` exactly as in §2.1. `ServiceMapClient` is a `Pick` of `KopaiClient` (type-only import from `@kopai/sdk`).
2. `time.ts`: `nsToMs(ns: string)` via `Number(ns.slice(0,-6))` with a `BigInt` fallback; `msToNs(ms): string`; `minuteOf(ms)`.
3. `tuples.ts`: `toTuple(row, windowLoMs, nowMs)` returns a tuple, or `null` with a `badTimestamp` reason (zero, future beyond SKEW, or outside the window). An adjacent-duplicate guard with `lastKey`.
4. `peer-keys.ts`: `normaliseHost(s)` and `virtualTarget(row, knownServices)` → `{id, label, kind, direction} | null` (rules in §2.1 step 1, including the port strip and the full-host / first-DNS-label same-name drop).
5. `aggregate-seed.ts`: `buildSeedQueries(nowMs, M)` returns the two `TraceAggregateQuery` objects (they must pass `kopaiQuery.TraceAggregateQuerySchema.parse`). `parseSeed(nodeRows, edgeRows)` → `{nodes, edges, truncated}`, applying the per-source top-20 cap (PD-9).
6. `join-buffer.ts`: `createJoinBuffer({cap, horizonMs, skewMs, t0Ms})` with `ingest(tuple, region:"back"|"fwd") → Pair[]`, `expire(backFrontierMs, fwdFrontierMs, backDone)` and `size()`. Entries carry their region; expiry is per region exactly as in §2.1 step 6; `size()` = `seen.size` + total pending children. Counters as in §2.1 step 6. It never stores rows, only tuples.
7. `buckets.ts`: a typed-array ring of 61 minutes per edge key, `add`, `sumLastM`, `trim`, a global span ring, and the `EDGE_CAP` limit with an `edgesDropped` counter.
8. `graph-state.ts`:
   - a monotonic registry that never deletes;
   - `NODE_CAP = 2000` → `nodeCapHit`;
   - `chooseHub(seedNodes, edges)` per R2-2: candidates are **services** with ≥1 edge of **any** kind (real or virtual, so a service whose only edge goes to a DB qualifies); busiest by spans, ties by name; fallback the plain busiest service; once set, it is immutable;
   - `buildSnapshot(nowMs)` with `active` flags.

**Acceptance:**

- Join across pages: a child on page 1 and its parent on page 3 (DESC) → exactly one edge `parent.svc → child.svc`. Parent before child (ASC) → one edge.
- Same service → no edge, `selfCalls++`. A duplicated adjacent row → `dupes++` and no double count.
- With the cap exceeded, oldest entries are evicted, `dropped` equals the eviction count, and no virtual edge comes from an eviction.
- A child whose parent never arrives within H=120 s of scan distance → `lateUnpaired` counts it, and the pending entry is gone.
- **Shared buffer, region rules (two required cases):**
  - A forward parent ingested in tick n pairs with its child ingested in tick n+1 (child 8 s later, `expire()` called between the ticks with `fwdFrontier` advanced by 10 s) **while the backward scan is still running** (`backFrontier` well below both, `backDone = false`). Exactly one edge.
  - A backward pending child survives a forward `expire()`: ingest a back child with no parent, call `expire()` with `fwdFrontier` far beyond `child.ts + SKEW` and `backFrontier` still above `child.ts − H`; the child is still pending, `lateUnpaired` is 0, and its parent arriving on the next back page gives one edge.
  - Also: a back parent at `T0 − 1 s` pairs with a forward child at `T0 + 2 s` after the backward frontier has moved 30 min further down (the conjunctive back-`seen` rule keeps it).
  - When `backDone` becomes true, every remaining back pending child moves to `lateUnpaired`.
- Cap accounting: with one parent key holding 10 pending children, `size()` is 10 (plus seen entries), and filling past `JOIN_CAP` with many children of a few parents evicts children one by one (`dropped` counts children, not keys).
- A bucket older than M stops counting: `sumLastM` drops and the edge's `active` becomes false, but the edge stays in the snapshot (dim, R2-3).
- Long run (explicit `{ timeout: 60_000 }`): ingesting **200k** synthetic tuples over a simulated 24 h (time compressed, with periodic `expire`/`trim`) keeps `size() ≤ 50k`, `edges ≤ 2500` and `nodes ≤ 2000` at every checkpoint (the caps do not depend on session length).
- Bad timestamps (0, future, outside the window) → `badTimestamp++`, and the window bounds are unchanged.
- `peer-keys`:
  - `peer.service=orders-db` with `db.system.name=postgresql` → `db:orders-db`;
  - `db.system.name` with `db.namespace` → `db:postgresql/shop`;
  - `receive` → direction `mq → svc`;
  - `server.address` equal to a known service → `null`;
  - `server.address = "cart:8080"` with known service `cart` → `null`;
  - `server.address = "cart.ns.svc.cluster.local"` (and `"cart.default.svc.cluster.local."`) with known service `cart` → `null`;
  - `server.address = "api.stripe.com:443"` → `ext:api.stripe.com`; `"10.0.0.5:5432"` → `ext:10.0.0.5` (IP literals are never matched by first label).
- Per-source cap: a source with 30 distinct `server.address` IPs yields 20 `ext:` targets plus one `ext:<src>/other` whose calls equal the sum of the other 10; other sources are unaffected.
- The seed queries validate against the core zod schema. `parseSeed` sums the kinds per service and sets `truncated` at 10000 rows.
- Hub (`chooseHub`):
  - the busiest connected service wins over a busier unconnected one;
  - **pinned virtual-edge case:** service `batch` (900 spans) whose only edge is the seed edge `batch → db:postgresql/main`, and services `a` (500) → `b` (400) connected by a real edge: the hub is `batch` (a virtual edge counts as a connection), and a virtual node is never chosen;
  - with nothing connected, the plain busiest service wins;
  - ties are broken by name; once set, the hub does not change.

**Verify:**

- `pnpm vitest run packages/ui/src/components/observability/ServiceMap/engine`
- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`

### Unit 2: Scan scheduler and engine facade (pure, injectable clock and client)

**Implements:** A5 (backward), A6 per §0, A8 (throttle, abort, pause), R2-1, R2-2 (timing), R2-4, R2-5, Q11 (shared budget), PD-1…PD-4, PD-8.

**Files (new):**

- `ServiceMap/engine/{scheduler,engine}.ts`
- Tests: `engine/scheduler.test.ts`, `engine/engine.test.ts`, test helpers `engine/test-utils.ts` (fake clock, scripted mock `ServiceMapClient`, synthetic trace generator)

**Steps:**

1. **Request queue:** one in-flight request globally, `≥ GAP_MS` between the end of one request and the start of the next, one `AbortSignal` per run, exponential backoff on error (1 s → 30 s), last good graph kept.
2. **Phases:**
   - `seeding` (2 aggregate calls) → `scanning` (backward pages, with forward ticks interleaved when due) → `probing` (PD-1) → `live` (forward ticks every 10 s; seed refresh every 5 min, PD-2).
   - The hub is chosen after seed + backward page 1, then the first snapshot is emitted.
3. **Budget (Q11, one shared counter):** `scanRequests` counts **every** request from the first seed call until the session goes live: 2 seed aggregates, backward pages, forward ticks interleaved during the scan, and probe requests (`searchTracesPage` + `getTrace`). `SCAN_MAX_REQUESTS = 200` caps the total. The backward phase stops at `200 − scanRequests ≤ PROBE_RESERVE (30)` (PD-8); probes then get `min(200 − scanRequests, 50 × 3)`. Live-phase forward ticks and seed refreshes are not counted. Every page uses `limit: 1000` and always sends `timestampMin` (PR P19).
4. **Coverage (PD-4):**
   - `fromMs` = last backward row ts;
   - `toMs` = `Wf` (or `T0` before the first tick);
   - the header string comes from a pure helper `formatCoverage(snapshot)` → "covers 6 of 60 min".
5. **Pause/resume:** pause stops new requests (in-flight ones finish). Resume after a gap > M → `restart()`, which creates a fresh state.
6. **Engine facade:** throttles snapshots to 750 ms through the injected clock. `stop()` aborts and leaves no pending timers.

**Acceptance (all with a fake clock and a mocked client, no network):**

- The first calls are exactly: 2 × `queryTracesAggregate`, then `searchTracesPage` with `sortOrder:"DESC"`, `limit:1000`, `timestampMin = ns(now − 60 min)`, `timestampMax = ns(now − 30 s) − 1`.
- Requests never overlap, and the gap between them is always ≥100 ms (asserted on recorded timestamps).
- **Shared budget:** with 500 backward pages available and 60 unconnected seed services, the total number of client calls before the state becomes `live` is **≤ 200** (seed + backward + interleaved forward + probes all counted), `stopReason` is `"budget"`, the backward phase stops as soon as the remaining budget is ≤ `PROBE_RESERVE` (with a mock where no forward data exists, exactly `PROBE_RESERVE` = 30 remain), interleaved forward ticks also stop paging when the budget is 0, and the probes stop when the budget hits 0. Reaching `now − M` → `"coverage"`. `nextCursor: null` → `"no-more-data"`. After going live, forward ticks and the 5-min seed refresh keep running and are not counted.
- Forward tick: 10 s after the scan starts, a request goes out with `sortOrder:"ASC"` and `timestampMax = ns(now − 30 s) − 1`, and no request ever covers `[now − 30 s, now]` (no tail re-read). The 20-page cap → `behindMs > 0` (PD-3).
- Probe: a service that is in the seed but has no edge after the scan gets exactly one `serviceName` page and ≤2 `getTrace` calls. An edge found inside such a trace appears once. At most 50 services are probed, and never more than the remaining shared budget allows.
- PD-3 boundary set: a forward tick that hits the 20-page cap with 1500 rows at the last nanosecond keeps at most 1000 boundary `spanId`s.
- The hub stays the same after later pages bring a busier connected service (R2-2).
- An error on page 5 → state `error`, the previous nodes and edges are still in the snapshot, and `retry()` resumes from the cursor.
- `stop()` aborts the in-flight request (the signal is aborted), and no further client calls happen.
- Snapshots arrive at most once per 750 ms.
- A 30-minute simulated live run (fake clock, small synthetic pages; explicit `{ timeout: 60_000 }`) keeps every structure within its cap.

**Verify:**

- `pnpm vitest run packages/ui/src/components/observability/ServiceMap/engine`
- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`

### Unit 3: Layout D with Q19 lane reservation (pure) and property tests

**Implements:** R2-8, R2-9, Q19, §5.5 (lanes, fit, LOD, truncation, fixtures, test plan). Reference: `mockup-scale.js` `computeFlow` and `mockup-layouts.html` `layoutFlow()` and its "Scale check for layout D" section.

**Files (new):**

- `ServiceMap/layout/{constants,layout-d,viewport,fixtures}.ts`
- Tests: `layout/layout-d.test.ts` (fixtures, tray order, move baseline), `layout/layout-d.property.test.ts` (fast-check, bounded), `layout/layout-d.perf.test.ts` (600-node median timing, env-scaled), `layout/viewport.test.ts`
- `packages/ui/package.json`: dev dependency `fast-check` (`pnpm --filter @kopai/ui add -D fast-check@^4`)

**Steps:**

1. Port `computeFlow` into the incremental `updateLayout` (§2.2). Add the two-pass frame-1 reservation and `ShiftEvent`s.
2. `fixtures.ts`: deterministic ports of `genSystem` (seeded `rng`), `chain`, `star`, and the shop `NODES`/`EDGES` from the mock-up, plus:
   - `empty`, `one`, `oneWithDbs`, `twoUnconnected`, `chain15`, `shop20`, `star150`, `gen120`, `gen400`;
   - `cycles`, `selfCalls`, `hubOnlyIncoming`;
   - `longNames` (> 60 chars);
   - `columnExactlyK` (a hub with exactly K callees).

   Each fixture comes as a **discovery sequence** of graphs (the mock-up's `stage`), so tests and stories replay frames 1…5.

3. `viewport.ts` per §2.2.

**Acceptance:**

- Property tests (`layout-d.property.test.ts`), with explicit bounds so CI stays inside the 15 s timeout: `fc.assert(..., { numRuns: 60, seed: <fixed>, endOnFailure: true })`, graphs of **0–150 nodes** and ≤ 2.5 edges per node, 1–5 discovery frames, random edge weights. Plus one deterministic property case of **exactly 600 nodes × 5 frames** (`numRuns: 3`). The suite has `{ timeout: 60_000 }`. They check:
  - no NaN or infinite positions;
  - no two placed nodes closer than 64 px vertically within one lane or 170 px across lanes (no overlap), and no tray node overlapping another;
  - the hub is at (0,0) on every frame and the hub id never changes;
  - a placed node's position changes **only** by whole-column `ShiftEvent` dx, never otherwise;
  - a tray node's position never changes while it stays in the tray (fixed tray order, §2.2);
  - the same input sequence gives deep-equal output (determinism).
- **Timing (separate test, `layout-d.perf.test.ts`):** gen-style graph of 600 nodes, all 5 frames, one warm-up, then the **median of 7 runs** measured with `performance.now()`. The threshold is `50 ms × KOPAI_PERF_SCALE` (scale 1 locally, 25 when `process.env.CI` is set, so CI only catches gross regressions). The test logs the measured median.
- Fixture tests:
  - `empty` → no positions;
  - `one` → hub at (0,0), empty tray;
  - `oneWithDbs` → DBs in column +1;
  - `twoUnconnected` → the busier one is the hub and the other stays in the tray (count 1);
  - `chain15` → a mid-chain hub, callers at negative columns and callees at positive ones;
  - `star150` → column +1 uses `ceil(150/K)` lanes with **0 node moves** across all frames, because they were reserved on frame 1 (its own assertion, separate from the baseline below);
  - tray order: `twoUnconnected` plus later frames where (a) a seed refresh reverses the spans order of tray nodes and (b) one tray node connects → no tray node moves, the connected one leaves its slot empty, and a newly discovered unconnected node is appended after the last slot;
  - `hubOnlyIncoming` → every node at column < 0;
  - `cycles` and `selfCalls` → terminate, no duplicate placement;
  - `columnExactlyK` → exactly 1 lane, no shift;
  - `longNames` → `truncateName` returns ≤ 21 chars ending in "…".
- **Shift baseline (node moves, counted like the mock-up):** a helper `countNodeMoves(frames)` counts, for each pair of consecutive frames, every node present in both whose position changed by more than 1 px (the mock-up's `runChecks`, `mockup-scale.js` lines 321–330). The fixtures and their ceilings from the PR §5.5 table are: `star150` ≤ **16**, `gen120` ≤ **37**, `gen400` ≤ **188** (the fixtures use the mock-up's generators and seeds and the same 5-stage discovery). The test records the measured counts as constants `MOVES_STAR150` (expected 0, see the fixture assertion above), `MOVES_GEN120` and `MOVES_GEN400`, asserts `measured ≤ recorded constant ≤ mock-up ceiling`, and fails if any count goes up. Shop20 has no mock-up number, so it is not part of the baseline.
- `viewport`:
  - one node → zoom 1 (never > 1);
  - `gen400` in a 1200×700 box → fit < 0.4, so it opens centred on the hub at zoom 0.8;
  - `labelsVisible(0.6) === false` and `labelsVisible(0.7) === true`.

**Verify:**

- `pnpm vitest run packages/ui/src/components/observability/ServiceMap/layout`
- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`

### Unit 4: Worker shell, inline-worker packaging, session manager and hook

**Implements:** R2-7, A8, PD-7, §3.

**Files:**

- New: `packages/ui/build/inline-worker-plugin.ts`
- Edit: `packages/ui/tsdown.config.ts` (add `plugins`)
- New: `packages/ui/tsconfig.build.json` (type-checks `build/` and `tsdown.config.ts`, §3)
- `packages/ui/package.json`: dev dependency `rolldown@1.2.15`; `type-check` and `lint` scripts extended to cover `build/` (§3)
- New: `ServiceMap/worker/{protocol,service-map.worker,create-worker}.ts`, `ServiceMap/session/{session-manager,use-service-map}.ts`
- Tests: `session/session-manager.test.ts` (**`/** @vitest-environment jsdom */`**; in-process transport, fake document visibility, fake timers), `worker/protocol.test.ts` (shell message handling with a fake scope; the shell's handler is exported as `handleMessage(scope, msg)` so it can be tested without a real Worker)

**Note on the dist check:** nothing in `packages/ui/src/index.ts` reaches `ServiceMap/` until Unit 6 adds the lazy tab import, so in Unit 4 the worker chunk is tree-shaken out of `dist`. The chunk checks (marker in a split chunk, not in `index.mjs`, no bare `@kopai/sdk` import) therefore move to **Unit 6**. Unit 4 only checks that the builds still succeed with the plugin registered, and exercises the plugin directly in a test (below).

**Steps:**

1. `protocol.ts`:
   - main → worker: `init {baseUrl, headers?, token?}`, `pause`, `resume`, `retry`, `stop`;
   - worker → main: `snapshot`, `fatal`.
   - The worker shell embeds the marker string `"kopai-service-map-worker"` (used to check the build).
2. `service-map.worker.ts`: about 40 lines. It builds `new KopaiClient({baseUrl, headers, token})` and `createServiceMapEngine` with the real clock (`Date.now`, `setTimeout` with abort), and relays messages. There is no logic in it beyond relaying.
3. `inline-worker-plugin.ts` per §3. It calls `this.addWatchFile` for the worker entry. Its test `packages/ui/build/inline-worker-plugin.test.ts` (picked up by the root vitest include) runs `rolldown` with the plugin on a tiny entry that imports `./w.ts?worker&inline`, where `w.ts` imports `@kopai/sdk`: the output exports a default function, contains the IIFE source as a string, and that string contains no `import`/`require` of `@kopai/sdk`.
4. `tsconfig.build.json` and the extended `type-check`/`lint` scripts (§3), so `pnpm --filter @kopai/ui type-check` and `lint` cover `build/`.
5. `session-manager.ts`:
   - `acquire({baseUrl, headers?, token?, client?})` → `{subscribe, getSnapshot, retry, release}`;
   - the transport is a Worker when the default client is used, `Worker` exists, and `createServiceMapWorker()` succeeds; otherwise it is in-process;
   - session keys per PD-7: worker sessions in a `Map` keyed by absolute `baseUrl` + stable JSON of `{headers, token}`; in-process sessions in a `WeakMap<ServiceMapClient, Session>` keyed by the client instance;
   - refcount with a 1 s release grace period, then paused; stopped after M unused;
   - `visibilitychange` handling;
   - a test-only `__resetSessionsForTests()` that stops every live session and clears timers.
6. `use-service-map.ts`: `useSyncExternalStore` over the session. It is StrictMode-safe.

**Acceptance:**

- Two `acquire` calls with the same key → one engine (one transport) and the same snapshots. Release both → paused after the grace period, stopped after M unused. Acquire, release, then acquire again within 1 s (StrictMode) → still one engine and no second scan.
- Keying: two different custom client instances with the same (private) base URL → two in-process sessions; the same instance twice → one. Two worker acquires with the same `baseUrl` but different `token` → two sessions; same `baseUrl` given once relative (`/`) and once absolute → one.
- `document.hidden = true` → `pause` is sent. Visible again → `resume`. Hidden for longer than M → `restart`.
- The worker shell handler, tested with a fake scope: `init` builds the client with an absolute `baseUrl`, and snapshots are relayed.
- The plugin test passes, and `pnpm --filter @kopai/ui type-check` / `lint` now include `build/inline-worker-plugin.ts`.
- `pnpm --filter @kopai/ui build` and `pnpm build` (the whole repo, including the app's vite build) succeed with the plugin registered. (The worker-chunk dist checks run in Unit 6, see the note above.)

**Verify:**

- `pnpm vitest run packages/ui/src/components/observability/ServiceMap/session packages/ui/src/components/observability/ServiceMap/worker packages/ui/build`
- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`
- `pnpm build`

### Unit 5: React components (React Flow), stories and perf check

**Implements:** R2-3 (dimming, thickness), R2-8 (tray), R2-9 (Find, LOD, fit), Q16 (incomplete header), Q19 (animated block shift), R2-1/R2-4 header strings, §5.5 rendering, PR §5.4 states (loading, empty, single service, error + Retry, incomplete).

**Files:**

- `packages/ui/package.json`: dependency `@xyflow/react@^12` (`pnpm --filter @kopai/ui add @xyflow/react@^12`)
- `packages/ui/src/styles/globals.css`: `@import "@xyflow/react/dist/style.css";`
- New: `ServiceMap/components/{ServiceMap,ServiceMapCanvas,ServiceNode,TrayBandNode,ServiceMapHeader,FindBox,Legend}.tsx`, `components/edge-style.ts`, `ServiceMap/index.ts`, `ServiceMap/ServiceMap.stories.tsx`
- New: `ServiceMap/test-utils/react-flow-jsdom.ts`, the **one shared** React Flow jsdom setup, following xyflow's testing guide: `installReactFlowJsdom()` stubs `ResizeObserver`, `DOMMatrixReadOnly` (parsing `scale(...)` for `m22`), `HTMLElement.prototype.offsetWidth`/`offsetHeight` (non-zero), and `SVGElement.prototype.getBBox`, and returns a restore function. Not exported from the package index.
- Tests: `components/ServiceMapHeader.test.tsx`, `components/FindBox.test.tsx`, `components/ServiceMap.test.tsx`. Every one starts with `/** @vitest-environment jsdom */`; `ServiceMap.test.tsx` calls `installReactFlowJsdom()` in `beforeAll` and restores it in `afterAll`. Unit 6's `observability.test.tsx` uses the same helper.

**Steps:**

1. `ServiceMap` (container):
   - `useServiceMap()` → snapshot;
   - **layout runs only when the sorted node-id + edge-pair signature changes** (Kiali rule, PR §2.2). Count-only changes restyle and never move anything.
   - It keeps `LayoutState` in a ref. It never clears the canvas during an update (grafana#112117).
   - It also exports a presentational `ServiceMapView({snapshot, layoutFrames?})` for stories and tests.
2. `ServiceMapCanvas`:
   - `<ReactFlow onlyRenderVisibleElements nodesDraggable={false} nodesConnectable={false} minZoom={…} maxZoom={2}>`;
   - the initial viewport comes from `initialViewport` and is applied **once**. After that, fitting only happens through the Fit button (PR P16);
   - `ShiftEvent`s → a 300 ms rAF tween of node positions, skipped under `prefers-reduced-motion`.
3. `ServiceNode`:
   - shape by kind (circle = service, rounded square = database, diamond = queue, dashed circle = external);
   - size from fixed log breakpoints of `spans` (never normalised to a running max, PR P13);
   - service hue from `getServiceColor`;
   - hub ring;
   - error cue: ≥1 % amber, ≥5 % red, plus a "!" glyph (not colour alone);
   - `active=false` → opacity 0.35;
   - label truncated by `truncateName`, full name in a `title`/tooltip;
   - label hidden when `!labelsVisible(zoom)` unless the node is hovered or found.
4. Edges:
   - default bezier with an arrow marker;
   - `strokeWidth = clamp(1 + 1.2·log10(max(1, calls)), 1, 6)` (fixed scale);
   - inactive edges dimmed;
   - virtual edges dashed;
   - only edges whose endpoints both exist (grafana#133391).
5. `TrayBandNode`: a background node behind the tray positions, labelled "Not connected to the map yet · N". Rows wrap, and every tray node stays a normal, findable node.
6. `ServiceMapHeader`:
   - "Service map · past 60 min · built from 42,180 spans · covers 6 of 60 min · scanning older…";
   - when stopped: "· stopped: request budget reached";
   - when live: "Live · 30 s delay" (or "Live · behind by N s");
   - a diagnostics line: "312 calls could not be attributed · 18 duplicate spans skipped · 0 dropped (cap) · 0 bad timestamps";
   - `nodeCapHit`/`edgesDropped`/`seedTruncated` → "Map incomplete: more than 2,000 services";
   - error → "Couldn't load more spans · Retry" (the graph is kept).
7. `FindBox`: a combobox over **all** nodes, tray included (exact match first, then substring). On select it calls `setCenter(node, {zoom: max(current, 1)})` and highlights the node; its label is forced visible.
8. `Legend`:
   - shapes;
   - "line thickness = calls in the past 60 min (sampled)";
   - dimmed = "no traffic in the past 60 min";
   - the virtual-edge note.
9. Empty and single-service states per PR §5.4: "No spans in the past 60 minutes…", and the hint "No calls between services found yet…".
10. Stories (`Observability/ServiceMap`), each with fixture snapshots replayed frame by frame through a "frame" control:
    - Empty, OneService, OneServiceWithDbs, TwoUnconnected, Chain15, Shop20, Star150, Generated120, Generated400, LongNames;
    - **Perf500x900**: a generated graph of about 500 nodes and 900 edges.

**Acceptance:**

- Header tests cover every state string above, including "covers 6 of 60 min", "Live · 30 s delay" and the incomplete message.
- FindBox finds a tray node and a database node by substring, and calls the centre callback with that node's position.
- `ServiceMap.test.tsx` renders the `shop20` snapshot in jsdom (with the shared helper) with no throw and no React Flow "parent container needs a width and a height" warning: hub label present, the tray label shows the right count, and inactive nodes carry the dim class.
- `pnpm --filter @kopai/ui build-storybook -o <tmp dir>` succeeds.
- **Perf sanity:** run the Perf500x900 story headless in Chrome (chrome-devtools MCP against the built Storybook, served from a temporary directory on a free port and stopped afterwards). Record a performance trace of a 3 s pan/zoom and note the frame rate and longest task in the unit's final report. Target: no long task > 100 ms during pan with `onlyRenderVisibleElements`. This is not a CI gate; it is recorded in the report.

**Verify:**

- `pnpm vitest run packages/ui/src/components/observability/ServiceMap/components`
- `pnpm --filter @kopai/ui type-check`
- `pnpm --filter @kopai/ui lint`
- `pnpm --filter @kopai/ui build-storybook -o "$(mktemp -d)"`

### Unit 6: Tab integration, demo data script and built-app check

**Implements:** R2-7 (standalone view as a tab), PD-7, the demo-data requirement, and the end-to-end check of §3 in the built app.

**Files:**

- Edit: `packages/ui/src/pages/observability.tsx`
  - `Tab` gets `"service-map"`;
  - `TABS` gets `{key:"service-map", label:"Service map", shortcutKey:"S"}`;
  - `readURLState` accepts `tab=service-map`;
  - render `<ServiceMapTab/>` via `React.lazy(() => import("../components/observability/ServiceMap/index.js"))`;
  - new optional prop `serviceMapWorker?: {baseUrl: string; headers?: Record<string,string>; token?: string}`.
- Edit: `packages/ui/src/components/KeyboardShortcuts/KeyboardShortcutsProvider.tsx`: optional `onNavigateServiceMap` on Shift+S, plus a GENERAL_GROUP entry (no conflict found: existing shortcuts are T, L, M, G).
- Edit: `packages/ui/src/pages/observability.test.tsx` (already `/** @vitest-environment jsdom */`): `?tab=service-map` mounts the **real** canvas, so the new test calls `installReactFlowJsdom()` from `ServiceMap/test-utils/react-flow-jsdom.ts` (the same helper as Unit 5). It runs the in-process engine with the mock client and asserts that the first calls are `queryTracesAggregate` ×2 and then `searchTracesPage` DESC. In `afterEach` it **unmounts** the page and calls `__resetSessionsForTests()`, which stops the in-process engine and clears its timers (the 10 s poll and the 1 s release grace), then checks `vi.getTimerCount() === 0` when fake timers are used. The existing tabs are unchanged.
- Optional (only if it is quick and does not put the unit at risk): clicking a service node → `pushURLState({tab:"services", service})` (PR R16).
- New: `scripts/service-map-demo.mjs`, a Node 24 script with no dependencies.
- New: `.changeset/service-map.md` (`@kopai/ui`: minor, `@kopai/app`: patch). It describes the Service Map tab, with no attribution.

**Demo script spec:**

- `node scripts/service-map-demo.mjs [--services 20] [--rate 5] [--once] [--endpoint http://localhost:4318/v1/traces] [--seed 1]`.
- It POSTs OTLP/JSON `resourceSpans` with `resource.attributes service.name` and nanosecond `startTimeUnixNano`/`endTimeUnixNano` near now (each trace starts within the last few seconds).
- Correct `kind` values (SERVER=2, CLIENT=3, PRODUCER=4, CONSUMER=5, INTERNAL=1), `parentSpanId`, and `status.code=2` on errors (~2 %, higher on `payments`).
- About 20 services at the default size:
  - `web-frontend → api-gateway →` catalog / cart / user-auth / checkout / search / recommendations;
  - `checkout →` payments / inventory / shipping / cart;
  - payments → `api.stripe.com` (`server.address`);
  - **every internal HTTP/gRPC CLIENT span** (e.g. api-gateway → cart) carries a realistic `server.address` that names the callee, mixing the forms `cart:8080`, `cart.default.svc.cluster.local` and `cart` (plus `server.port`, `http.request.method`, `url.full`), so the host-normalisation / same-name rule (§2.1 step 1) is exercised: the map must show **no** `ext:cart…` twin next to `cart`;
  - DB client spans with `db.system.name` + `db.namespace` (postgres, redis, elasticsearch);
  - `checkout →` a kafka PRODUCER with `messaging.system=kafka`, `messaging.destination.name=order-events`, and a consumer `notifications-worker` (CONSUMER child, same trace) → `api.sendgrid.com`;
  - `peer.service` on some client spans;
  - 2–3 unconnected services (a `report-cron` root span with only a DB call, a `nightly-export` with only an INTERNAL span).
- `--services N` adds generated domain services in tiers, so the 120 and 400 sizes can be tested.
- `--rate` = traces per second. `--once` backfills the last 60 min (timestamps spread across the hour) and exits. Otherwise it backfills once and then streams.
- **Body limit.** The collector uses Fastify's default 1 MiB `bodyLimit` (`packages/collector/src/index.ts`, applied to the decoded body). A 60-min backfill at 5 traces/s is about 270k spans, so it is **never** one POST. The script builds the backfill as a generator of traces and **streams** it in chunks of about **1,000 spans** per POST (`--chunk-spans`, default 1000, max 1500), and checks `Buffer.byteLength(body) < 900 * 1024` before sending; an oversized chunk is split in half until it fits. Chunks are sent one at a time with a small gap (`--gap-ms`, default 20 ms) so the backfill does not flood ingest. Streaming batches use the same chunker.
- Any non-2xx response (or a network error) logs the status and the first 200 bytes of the response body and **exits non-zero** immediately. It logs a one-line summary per chunk (spans, bytes, status) and a final total.

**Dist checks (moved here from Unit 4):** after `pnpm build`, the lazy tab import now reaches `ServiceMap/`, so:

- `grep -l kopai-service-map-worker packages/ui/dist/*.mjs` finds the marker in a split chunk and **not** in `packages/ui/dist/index.mjs` (same for the `.cjs` build);
- that chunk contains no bare `@kopai/sdk` import (`! grep -E 'from "@kopai/sdk"|require\("@kopai/sdk"\)' <chunk>`);
- the app's client bundle under `packages/app/dist/client` contains the marker in a lazily loaded chunk.

**Built-app check:** the server on :8000 caches `index.html` at startup (`@fastify/vite` production mode) and the collector port 4318 is hard-coded, so a second app instance cannot run. (The :8000 UI may already be broken by the rebuilt `dist`, see §4; it is restarted in Unit 7.)

1. `pnpm build`.
2. Run a throwaway static server written in the scratchpad (not committed), on a free port such as 8091. It serves `packages/app/dist/client/client` and proxies `/signals/*` and `/dashboards/*` to `http://localhost:8000`.
3. Run `node scripts/service-map-demo.mjs --once`.
4. With chrome-devtools MCP, open `http://localhost:8091/?tab=service-map`. Confirm that:
   - a Worker named `kopai-service-map` exists (performance/targets, or the console log the shell emits once at start with the marker);
   - network requests go to `/signals/query/traces/aggregate` and `/signals/traces/search`;
   - nodes render, with `api-gateway` (or the busiest connected service) as the centre;
   - the tray shows the unconnected services;
   - no `ext:` node duplicates an internal service (e.g. no `cart:8080` / `cart.default.svc.cluster.local` next to `cart`).
5. Stop the throwaway server afterwards.

**Acceptance:**

- The tab is reachable by clicking it, by `?tab=service-map` and by Shift+S, and the other tabs still work (the page tests pass).
- The `?tab=service-map` page test uses the shared React Flow jsdom helper, unmounts, and leaves no engine timers running.
- The dist checks above pass (marker in a split chunk, not in `index.mjs`, no bare `@kopai/sdk` import).
- `node scripts/service-map-demo.mjs --once` returns 0 against the running collector; every chunk is < 1 MiB and got a 2xx.
- The built-app check above passes, with a screenshot saved to the scratchpad.
- `pnpm type-check`, `pnpm lint` and `pnpm build` all pass.

**Verify:**

- `pnpm vitest run packages/ui/src/pages/observability.test.tsx packages/ui/src/components/observability/ServiceMap`
- `pnpm type-check`
- `pnpm lint`
- `pnpm build`
- `grep -l kopai-service-map-worker packages/ui/dist/*.mjs && ! grep -q kopai-service-map-worker packages/ui/dist/index.mjs`
- `node scripts/service-map-demo.mjs --once --services 20`
- `pnpm exec prettier --check scripts/service-map-demo.mjs packages/ui/src`

### Unit 7: Backend budget benchmark and final verification

**Implements:** Q11 (benchmark of ingest p99 during a scan), R1-NFR / PR NFR4. Final repo-wide check.

**Files (new):**

- `packages/sqlite-datasource/src/service-map-scan-budget.perf.test.ts`

**Benchmark design:**

- It uses a **temporary file DB**, because the real server writes to a file (`SQLITE_DB_FILE_PATH`) and `:memory:` understates write and lock cost. The path is `fs.mkdtempSync(path.join(os.tmpdir(), "kopai-bench-"))/bench.db`, opened exactly the way the app opens it (`initializeDatabase(filePath)` as in `packages/app/src/server.ts`, then `createOptimizedDatasource`), and the directory is removed in `afterAll`. When the benchmark is run in this session, `TMPDIR` is set to the scratchpad so the file lands there. It is seeded with about 200k spans across 60 min (20 services, realistic attribute sizes).
- **Baseline:** 30 s of ingest. `writeTraces` batches of 100 spans every 50 ms (the collector path), recording each batch's latency, including the event-loop delay measured with `perf_hooks.monitorEventLoopDelay`.
- **Under scan:** the same ingest load while the exact §0 scan pattern runs in the same process (the app runs API and collector in one process):
  - 2 seed aggregates through `queryTracesAggregate` with the A1 bodies (built inline in the test, the same shape as Unit 1);
  - then `getTraces({timestampMin, timestampMax, sortOrder:"DESC", limit:1000, cursor})`, serial, with a ≥100 ms gap, so that seed + pages stay within the shared 200-request budget (198 pages at most).
- It reports the p50/p99/max ingest latency for both phases, plus the mean and p99 scan-page latency, as a table in the test output.
- **Gate:** it asserts that the under-scan p99 is ≤ max(3 × baseline p99, baseline p99 + 50 ms). That is a loose bound, because NFR4's X was never set. The real value is the recorded numbers.
- **Not CI-blocking:** the suite is wrapped in `describe.runIf(process.env.KOPAI_BENCH === "1")`, so `pnpm test` and CI skip it. Run it on demand with `KOPAI_BENCH=1`. A CI gate is impractical: shared runners vary about 25× in speed (see the root `vitest.config.ts` comment), so a latency threshold would be flaky. The file header says this explicitly.

**Final verification:**

- `pnpm type-check`, `pnpm lint` and `pnpm build` all pass.
- The Service Map test suites pass in full: `pnpm vitest run packages/ui`.
- `pnpm vitest run packages/sqlite-datasource` is still green (the perf suite is skipped).

**Final step: restart :8000 from the new build and leave it running with live demo data.** The user asked to "keep the dev server running with populated data", which outranks the computed "do not stop it": the old process's UI is already broken by the rebuilt `dist` (§4), and `@fastify/vite` reads `index.html` only at startup, so a restart is the only way to show the feature on :8000. This runs **after** the last `pnpm build` and is the last thing the unit does.

1. Find the process that listens on :8000 (`ss -ltnp 'sport = :8000'`; it was PID 667817 at planning time; re-resolve, do not trust the number). Record its cwd (`readlink /proc/<pid>/cwd`, expected `<worktree>/packages/app`) and its environment (`/proc/<pid>/environ`), in particular `SQLITE_DB_FILE_PATH` (expected `<scratchpad>/kopai-dev.db`) and any `PORT`/`HOST`/`KOPAI_*`/`OTEL_*` variables.
2. Stop it with `kill <pid>` (SIGTERM) and wait until :8000 and :4318 are free (poll `ss`, up to 15 s; SIGKILL only if it has not exited).
3. Start the new build with the **same** DB file and env, detached, logging to the scratchpad:
   `cd packages/app && SQLITE_DB_FILE_PATH=<same path> <other recorded vars> nohup node ./dist/cli.mjs start > <scratchpad>/kopai-server.log 2>&1 &` (use `run_in_background`). The file DB keeps the data that was already ingested.
4. Wait until `curl -sf http://localhost:8000/` returns the HTML and :4318 accepts a POST.
5. Start `node scripts/service-map-demo.mjs --services 20` in the background (backfill, then streaming), logging to `<scratchpad>/service-map-demo.log`, and leave it running.
6. Check with headless Chrome that `http://localhost:8000/?tab=service-map` shows the map (worker running, hub in the centre, tray with the unconnected services, header "Live · 30 s delay" once the scan ends) and save a screenshot to the scratchpad.
7. Report the URL, the server PID, the demo PID and the two log paths. Do not end by asking the user for permission.

**Fallback (only if the restart is truly impossible, e.g. the port cannot be freed):** leave the Unit 6 static+proxy server (port 8091, serving `packages/app/dist/client/client` and proxying `/signals/*`, `/dashboards/*` to :8000) running as the URL the user opens, keep the demo script streaming, and say so explicitly in the report.

**Verify:**

- `KOPAI_BENCH=1 pnpm vitest run packages/sqlite-datasource/src/service-map-scan-budget.perf.test.ts`
- `pnpm vitest run packages/sqlite-datasource packages/ui`
- `pnpm type-check`
- `pnpm lint`
- `pnpm build`
- after the restart: `curl -sf http://localhost:8000/ > /dev/null && curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"resourceSpans":[]}' http://localhost:4318/v1/traces`
- `pgrep -f scripts/service-map-demo.mjs`

---

## 5. Risks and checks

| Risk                                                              | Mitigation / check                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tsdown's dts pass trips on the `?worker&inline` import            | The dynamic import sits inside a function with an explicit `Promise<Worker>` return type, so the specifier never reaches a `.d.ts`. Unit 4 runs `pnpm --filter @kopai/ui build`.                                                                                                                             |
| rolldown option names (`codeSplitting` vs `inlineDynamicImports`) | Probed with rolldown 1.2.15 during planning. Pin that exact version.                                                                                                                                                                                                                                         |
| React Flow CSS through a Tailwind v4 `@import` in `globals.css`   | The Unit 5 Storybook build and the Unit 6 app build both check that it renders. Fallback: import the CSS in `mount.tsx`.                                                                                                                                                                                     |
| React Flow in jsdom                                               | One shared helper `ServiceMap/test-utils/react-flow-jsdom.ts` (ResizeObserver, DOMMatrixReadOnly, offsetWidth/offsetHeight, getBBox), used by `ServiceMap.test.tsx` and `observability.test.tsx`; every DOM test has the jsdom docblock. Keep logic tests on the pure modules and presentational components. |
| SQLite seed aggregate cost over 60 min                            | PD-2 refreshes every 5 min, not every poll. Unit 7 measures it.                                                                                                                                                                                                                                              |
| Aggregate cannot apply the D3a leaf rule                          | Host normalisation + full-host/first-label same-name drop, per-source top-20 cap (PD-9), and the documented limit (§2.1). Revisit with `parent.service.name` (PR Q10b) later.                                                                                                                                |
| Slow CI runners (≈25×) and the 15 s test timeout                  | Bounded `numRuns` and node sizes, the 600-node timing in its own median-of-7 test scaled by `KOPAI_PERF_SCALE`, 200k-tuple long run with an explicit timeout.                                                                                                                                                |
| Builds rewrite `packages/app/dist` under the running server       | Expected; the :8000 UI may break between Units 4 and 7. Unit 7 restarts it from the final build with the same file DB.                                                                                                                                                                                       |

## 6. Out of scope (MVP)

Dashboard catalog component, grouping (Q20), span links (Q13), A4 parent lookup, percentiles, user-chosen M, re-centre, edge click-through filters (PR R16, beyond the optional node click).

## 7. Review notes

All 15 review points were accepted. Where the fix involved a choice, it is recorded here.

1. **Join-buffer expiry.** Entries are tagged with their region, and each region has its own rules (§2.1 step 6). Back `seen` entries use the conjunctive PR §4.3 condition, so a back parent near `T0` survives until the forward scan has passed it. Forward pending children near `T0` also wait for the backward frontier. The two required Unit 1 tests were added, plus a `T0`-boundary test and a flush of back pending children when the backward phase ends.
2. **Request budget.** One shared 200-request counter now covers seed, backward pages, forward ticks interleaved during the scan, and probes. Only live-phase forward ticks and seed refreshes are outside it. **PD-8** adds a 30-request probe reserve. Without it, a large dataset would spend the whole budget on backward pages, and R2-5 probes would never run.
3. **Shift baseline.** The ceilings are now star150 ≤ 16, gen120 ≤ 37 and gen400 ≤ 188, counted as node moves the same way the mock-up's `runChecks` counts them. Measured values are recorded as constants, and the test fails if any of them goes up. star150 = 0 stays as its own fixture assertion. shop20 was dropped from the baseline because the mock-up has no number for it.
4. **Tray order.** The order is fixed on frame 1. New tray nodes are appended. A node that leaves the tray leaves an empty slot, and the other tray nodes do not move. A property check and a fixture test cover this.
5. **Unit 4 dist check.** The worker-chunk checks moved to Unit 6, where the lazy tab import first reaches `ServiceMap/`. Unit 4 instead tests the plugin directly with rolldown. Exporting `createServiceMapWorker` from the package index was rejected because it would add public API only to satisfy a test.
6. **Running server.** The plan now says the server uses a file DB (`SQLITE_DB_FILE_PATH=<scratchpad>/kopai-dev.db`) and notes that builds rewrite `dist` under the running process. Unit 7 ends by restarting :8000 from the new build with the same DB file and env, and it leaves the demo script streaming. The 8091 static+proxy server is kept only as a stated fallback. The plan does not end by asking the user.
7. **Demo body limit.** The backfill streams in chunks of about 1,000 spans that stay under 900 KiB, sends them one at a time with a gap, and exits non-zero on any non-2xx response.
8. **Phantom externals.** The plan adds host normalisation (port strip, then a full-host and first-DNS-label same-name drop), the per-source top-20 cap with `ext:<src>/other` (**PD-9**), realistic `server.address` on internal client spans in the demo, and peer-keys tests for `cart:8080` and `cart.ns.svc.cluster.local`.
9. **Hub connection.** Virtual seed edges count as connections, the same as in `computeFlow`. The hub is always a service. A pinned `chooseHub` test covers this.
10. **CI timing.** Property runs are bounded to `numRuns: 60` over 0–150 nodes, plus one fixed 600-node case. The timing check is its own median-of-7 test, scaled by `KOPAI_PERF_SCALE` (×25 on CI). The long-run test is cut to 200k tuples with an explicit timeout, and the 30-minute live run has an explicit timeout.
11. **jsdom.** Every DOM test has the docblock, including `session-manager.test.ts`. One shared helper, `test-utils/react-flow-jsdom.ts`, is used by `ServiceMap.test.tsx` and `observability.test.tsx`. The Unit 6 test unmounts and calls `__resetSessionsForTests()` so no timers leak.
12. **Cap accounting.** `JOIN_CAP` counts `seen` entries plus every pending child. The PD-3 boundary set is capped at `PAGE_LIMIT` (1000).
13. **Session keying.** In-process sessions use a `WeakMap` keyed by client instance. Worker sessions use the absolute `baseUrl` plus stable JSON of the auth.
14. **Benchmark DB.** The benchmark uses a temporary file DB opened with `initializeDatabase(filePath)`, the same way the app opens it, under `TMPDIR`, which points at the scratchpad in this session.
15. **Plugin gate.** Unit 4 adds `tsconfig.build.json`, and the `type-check` and `lint` scripts now cover `build/` and `tsdown.config.ts`.

The reviewer's probe (rolldown 1.2.15 resolves `./x.js` to `.ts` with no extra config) is recorded in §3. No extension alias is planned.
