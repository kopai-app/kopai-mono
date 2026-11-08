import type { OtelTracesRow, SearchResult, TracesDataFilter } from "@kopai/sdk";
import { buildSeedQueries, parseSeed } from "./aggregate-seed.js";
import type { EngineConfig } from "./config.js";
import { createGraphState, type GraphState } from "./graph-state.js";
import { createJoinBuffer, type JoinBuffer } from "./join-buffer.js";
import { msToNs, nsMinusOne, nsToMs } from "./time.js";
import { createTupleReader, toTuple, type TupleReader } from "./tuples.js";
import type {
  Clock,
  ScanPhase,
  ServiceMapClient,
  Region,
  ServiceMapSnapshot,
  SpanTuple,
  StopReason,
} from "./types.js";

const MINUTE_MS = 60_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** Probe requests per service: one page + at most 2 traces (PD-1). */
const PROBE_COST = 3;
const PROBE_TRACES = 2;
/**
 * Tries per seed (getServices or one aggregate) before giving up on it. A
 * failing seed must not hold the scan: the seed phase falls through to the
 * backward scan, and in live the forward poll keeps running.
 */
const SEED_MAX_FAILURES = 3;

export type Phase = Exclude<ScanPhase, "paused" | "error">;

/** Thrown inside a run to unwind it after `abort()`. Never escapes the run. */
class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

/** Exponential backoff after the n-th consecutive failure: 1 s, 2 s, 4 s … 30 s. */
export function backoffMs(failures: number): number {
  const n = Math.max(1, failures);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (n - 1));
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

/** Internal sizes, for tests and diagnostics. */
export interface ScanStats {
  /** Current phase, unthrottled (snapshots may lag by up to 750 ms). */
  phase: Phase;
  joinSize: number;
  nodes: number;
  edges: number;
  /** PD-3 boundary spanIds kept for the next forward tick. */
  boundary: number;
  probedTraces: number;
  scanRequests: number;
  inFlight: boolean;
}

export interface ScanRunOptions {
  client: ServiceMapClient;
  clock: Clock;
  config: EngineConfig;
  /** Called after every state change; the engine throttles snapshots. */
  onChange: () => void;
}

/**
 * One scan session (plan §2.1, Unit 2): seed → backward → probes → live, over
 * a single serial request queue. A restart is a new `ScanRun`.
 *
 * Every request goes through `request()`: one in flight at a time, at least
 * `gapMs` between the end of one and the start of the next, a single
 * `AbortSignal`, and a gate that holds while paused. Every request issued
 * before the run goes live counts against one shared budget (Q11).
 */
export class ScanRun {
  private readonly client: ServiceMapClient;
  private readonly clock: Clock;
  private readonly cfg: EngineConfig;
  private readonly onChange: () => void;
  private readonly ctl = new AbortController();

  private phase: Phase = "idle";
  private paused = false;
  private error: string | null = null;
  private stopReason: StopReason | null = null;
  private started = false;

  // request queue
  private scanRequests = 0;
  private lastEndMs = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private failures = 0;
  private lastRequestFailed = false;
  private wakeUp: (() => void) | null = null;

  // window
  private readonly startMs: number;
  /** T0 = start − delay: the boundary between the backward and forward regions. */
  private readonly t0Ms: number;
  /** Lower bound of the backward scan: start − M. */
  private readonly scanLoMs: number;

  // engine state
  private readonly graph: GraphState;
  private readonly join: JoinBuffer;
  private readonly backReader: TupleReader;
  private readonly fwdReader: TupleReader;
  private readonly probeReader: TupleReader;
  private seedTruncated = false;
  private clientNoPeer = 0;
  private probeSelfCalls = 0;
  private lastSeedMs = 0;
  private seeded = false;
  /**
   * The clock time of the last snapshot built while running. A paused run
   * keeps building its snapshots at that time, so the sliding window does
   * not shrink the counts while no data can arrive.
   */
  private snapshotNowMs: number | null = null;

  // backward scan
  private backCursor: string | undefined;
  private backPages = 0;
  private backOldestMs: number | null = null;
  private backDone = false;
  /** PD-4: `fromMs`; set to the window bottom when the window has no older data. */
  private coverageFromMs: number | null = null;

  // forward poll (PD-3)
  private wfNs: bigint;
  private boundaryTs: string | null = null;
  private boundary = new Set<string>();
  private behindMs = 0;
  private nextFwdMs: number;
  private nextSeedMs = Number.POSITIVE_INFINITY;

