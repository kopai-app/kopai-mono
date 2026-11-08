import type { OtelTracesRow } from "@kopai/sdk";
import { NODE_CAP, SKEW_MS } from "./config.js";
import { nsToMs } from "./time.js";
import type { SpanTuple } from "./types.js";

export type BadTimestampReason = "zero" | "future" | "window";

export type TupleResult =
  { ok: true; tuple: SpanTuple } | { ok: false; reason: BadTimestampReason };

/** OTel's default when a resource has no `service.name`. */
export const UNKNOWN_SERVICE = "unknown_service";

/**
 * Converts one row into a tuple. Q18: a zero start, a start more than SKEW in
 * the future, or a start before the window is a bad timestamp. The caller's
 * window is never moved by the row.
 */
export function toTuple(
  row: OtelTracesRow,
  windowLoMs: number,
  nowMs: number,
  skewMs: number = SKEW_MS
): TupleResult {
  const tsMs = nsToMs(row.Timestamp);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return { ok: false, reason: "zero" };
  if (tsMs > nowMs + skewMs) return { ok: false, reason: "future" };
  if (tsMs < windowLoMs) return { ok: false, reason: "window" };

  const durMs = row.Duration ? nsToMs(row.Duration) : 0;
  const endMs = Number.isFinite(durMs) && durMs > 0 ? tsMs + durMs : tsMs;
  const status = row.StatusCode?.toLowerCase() ?? "";
  return {
    ok: true,
    tuple: {
      spanId: row.SpanId,
      parentId: row.ParentSpanId ?? "",
      svc: serviceOf(row),
      kind: row.SpanKind || "Unspecified",
      tsMs,
      endMs,
      err: status === "error" || status === "status_code_error",
    },
  };
}

function serviceOf(row: OtelTracesRow): string {
  if (row.ServiceName) return row.ServiceName;
  const fromResource = row.ResourceAttributes?.["service.name"];
  return typeof fromResource === "string" && fromResource
    ? fromResource
    : UNKNOWN_SERVICE;
}

export interface TupleReaderStats {
  /** Rows whose `(Timestamp, SpanId)` equals the previous row's (R1-D21). */
  dupes: number;
  badTimestamp: number;
  /** Oldest / newest accepted start; bad rows never move these (Q18). */
  oldestMs: number | null;
  newestMs: number | null;
}

export interface TupleReader {
  /** A tuple, or null for a duplicate or a bad timestamp (both counted). */
  read(row: OtelTracesRow, windowLoMs: number, nowMs: number): SpanTuple | null;
  /** Forget the previous row, e.g. at the start of a different page stream. */
  resetAdjacent(): void;
  stats(): TupleReaderStats;
}

/**
 * Stateful row reader: the R1-D21 adjacent-duplicate guard (O(1) state), the
 * Q18 bad-timestamp counter, and interning of service names so 50k buffered
 * tuples share one string per service (the intern table is capped).
 */
export function createTupleReader(
  opts: { skewMs?: number; internCap?: number } = {}
): TupleReader {
  const skewMs = opts.skewMs ?? SKEW_MS;
  const internCap = opts.internCap ?? NODE_CAP * 2;
  const intern = new Map<string, string>();
  let lastTs: string | null = null;
  let lastSpanId: string | null = null;
  const s: TupleReaderStats = {
    dupes: 0,
    badTimestamp: 0,
    oldestMs: null,
    newestMs: null,
  };

  return {
    read(row, windowLoMs, nowMs) {
      if (row.Timestamp === lastTs && row.SpanId === lastSpanId) {
        s.dupes++;
        return null;
      }
      lastTs = row.Timestamp;
      lastSpanId = row.SpanId;
      const r = toTuple(row, windowLoMs, nowMs, skewMs);
      if (!r.ok) {
        s.badTimestamp++;
        return null;
      }
      const t = r.tuple;
      const known = intern.get(t.svc);
      if (known !== undefined) t.svc = known;
      else if (intern.size < internCap) intern.set(t.svc, t.svc);
      if (s.oldestMs === null || t.tsMs < s.oldestMs) s.oldestMs = t.tsMs;
      if (s.newestMs === null || t.tsMs > s.newestMs) s.newestMs = t.tsMs;
      return t;
    },
    resetAdjacent() {
      lastTs = null;
      lastSpanId = null;
    },
    stats: () => ({ ...s }),
  };
}
