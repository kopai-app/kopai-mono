/**
 * Row caps, per mode.
 *
 * WHY per mode rather than one number: measured serialized row sizes differ by
 * an order of magnitude. A raw trace row is ~703 characters, a raw log row
 * ~418, a raw metric row 408-653 (OTel repeats the metric name, description
 * and unit on every data point), against ~96 for an aggregate summary row and
 * ~134 for a `timeSeries` row. Against the character ceiling below, a uniform
 * cap of 500 would let every raw shape overrun — traces by 134%, logs by 39%,
 * metrics by 36-118% — so a raw query that used its own cap would pay for a
 * full round trip and then have the result refused.
 *
 * At 200 they all fit, though traces land at ~94% of budget, which is why the
 * post-serialization check stays load-bearing rather than being a formality.
 * Treat these figures as optimistic: they come from fixtures, and production
 * attribute maps are heavier.
 *
 * The consequence for callers, worth stating in the tool description: the
 * aggregate shape is the efficient one and raw is for inspecting individual
 * records. One hour of one gauge costs roughly 116,400 characters as raw rows
 * against 8,040 as a `timeSeries` aggregate at `1m` — fourteen times less, for
 * the same chart, with the bucketing done in the database.
 */
export const LIMITS = {
  raw: {
    /** Applied when the caller sends no `limit`; matches the backend default. */
    fallback: 100,
    max: 200,
  },
  aggregate: {
    /**
     * Applied when the caller sends no `limit`. Unlike raw, this is not a
     * backend default being restated: both backends emit `LIMIT` for an
     * aggregate query only when one is explicitly set, so an aggregate query
     * with no limit runs unbounded.
     */
    fallback: 500,
    max: 500,
  },
} as const;

/**
 * The serialized size past which a result is refused rather than returned.
 *
 * Measured after serialization, on one copy of the payload — the result
 * carries the same JSON in two channels, but a client forwards one or the
 * other, so the model only ever ingests it once.
 */
export const MAX_RESULT_CHARACTERS = 150_000;

/** Remedies offered when a result is too large once serialized. */
export const SIZE_REMEDIES = [
  "Lower `limit`.",
  "Narrow the time window.",
  "Use a coarser `granularity`, or `output: {type: 'summary'}` instead of a time series.",
] as const;

/**
 * Remedies for an aggregate query that overran its cap.
 *
 * WHY there is no "add an `orderBy`" line: an ordering does not change the
 * outcome. An overflow is refused whether or not the query is ordered, because
 * a live page cannot act on a remedy — its query was fixed at authoring time
 * and its viewer did not write it — so a truncated result would be drawn as
 * though it were the whole set. Suggesting an ordering would be suggesting
 * something that still fails.
 *
 * Raising `limit` is offered only when there is headroom below the cap; at the
 * cap the only way out is a smaller result.
 */
export function overflowRemedies(limit: number, max: number): string[] {
  return [
    ...(limit < max ? [`Raise \`limit\`, up to ${max}.`] : []),
    'Use a coarser `granularity` — "30m" yields six buckets over an hour where "5m" yields thirty-six.',
    "Narrow the time window.",
    "Group by fewer dimensions, or filter to the groups you care about.",
  ];
}