  // probes (PD-1)
  private readonly probedTraces = new Set<string>();

  constructor(opts: ScanRunOptions) {
    this.client = opts.client;
    this.clock = opts.clock;
    this.cfg = opts.config;
    this.onChange = opts.onChange;
    const now = this.clock.now();
    this.startMs = now;
    this.t0Ms = now - this.cfg.delayMs;
    this.scanLoMs = now - this.cfg.windowMs;
    this.wfNs = BigInt(msToNs(this.t0Ms));
    this.nextFwdMs = now + this.cfg.pollMs;
    this.graph = createGraphState({
      nodeCap: this.cfg.nodeCap,
      edgeCap: this.cfg.edgeCap,
      windowMs: this.cfg.windowMs,
    });
    this.join = createJoinBuffer({
      cap: this.cfg.joinCap,
      horizonMs: this.cfg.horizonMs,
      skewMs: this.cfg.skewMs,
      t0Ms: this.t0Ms,
    });
    const readerOpts = { skewMs: this.cfg.skewMs };
    this.backReader = createTupleReader(readerOpts);
    this.fwdReader = createTupleReader(readerOpts);
    this.probeReader = createTupleReader(readerOpts);
  }

  // ---------------------------------------------------------------- control

  /** Starts the run loop once. The returned promise settles when the run ends or is aborted. */
  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    return this.run();
  }

  /** Stops new requests; an in-flight request finishes. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.onChange();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.wake();
    this.onChange();
  }

  /** Skips the current backoff wait and retries the failed step now. */
  retry(): void {
    if (this.error === null) return;
    this.failures = 0;
    this.wake();
  }

  /** Aborts the in-flight request and every timer; no further client calls. */
  abort(): void {
    if (!this.ctl.signal.aborted) this.ctl.abort();
  }

  isPaused(): boolean {
    return this.paused;
  }

  stats(): ScanStats {
    return {
      phase: this.phase,
      joinSize: this.join.size(),
      nodes: this.graph.nodeCount(),
      edges: this.graph.edgeCount(),
      boundary: this.boundary.size,
      probedTraces: this.probedTraces.size,
      scanRequests: this.scanRequests,
      inFlight: this.inFlight,
    };
  }

  snapshot(seq: number): ServiceMapSnapshot {
    const now =
      this.paused && this.snapshotNowMs !== null
        ? this.snapshotNowMs
        : this.clock.now();
    if (!this.paused) this.snapshotNowMs = now;
    const g = this.graph.buildSnapshot(now);
    const jc = this.join.counters();
    const readers = [this.backReader, this.fwdReader, this.probeReader].map(
      (r) => r.stats()
    );
    const lo = now - this.cfg.windowMs;
    const from = this.coverageFromMs;
    const state: ScanPhase = this.paused
      ? "paused"
      : this.error !== null
        ? "error"
        : this.phase;
    return {
      seq,
      hub: g.hub,
      nodes: g.nodes,
      edges: g.edges,
      coverage: {
        fromMs: from === null ? null : Math.max(from, lo),
        toMs: from === null ? null : this.wfMs(),
        windowMs: this.cfg.windowMs,
      },
      spansInWindow: g.spansInWindow,
      scan: {
        state,
        stopReason: this.stopReason,
        requests: this.scanRequests,
        maxRequests: this.cfg.scanMaxRequests,
        behindMs: this.behindMs,
      },
      diagnostics: {
        dropped: jc.dropped,
        lateUnpaired: jc.lateUnpaired,
        dupes: jc.dupes + readers.reduce((n, r) => n + r.dupes, 0),
        badTimestamp: readers.reduce((n, r) => n + r.badTimestamp, 0),
        selfCalls: jc.selfCalls + this.probeSelfCalls,
        clientNoPeer: this.clientNoPeer,
        nodeCapHit: g.nodeCapHit,
        edgesDropped: g.edgesDropped,
        seedTruncated: this.seedTruncated,
      },
      error: this.error,
    };
  }

  // --------------------------------------------------------------- run loop

  private async run(): Promise<void> {
    try {
      await this.seedPhase();
      await this.backwardPhase();
      await this.probePhase();
      await this.livePhase();
    } catch (e) {
      if (e instanceof Aborted || this.ctl.signal.aborted) return;
      // A bug, not a request failure: keep the last good graph and say so.
      this.error = messageOf(e);
      this.onChange();
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.onChange();
  }

  private remaining(): number {
    return this.cfg.scanMaxRequests - this.scanRequests;
  }

  private counted(): boolean {
    return this.phase !== "live";
  }

  // ----------------------------------------------------------------- seed

  /**
   * A1 seed: getServices (every known service becomes a node up front), then
   * 2 aggregates. False when the budget left above the probe reserve ran out
   * or a call failed `SEED_MAX_FAILURES` times in a row; the last good seed
   * is kept either way.
   */
  private async seed(): Promise<boolean> {
    const builtAt = this.clock.now();
    const q = buildSeedQueries(builtAt, this.cfg.windowMs);
    // Before live the seed never eats into the probe reserve (PD-8).
    const canSpend = () => this.remaining() > this.cfg.probeReserve;
    const max = SEED_MAX_FAILURES;
    const known = await this.attempt(
      canSpend,
      (signal) => this.client.getServices({ signal }),
      max
    );
    if (!known) return false;
    this.graph.addServices(known.services);
    this.onChange();
    const nodes = await this.attempt(
      canSpend,
      (signal) => this.client.queryTracesAggregate(q.nodes, { signal }),
      max
    );
    if (!nodes) return false;
    const edges = await this.attempt(
      canSpend,
      (signal) => this.client.queryTracesAggregate(q.edges, { signal }),
      max
    );
    if (!edges) return false;
    const parsed = parseSeed(nodes.data, edges.data, {
      perSource: this.cfg.virtualPerSource,
    });
    this.graph.applySeed(parsed);
    this.seedTruncated = parsed.truncated;
    this.clientNoPeer = parsed.clientNoPeer;
    this.lastSeedMs = builtAt;
    this.seeded = true;
    if (this.backPages > 0) this.graph.selectHub();
    this.onChange();
    return true;
  }

  private async seedPhase(): Promise<void> {
    this.setPhase("seeding");
    await this.seed();
  }

  // ------------------------------------------------------------- backward

  /**
   * A5 backward DESC scan over `[start − M, T0 − 1]`, following the cursor.
   * Stop rule (A6 per §0): coverage, budget (remaining ≤ PROBE_RESERVE,
   * PD-8), no more data, or an error that used up the budget.
   */
  private async backwardPhase(): Promise<void> {
    this.setPhase("scanning");
    const reserve = this.cfg.probeReserve;
    const canSpend = () => this.remaining() > reserve;
    for (;;) {
      if (this.clock.now() >= this.nextFwdMs) await this.forwardTick(canSpend);
      if (!canSpend()) {
        this.stopBackward(this.lastRequestFailed ? "error" : "budget");
        break;
      }
      const filter: TracesDataFilter = {
        timestampMin: msToNs(this.scanLoMs),
        timestampMax: nsMinusOne(msToNs(this.t0Ms)),
        sortOrder: "DESC",
        limit: this.cfg.pageLimit,
        ...(this.backCursor ? { cursor: this.backCursor } : {}),
      };
      const page = await this.attempt(canSpend, (signal) =>
        this.client.searchTracesPage(filter, { signal })
      );
      if (!page) {
        this.stopBackward(this.lastRequestFailed ? "error" : "budget");
        break;
      }
      this.backPages++;
      const now = this.clock.now();
      for (const row of page.data) {
        const t = this.backReader.read(row, this.scanLoMs, now);
        if (!t) continue;
        this.ingest(t, "back");
        if (this.backOldestMs === null || t.tsMs < this.backOldestMs) {
          this.backOldestMs = t.tsMs;
        }
      }
      this.backCursor = page.nextCursor ?? undefined;
      if (this.backOldestMs !== null) this.coverageFromMs = this.backOldestMs;
      // R2-2: the hub is chosen after seed + page 1 (and retried while null).
      this.graph.selectHub();
      this.expire();

      // Coverage: the scan reached the oldest minute of the window (the
      // bucket resolution of the map).
      if (
        this.backOldestMs !== null &&
        this.backOldestMs < now - this.cfg.windowMs + MINUTE_MS
      ) {
        this.stopBackward("coverage");
        break;
      }
      if (!page.nextCursor) {
        // Everything in [start − M, T0) was read: the window is covered.
        this.coverageFromMs = this.scanLoMs;
        this.stopBackward("no-more-data");
        break;
      }
      this.onChange();
    }
  }

  private stopBackward(reason: StopReason): void {
    this.stopReason = reason;
    this.backDone = true;
    // Every back child still pending can no longer meet its parent.
    this.expire();
    this.onChange();
  }

  // ---------------------------------------------------------------- probes

  /**
   * R2-5 / PD-1: for each service still unconnected (busiest first, ≤ 50),
   * one serviceName page below the covered interval, then ≤ 2 traces from it.
   * Only children older than `coverageFrom` are counted. The probes draw from
   * the shared budget: `min(remaining, 50 × 3)` and never below 0.
   */
  private async probePhase(): Promise<void> {
    this.setPhase("probing");
    const allowance = Math.min(
      this.remaining(),
      this.cfg.probeMaxServices * PROBE_COST
    );
    const startedAt = this.scanRequests;
    const canSpend = () =>
      this.remaining() > 0 && this.scanRequests - startedAt < allowance;

    const fromMs = this.coverageFromMs;
    const candidates = this.graph
      .services()
      .filter((id) => !this.graph.isConnected(id))
      .sort(
        (a, b) =>
          this.graph.spansOf(b) - this.graph.spansOf(a) || (a < b ? -1 : 1)
      )
      .slice(0, this.cfg.probeMaxServices);

    for (const svc of candidates) {
      if (fromMs === null || !canSpend()) break;
      if (this.graph.isConnected(svc)) continue; // connected by an earlier probe
      if (this.clock.now() >= this.nextFwdMs) await this.forwardTick(canSpend);
      if (!canSpend()) break;
      const loMs = this.clock.now() - this.cfg.windowMs;
      if (fromMs <= loMs) break; // nothing below the covered interval
      const page = await this.attempt(canSpend, (signal) =>
        this.client.searchTracesPage(
          {
            serviceName: svc,
            timestampMin: msToNs(loMs),
            timestampMax: nsMinusOne(msToNs(fromMs)),
            sortOrder: "DESC",
            limit: this.cfg.pageLimit,
          },
          { signal }
        )
      );
      if (!page) break;
      const now = this.clock.now();
      this.probeReader.resetAdjacent();
      const traceIds: string[] = [];
      for (const row of page.data) {
        const t = this.probeReader.read(row, loMs, now);
        if (t) this.graph.observeSpan(t.svc, t.tsMs, t.err);
        const callsOut =
          row.SpanKind === "Client" ||
          row.SpanKind === "Producer" ||
          !!row.ParentSpanId;
        if (
          callsOut &&
          row.TraceId &&
          traceIds.length < PROBE_TRACES &&
          !traceIds.includes(row.TraceId) &&
          !this.probedTraces.has(row.TraceId)
        ) {
          traceIds.push(row.TraceId);
        }
      }
      this.onChange();
      for (const traceId of traceIds) {
        if (!canSpend()) return;
        const rows = await this.attempt(canSpend, (signal) =>
          this.client.getTrace(traceId, { signal })
        );
        if (!rows) return;
        this.probedTraces.add(traceId);
        this.pairTrace(rows, fromMs);
        this.onChange();
      }
    }
  }

  /** Pairs inside one probed trace; only children before `fromMs` count. */
  private pairTrace(rows: readonly OtelTracesRow[], fromMs: number): void {
    const now = this.clock.now();
    const loMs = now - this.cfg.windowMs;
    const svcOf = new Map<string, string>();
    const tuples: SpanTuple[] = [];
    for (const row of rows) {
      const r = toTuple(row, loMs, now, this.cfg.skewMs);
      if (!r.ok) continue;
      svcOf.set(r.tuple.spanId, r.tuple.svc);
      tuples.push(r.tuple);
    }
    for (const t of tuples) {
      if (!t.parentId || t.tsMs >= fromMs) continue;
      const parentSvc = svcOf.get(t.parentId);
      if (parentSvc === undefined) continue;
      if (parentSvc === t.svc) {
        this.probeSelfCalls++;
        continue;
      }
      this.graph.addPair({
        source: parentSvc,
        target: t.svc,
        tsMs: t.tsMs,
        err: t.err,
      });
    }
  }

  // ------------------------------------------------------------------ live

  /**
   * R2-4: forward poll every 10 s; PD-2: seed refresh every 5 min. Not counted.
   * The forward tick runs first, and a failing seed refresh gives up after a
   * few tries (keeping the last good seed) and is tried again 30 s later, so
   * an aggregate outage never stops the forward poll.
   */
  private async livePhase(): Promise<void> {
    this.setPhase("live");
    // A seed that never succeeded is retried right away (after the first
    // forward tick that is due), not 5 min after the epoch.
    this.nextSeedMs = this.seeded
      ? this.lastSeedMs + this.cfg.seedRefreshMs
      : this.clock.now();
    const always = () => true;
    for (;;) {
      const due = Math.min(this.nextFwdMs, this.nextSeedMs);
      const wait = due - this.clock.now();
      if (wait > 0) {
        await this.waitWake(wait);
        continue;
      }
      if (this.clock.now() >= this.nextFwdMs) await this.forwardTick(always);
      if (this.clock.now() >= this.nextSeedMs) {
        const ok = await this.seed();
        this.nextSeedMs =
          this.clock.now() + (ok ? this.cfg.seedRefreshMs : BACKOFF_MAX_MS);
      }
      // R2-2: if no backward page ever arrived (e.g. the scan failed until the
      // budget ran out), choose the hub from live data. A no-op once chosen.
      this.graph.selectHub();
      this.graph.trim(this.clock.now());
      this.onChange();
    }
  }

  // --------------------------------------------------------------- forward

  /**
   * One PD-3 forward tick: ASC pages over `[Wf, now − delay − 1]` until no
   * cursor, the page cap, or (before live) the budget. On a cap, Wf holds at
   * the last row's nanosecond and the spanIds read there are skipped next time.
   */
  private async forwardTick(canSpend: () => boolean): Promise<void> {
    const tickStart = this.clock.now();
    this.nextFwdMs = tickStart + this.cfg.pollMs;
    const hiMs = tickStart - this.cfg.delayMs;
    const loNs = BigInt(msToNs(tickStart - this.cfg.windowMs));
    if (this.wfNs < loNs) {
      // After a long pause the old watermark is outside the window.
      this.wfNs = loNs;
      this.clearBoundary();
    }
    const hiNs = BigInt(msToNs(hiMs)) - 1n;
    if (hiNs < this.wfNs) return;

    let cursor: string | undefined;
    let pages = 0;
    let runTs: string | null = null;
    let runIds = new Set<string>();
    for (;;) {
      if (!canSpend()) {
        this.holdAt(runTs, runIds, hiMs);
        break;
      }
      const filter: TracesDataFilter = {
        timestampMin: this.wfNs.toString(),
        timestampMax: hiNs.toString(),
        sortOrder: "ASC",
        limit: this.cfg.pageLimit,
        ...(cursor ? { cursor } : {}),
      };
      const page: SearchResult<OtelTracesRow> | null = await this.attempt(
        canSpend,
        (signal) => this.client.searchTracesPage(filter, { signal })
      );
      if (!page) {
        this.holdAt(runTs, runIds, hiMs);
        break;
      }
      pages++;
      const now = this.clock.now();
      const windowLo = now - this.cfg.windowMs;
      for (const row of page.data) {
        if (row.Timestamp === this.boundaryTs && this.boundary.has(row.SpanId))
          continue;
        if (row.Timestamp !== runTs) {
          runTs = row.Timestamp;
          runIds = new Set();
        }
        if (runIds.size < this.cfg.pageLimit) runIds.add(row.SpanId);
        const t = this.fwdReader.read(row, windowLo, now);
        if (t) this.ingest(t, "fwd");
      }
      if (!page.nextCursor) {
        this.wfNs = hiNs + 1n;
        this.clearBoundary();
        this.behindMs = 0;
        this.expire();
        break;
      }
      if (pages >= this.cfg.fwdMaxPages) {
        this.holdAt(runTs, runIds, hiMs);
        break;
      }
      this.expire();
      this.onChange();
      cursor = page.nextCursor;
    }
    this.onChange();
  }

  /** PD-3: Wf ← the last row's nanosecond; remember the spanIds read there. */
  private holdAt(runTs: string | null, runIds: Set<string>, hiMs: number) {
    if (runTs !== null) {
      const cap = this.cfg.pageLimit;
      if (runTs === this.boundaryTs) {
        // Rows at this nanosecond skipped this tick were read before: keep them.
        for (const id of this.boundary) {
          if (runIds.size >= cap) break;
          runIds.add(id);
        }
        if (runIds.size >= cap && this.boundary.size >= cap) {
          // More rows at one nanosecond than we track: step past it so the
          // poll cannot stall (the extras are not tracked, PD-3).
          this.wfNs = BigInt(runTs) + 1n;
          this.clearBoundary();
          this.behindMs = Math.max(0, hiMs - this.wfMs());
          this.expire();
          return;
        }
      }
      this.wfNs = BigInt(runTs);
      this.boundaryTs = runTs;
      this.boundary = runIds;
    }
    this.behindMs = Math.max(1, hiMs - this.wfMs());
    this.expire();
  }

  private clearBoundary(): void {
    this.boundaryTs = null;
    this.boundary = new Set();
  }

  private wfMs(): number {
    return nsToMs(this.wfNs.toString());
  }

  // ---------------------------------------------------------------- ingest

  private ingest(t: SpanTuple, region: Region): void {
    this.graph.observeSpan(t.svc, t.tsMs, t.err);
    for (const pair of this.join.ingest(t, region)) this.graph.addPair(pair);
  }

  private expire(): void {
    this.join.expire(
      this.backOldestMs ?? this.t0Ms,
      this.wfMs(),
      this.backDone
    );
  }

  // --------------------------------------------------------- request queue

  /**
   * Runs one request until it succeeds (backoff 1 s → 30 s between failures,
   * skipped by `retry()`). Returns null when `canSpend` says the budget is
   * used up, before or between attempts, or after `maxFailures` failures in
   * this call (if given). The last good graph is kept.
   */
  private async attempt<T>(
    canSpend: () => boolean,
    fn: (signal: AbortSignal) => Promise<T>,
    maxFailures = Number.POSITIVE_INFINITY
  ): Promise<T | null> {
    let localFailures = 0;
    for (;;) {
      if (this.counted() && !canSpend()) return null;
      try {
        const result = await this.request(fn);
        this.failures = 0;
        this.lastRequestFailed = false;
        if (this.error !== null) {
          this.error = null;
          this.onChange();
        }
        return result;
      } catch (e) {
        if (e instanceof Aborted) throw e;
        this.failures++;
        this.lastRequestFailed = true;
        this.error = messageOf(e);
        // R2-2 fallback: page 1 failed. Choose the hub from the seed when it
        // connects anything, so the map can show what the seed found instead
        // of waiting for a page that may keep failing until live.
        if (
          this.phase === "scanning" &&
          this.backPages === 0 &&
          this.seeded &&
          this.graph.edgeCount() > 0
        ) {
          this.graph.selectHub();
        }
        this.onChange();
        localFailures++;
        if (localFailures >= maxFailures) return null;
        // A capped call backs off on its own count, so earlier failures of
        // other steps cannot stretch its few tries to 30 s each.
        await this.waitWake(
          backoffMs(
            Number.isFinite(maxFailures) ? localFailures : this.failures
          )
        );
      }
    }
  }

  private async request<T>(
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    // A pause can arrive while `gate()`'s promise settles: check again, so
    // nothing is sent once paused.
    do {
      await this.gate();
      this.checkAbort();
    } while (this.paused);
    if (this.counted()) this.scanRequests++;
    this.inFlight = true;
    try {
      return await fn(this.ctl.signal);
    } catch (e) {
      if (this.ctl.signal.aborted) throw new Aborted();
      throw e;
    } finally {
      this.inFlight = false;
      this.lastEndMs = this.clock.now();
    }
  }

  /** Holds while paused and until `gapMs` has passed since the last request ended. */
  private async gate(): Promise<void> {
    for (;;) {
      this.checkAbort();
      if (this.paused) {
        await this.waitWake(Number.POSITIVE_INFINITY);
        continue;
      }
      const wait = this.lastEndMs + this.cfg.gapMs - this.clock.now();
      if (wait > 0) {
        await this.waitWake(wait);
        continue;
      }
      return;
    }
  }

  private checkAbort(): void {
    if (this.ctl.signal.aborted) throw new Aborted();
  }

  private wake(): void {
    const w = this.wakeUp;
    this.wakeUp = null;
    w?.();
  }

  /**
   * Sleeps `ms` on the injected clock, or until `wake()` (resume, retry) or
   * `abort()`. The timer is always cancelled on exit, so nothing is left pending.
   */
  private async waitWake(ms: number): Promise<void> {
    this.checkAbort();
    const local = new AbortController();
    const onAbort = () => local.abort();
    this.ctl.signal.addEventListener("abort", onAbort, { once: true });
    try {
      await new Promise<void>((resolve) => {
        this.wakeUp = resolve;
        local.signal.addEventListener("abort", () => resolve(), { once: true });
        if (Number.isFinite(ms)) {
          this.clock.sleep(ms, local.signal).then(resolve, resolve);
        }
      });
    } finally {
      this.wakeUp = null;
      this.ctl.signal.removeEventListener("abort", onAbort);
      local.abort();
    }
    this.checkAbort();
  }
}
