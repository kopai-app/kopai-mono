import { H_MS, JOIN_CAP, SKEW_MS } from "./config.js";
import type { Pair, Region, SpanTuple } from "./types.js";

/** A span that may still be the parent of a span not read yet. */
interface SeenEntry {
  type: "seen";
  seq: number;
  spanId: string;
  dead: boolean;
  svc: string;
  kind: string;
  tsMs: number;
  endMs: number;
  hadXChild: boolean;
  region: Region;
}

/** A child waiting for its parent. */
interface PendingChild {
  type: "pending";
  seq: number;
  dead: boolean;
  parentId: string;
  svc: string;
  kind: string;
  tsMs: number;
  err: boolean;
  region: Region;
}

export interface JoinCounters {
  /** Capacity evictions (never turned into virtual edges). */
  dropped: number;
  /** Children whose parent did not arrive within the horizon. */
  lateUnpaired: number;
  /** A span id already in the buffer arrived again (non-adjacent duplicate). */
  dupes: number;
  /** Same-service parent/child pairs (R1-D7): no edge. */
  selfCalls: number;
}

export interface JoinBuffer {
  /** Pairs completed by this tuple (each child counts once, R1-D1). */
  ingest(t: SpanTuple, region: Region): Pair[];
  /**
   * Scan-distance expiry, per region (plan §2.1 step 6). `backFrontierMs` is
   * the oldest start read by the backward scan, `fwdFrontierMs` the forward
   * watermark Wf.
   */
  expire(
    backFrontierMs: number,
    fwdFrontierMs: number,
    backDone: boolean
  ): void;
  /** seen entries + every pending child. Never exceeds the cap. */
  size(): number;
  seenCount(): number;
  pendingCount(): number;
  counters(): JoinCounters;
}

export interface JoinBufferOptions {
  cap?: number;
  horizonMs?: number;
  skewMs?: number;
  /** Boundary between the backward and the forward region. */
  t0Ms: number;
}

/**
 * A3 bounded join buffer, shared by the backward scan and the forward poll.
 * Eviction is by insertion order across both maps (oldest seen entry or
 * oldest single pending child first).
 */
export function createJoinBuffer(opts: JoinBufferOptions): JoinBuffer {
  const cap = opts.cap ?? JOIN_CAP;
  const H = opts.horizonMs ?? H_MS;
  const SKEW = opts.skewMs ?? SKEW_MS;
  const T0 = opts.t0Ms;

  const seen = new Map<string, SeenEntry>();
  /** parentId → (seq → child). */
  const pending = new Map<string, Map<number, PendingChild>>();
  let pendingSize = 0;
  /**
   * Insertion-order FIFO over every entry, for eviction. Removed entries are
   * marked dead and skipped lazily; the array is compacted so it never holds
   * more than about twice the live entries.
   */
  let queue: (SeenEntry | PendingChild)[] = [];
  let head = 0;
  let seq = 0;
  const c: JoinCounters = {
    dropped: 0,
    lateUnpaired: 0,
    dupes: 0,
    selfCalls: 0,
  };

  const size = () => seen.size + pendingSize;

  function enqueue(e: SeenEntry | PendingChild): void {
    queue.push(e);
    if (queue.length - head > 2 * size() + 1024) {
      queue = queue.slice(head).filter((x) => !x.dead);
      head = 0;
    }
  }

  function removeSeen(e: SeenEntry): void {
    e.dead = true;
    seen.delete(e.spanId);
  }

  function removeChild(child: PendingChild): void {
    child.dead = true;
    pendingSize--;
    const kids = pending.get(child.parentId);
    if (!kids) return;
    kids.delete(child.seq);
    if (kids.size === 0) pending.delete(child.parentId);
  }

  function evictOne(): void {
    while (head < queue.length) {
      const e = queue[head++];
      if (!e || e.dead) continue;
      if (e.type === "seen") removeSeen(e);
      else removeChild(e);
      c.dropped++;
      break;
    }
    if (head > 4096 && head * 2 > queue.length) {
      queue = queue.slice(head);
      head = 0;
    }
  }

  return {
    ingest(t, region) {
      if (seen.has(t.spanId)) {
        c.dupes++;
        return [];
      }
      const pairs: Pair[] = [];
      let hadXChild = false;

      const kids = pending.get(t.spanId);
      if (kids) {
        pending.delete(t.spanId);
        for (const kid of kids.values()) {
          kid.dead = true;
          pendingSize--;
          if (kid.svc === t.svc) c.selfCalls++;
          else {
            pairs.push({
              source: t.svc,
              target: kid.svc,
              tsMs: kid.tsMs,
              err: kid.err,
            });
            hadXChild = true;
          }
        }
      }

      if (t.parentId) {
        const parent = seen.get(t.parentId);
        if (parent) {
          if (parent.svc === t.svc) c.selfCalls++;
          else {
            pairs.push({
              source: parent.svc,
              target: t.svc,
              tsMs: t.tsMs,
              err: t.err,
            });
            parent.hadXChild = true;
          }
        } else {
          const child: PendingChild = {
            type: "pending",
            seq: seq++,
            dead: false,
            parentId: t.parentId,
            svc: t.svc,
            kind: t.kind,
            tsMs: t.tsMs,
            err: t.err,
            region,
          };
          let list = pending.get(t.parentId);
          if (!list) pending.set(t.parentId, (list = new Map()));
          list.set(child.seq, child);
          pendingSize++;
          enqueue(child);
        }
      }

      const entry: SeenEntry = {
        type: "seen",
        seq: seq++,
        spanId: t.spanId,
        dead: false,
        svc: t.svc,
        kind: t.kind,
        tsMs: t.tsMs,
        endMs: t.endMs,
        hadXChild,
        region,
      };
      seen.set(t.spanId, entry);
      enqueue(entry);
      while (size() > cap) evictOne();
      return pairs;
    },

    expire(backFrontierMs, fwdFrontierMs, backDone) {
      for (const e of seen.values()) {
        const expired =
          e.region === "back"
            ? // PR §4.3 conjunctive rule: the backward scan is past it AND the
              // forward scan is past the window where its children can start.
              (backDone || e.tsMs > backFrontierMs + SKEW) &&
              e.endMs + SKEW < fwdFrontierMs
            : e.tsMs < fwdFrontierMs - H;
        if (expired) removeSeen(e);
      }
      const children: PendingChild[] = [];
      for (const kids of pending.values()) {
        for (const kid of kids.values()) children.push(kid);
      }
      for (const child of children) {
        const backPassed = backDone || backFrontierMs < child.tsMs - H;
        const expired =
          child.region === "back"
            ? backPassed
            : // A forward child near T0 may have its parent just below T0:
              // it also waits for the backward frontier.
              fwdFrontierMs > child.tsMs + SKEW &&
              (child.tsMs - H >= T0 || backPassed);
        if (expired) {
          removeChild(child);
          c.lateUnpaired++;
        }
      }
    },

    size,
    seenCount: () => seen.size,
    pendingCount: () => pendingSize,
    counters: () => ({ ...c }),
  };
}
