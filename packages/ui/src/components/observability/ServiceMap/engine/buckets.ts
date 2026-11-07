import { EDGE_CAP, M_MS, RING_MINUTES } from "./config.js";
import { minuteOf } from "./time.js";

/**
 * A ring of per-minute counters. Slot `m mod RING` holds minute `m` for every
 * `m` in `[last − RING + 1, last]`; older minutes are cleared lazily when the
 * ring moves forward. 61 × (Uint32 + Uint16) ≈ 366 B per edge (PD-5).
 */
class MinuteRing {
  readonly calls = new Uint32Array(RING_MINUTES);
  readonly errors = new Uint16Array(RING_MINUTES);
  last = Number.NEGATIVE_INFINITY;

  add(minute: number, calls: number, errors: number): boolean {
    if (minute > this.last) this.advance(minute);
    else if (minute <= this.last - RING_MINUTES) return false; // too old
    const i = mod(minute, RING_MINUTES);
    this.calls[i] = Math.min(0xffffffff, (this.calls[i] ?? 0) + calls);
    this.errors[i] = Math.min(0xffff, (this.errors[i] ?? 0) + errors);
    return true;
  }

  /** Moves `last` to `minute`, clearing the slots that now mean a new minute. */
  advance(minute: number): void {
    if (minute <= this.last) return;
    if (minute - this.last >= RING_MINUTES) {
      this.calls.fill(0);
      this.errors.fill(0);
    } else {
      for (let m = this.last + 1; m <= minute; m++) {
        const i = mod(m, RING_MINUTES);
        this.calls[i] = 0;
        this.errors[i] = 0;
      }
    }
    this.last = minute;
  }

  sum(loMinute: number, hiMinute: number): { calls: number; errors: number } {
    const lo = Math.max(loMinute, this.last - RING_MINUTES + 1);
    const hi = Math.min(hiMinute, this.last);
    let calls = 0;
    let errors = 0;
    for (let m = lo; m <= hi; m++) {
      const i = mod(m, RING_MINUTES);
      calls += this.calls[i] ?? 0;
      errors += this.errors[i] ?? 0;
    }
    return { calls, errors };
  }
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export interface Buckets {
  /** Counts one call on `key` in the minute of `tsMs`. False if the edge cap refused a new key. */
  add(key: string, tsMs: number, err: boolean): boolean;
  /** Counts one span in the global ring (spans in window). */
  addSpan(tsMs: number): void;
  has(key: string): boolean;
  /** Calls and errors of `key` in the minutes of `[now − M, now]`. */
  sumLastM(key: string, nowMs: number): { calls: number; errors: number };
  spansLastM(nowMs: number): number;
  /** Clears every minute older than the window (memory stays fixed). */
  trim(nowMs: number): void;
  size(): number;
  edgesDropped(): number;
}

/** A7 per-minute buckets, one fixed-size ring per edge, capped at `edgeCap` edges. */
export function createBuckets(
  opts: { edgeCap?: number; windowMs?: number } = {}
): Buckets {
  const edgeCap = opts.edgeCap ?? EDGE_CAP;
  const windowMs = opts.windowMs ?? M_MS;
  const rings = new Map<string, MinuteRing>();
  const spans = new MinuteRing();
  let dropped = 0;

  const range = (nowMs: number): [number, number] => [
    minuteOf(nowMs - windowMs),
    minuteOf(nowMs),
  ];

  return {
    add(key, tsMs, err) {
      let ring = rings.get(key);
      if (!ring) {
        if (rings.size >= edgeCap) {
          dropped++;
          return false;
        }
        rings.set(key, (ring = new MinuteRing()));
      }
      ring.add(minuteOf(tsMs), 1, err ? 1 : 0);
      return true;
    },
    addSpan(tsMs) {
      spans.add(minuteOf(tsMs), 1, 0);
    },
    has: (key) => rings.has(key),
    sumLastM(key, nowMs) {
      const ring = rings.get(key);
      if (!ring) return { calls: 0, errors: 0 };
      const [lo, hi] = range(nowMs);
      return ring.sum(lo, hi);
    },
    spansLastM(nowMs) {
      const [lo, hi] = range(nowMs);
      return spans.sum(lo, hi).calls;
    },
    trim(nowMs) {
      const [, hi] = range(nowMs);
      for (const ring of rings.values()) ring.advance(hi);
      spans.advance(hi);
    },
    size: () => rings.size,
    edgesDropped: () => dropped,
  };
}
