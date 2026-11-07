/**
 * Test helpers for the engine (Unit 2): a fake clock that drives virtual time,
 * a scripted `ServiceMapClient` that records every call, and synthetic span
 * rows. Used only by tests; nothing here touches the network or real timers
 * (except `setImmediate`, to let pending promise chains settle).
 */
import type { kopaiQuery } from "@kopai/core";
import type {
  OtelTracesRow,
  RequestOptions,
  SearchResult,
  TracesDataFilter,
} from "@kopai/sdk";
import { PEER_SERVICE_KEY } from "./aggregate-seed.js";
import { msToNs } from "./time.js";
import type { Clock, ServiceMapClient } from "./types.js";

// ------------------------------------------------------------------ clock

interface Timer {
  at: number;
  id: number;
  resolve: () => void;
}

export interface FakeClock extends Clock {
  /** Timers not yet fired (aborted sleeps are removed). */
  pending(): number;
  /** Lets every settled promise chain run (no virtual time passes). */
  flush(): Promise<void>;
  /** Fires timers in order until `ms` of virtual time has passed. */
  advance(ms: number): Promise<void>;
  /**
   * Fires timers in order until `pred()` holds. Returns false if it does not
   * hold within `limitMs` of virtual time or when no timer is left.
   */
  runUntil(pred: () => boolean, limitMs?: number): Promise<boolean>;
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

export function createFakeClock(startMs: number): FakeClock {
  let now = startMs;
  let nextId = 0;
  const timers: Timer[] = [];

  const settle = () => new Promise<void>((r) => setImmediate(r));
  async function flush(): Promise<void> {
    await settle();
    await settle();
  }

  function earliest(): Timer | undefined {
    let best: Timer | undefined;
    for (const t of timers) {
      if (!best || t.at < best.at || (t.at === best.at && t.id < best.id))
        best = t;
    }
    return best;
  }

  function fire(t: Timer): void {
    timers.splice(timers.indexOf(t), 1);
    if (t.at > now) now = t.at;
    t.resolve();
  }

  return {
    now: () => now,
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const t: Timer = {
          at: now + Math.max(0, ms),
          id: nextId++,
          resolve: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        const onAbort = () => {
          const i = timers.indexOf(t);
          if (i >= 0) timers.splice(i, 1);
          reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        timers.push(t);
      });
    },
    pending: () => timers.length,
    flush,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        await flush();
        const t = earliest();
        if (!t || t.at > target) break;
        fire(t);
      }
      now = target;
      await flush();
    },
    async runUntil(pred, limitMs = Number.POSITIVE_INFINITY) {
      const limit = now + limitMs;
      for (;;) {
        await flush();
        if (pred()) return true;
        const t = earliest();
        if (!t || t.at > limit) return false;
        fire(t);
      }
    },
  };
}

// ------------------------------------------------------------------ rows

export interface RowSpec {
  traceId?: string;
  spanId: string;
  parentId?: string;
  svc: string;
  tsMs: number;
  /** Extra nanoseconds on top of `tsMs` (for same-millisecond ordering). */
  nsOffset?: number;
  kind?: string;
  err?: boolean;
  durMs?: number;
}

export function row(s: RowSpec): OtelTracesRow {
  const ts = BigInt(msToNs(s.tsMs)) + BigInt(s.nsOffset ?? 0);
  return {
    TraceId: s.traceId ?? `t-${s.spanId}`,
    SpanId: s.spanId,
    ParentSpanId: s.parentId ?? "",
    ServiceName: s.svc,
    SpanKind: s.kind ?? (s.parentId ? "Server" : "Client"),
    SpanName: "op",
    Timestamp: ts.toString(),
    Duration: msToNs(s.durMs ?? 5),
    StatusCode: s.err ? "Error" : "Unset",
  } as OtelTracesRow;
}

/** A parent in `from` and a child in `to`, the child 1 ms later (DESC order: child first). */
export function pairRows(
  id: string,
  from: string,
  to: string,
  tsMs: number,
  err = false
): OtelTracesRow[] {
  return [
    row({
      traceId: `t-${id}`,
      spanId: `${id}-c`,
      parentId: `${id}-p`,
      svc: to,
      tsMs: tsMs + 1,
      err,
    }),
    row({
      traceId: `t-${id}`,
      spanId: `${id}-p`,
      svc: from,
      tsMs,
      kind: "Client",
    }),
  ];
}

// ------------------------------------------------------------------ seed

type AggRow = kopaiQuery.KopaiAggregateRow;

export function seedNodeRows(spans: Record<string, number>): AggRow[] {
  return Object.entries(spans).map(([svc, n]) => ({
    "service.name": svc,
    SpanKind: "Server",
    spans: n,
    errRate: 0,
  }));
}

export function seedPeerRow(
  svc: string,
  calls: number,
  attrs: Partial<Record<string, string>>
): AggRow {
  return {
    "service.name": svc,
    [PEER_SERVICE_KEY]: null,
    "db.system.name": null,
    "db.namespace": null,
    "messaging.system": null,
    "messaging.destination.name": null,
    "messaging.operation.type": null,
    "server.address": null,
    ...attrs,
    calls,
    errRate: 0,
  };
}

// ------------------------------------------------------------------ client

export type Method =
  "queryTracesAggregate" | "searchTracesPage" | "getTrace" | "getServices";

export interface RecordedCall {
  method: Method;
  /** The aggregate query, the search filter, or the trace id. */
  arg: unknown;
  startMs: number;
  endMs: number | null;
  signal: AbortSignal | undefined;
  failed: boolean;
}

export interface MockHandlers {
  /** Rows for the nodes query (no filters) and the virtual-edge query. */
  seed?: (
    which: "nodes" | "edges",
    q: kopaiQuery.TraceAggregateQuery
  ) => AggRow[];
  /** Backward DESC pages of the main scan (no serviceName). */
  backward?: (
    f: TracesDataFilter,
    call: RecordedCall
  ) => SearchResult<OtelTracesRow>;
  /** Forward ASC pages. */
  forward?: (
    f: TracesDataFilter,
    call: RecordedCall
  ) => SearchResult<OtelTracesRow>;
  /** serviceName-filtered probe pages. */
  probe?: (f: TracesDataFilter) => SearchResult<OtelTracesRow>;
  trace?: (traceId: string) => OtelTracesRow[];
  /** Every known service (getServices). */
  services?: () => string[];
  /** Virtual time each call takes (default 10 ms). */
  latencyMs?: number;
  /** Throws to fail the call. */
  fail?: (call: RecordedCall, index: number) => void;
}

export interface MockClient {
  client: ServiceMapClient;
  calls: RecordedCall[];
  /** Highest number of calls in flight at once (must stay 1). */
  maxInFlight(): number;
}

const EMPTY: SearchResult<OtelTracesRow> = { data: [], nextCursor: null };

export function createMockClient(
  clock: Clock,
  h: MockHandlers = {}
): MockClient {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const latency = h.latencyMs ?? 10;

  async function track<T>(
    method: Method,
    arg: unknown,
    opts: RequestOptions | undefined,
    body: (call: RecordedCall) => T
  ): Promise<T> {
    const call: RecordedCall = {
      method,
      arg,
      startMs: clock.now(),
      endMs: null,
      signal: opts?.signal,
      failed: false,
    };
    const index = calls.length;
    calls.push(call);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await clock.sleep(latency, opts?.signal);
      h.fail?.(call, index);
      return body(call);
    } catch (e) {
      call.failed = true;
      throw e;
    } finally {
      inFlight--;
      call.endMs = clock.now();
    }
  }

  const client = {
    queryTracesAggregate(
      q: kopaiQuery.TraceAggregateQuery,
      opts?: RequestOptions
    ) {
      return track("queryTracesAggregate", q, opts, () => {
        const which = q.filters?.length ? "edges" : "nodes";
        return { data: h.seed?.(which, q) ?? [] };
      });
    },
    searchTracesPage(f: TracesDataFilter, opts?: RequestOptions) {
      return track("searchTracesPage", f, opts, (call) => {
        if (f.serviceName) return h.probe?.(f) ?? EMPTY;
        if (f.sortOrder === "ASC") return h.forward?.(f, call) ?? EMPTY;
        return h.backward?.(f, call) ?? EMPTY;
      });
    },
    getTrace(traceId: string, opts?: RequestOptions) {
      return track("getTrace", traceId, opts, () => h.trace?.(traceId) ?? []);
    },
    getServices(opts?: RequestOptions) {
      return track("getServices", undefined, opts, () => ({
        services: h.services?.() ?? [],
      }));
    },
  };
  return {
    client: client as unknown as ServiceMapClient,
    calls,
    maxInFlight: () => maxInFlight,
  };
}

export function filterOf(call: RecordedCall): TracesDataFilter {
  return call.arg as TracesDataFilter;
}

export const isBackward = (c: RecordedCall) =>
  c.method === "searchTracesPage" &&
  !filterOf(c).serviceName &&
  filterOf(c).sortOrder === "DESC";

export const isForward = (c: RecordedCall) =>
  c.method === "searchTracesPage" && filterOf(c).sortOrder === "ASC";

export const isProbePage = (c: RecordedCall) =>
  c.method === "searchTracesPage" && !!filterOf(c).serviceName;

/**
 * A backward source of `pages` DESC pages evenly covering `[loMs, hiMs)`;
 * the cursor is the next page index. `rowsFor(i, sliceHiMs, sliceLoMs)`
 * returns the rows of page i (newest first).
 */
export function backwardSource(opts: {
  pages: number;
  loMs: number;
  hiMs: number;
  rowsFor?: (i: number, hiMs: number, loMs: number) => OtelTracesRow[];
}): (f: TracesDataFilter) => SearchResult<OtelTracesRow> {
  const width = (opts.hiMs - opts.loMs) / opts.pages;
  return (f) => {
    const i = f.cursor ? Number(f.cursor) : 0;
    if (i >= opts.pages) return EMPTY;
    const hi = opts.hiMs - i * width;
    const lo = hi - width;
    const data = opts.rowsFor
      ? opts.rowsFor(i, hi, lo)
      : [row({ spanId: `b${i}`, svc: "filler", tsMs: Math.floor(lo) + 1 })];
    return {
      data,
      nextCursor: i + 1 < opts.pages ? String(i + 1) : null,
    };
  };
}

/** Asserts on recorded calls: never overlapping and ≥ `gapMs` apart. */
export function serialGaps(calls: readonly RecordedCall[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < calls.length; i++) {
    const prev = calls[i - 1];
    const cur = calls[i];
    if (!prev || !cur) continue;
    gaps.push(cur.startMs - (prev.endMs ?? Number.POSITIVE_INFINITY));
  }
  return gaps;
}
