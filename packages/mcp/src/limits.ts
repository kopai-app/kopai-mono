import { kopaiQuery } from "@kopai/core";

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
 * How many time buckets the window will be cut into, or 1 for a summary.
 *
 * WHY this is worth computing: an aggregate's row count is groups times
 * buckets, and the two need opposite advice. Buckets are exactly derivable
 * from the window and the granularity, which is enough to tell the two causes
 * apart — if the buckets alone exceed the cap then no amount of regrouping
 * will help, and if they do not then the group cardinality is what overran.
 */
function bucketCount(query: kopaiQuery.KopaiQuery): number {
  if (query.mode !== "aggregate" || query.output.type !== "timeSeries")
    return 1;

  const granularityNs = kopaiQuery.durationStringToNanos(
    query.output.granularity
  );
  if (typeof granularityNs !== "number" || granularityNs <= 0) return 1;

  const window = query.timeDimension;
  let windowNs: number;
  if (window.type === "relative") {
    const lookbackNs = kopaiQuery.durationStringToNanos(window.lookback);
    if (typeof lookbackNs !== "number") return 1;
    windowNs = lookbackNs;
  } else {
    const span = Date.parse(window.endTime) - Date.parse(window.startTime);
    if (!Number.isFinite(span) || span <= 0) return 1;
    windowNs = span * 1e6;
  }

  return Math.max(1, Math.ceil(windowNs / granularityNs));
}

/**
 * Remedies for an aggregate query that overran its cap, ordered by whichever
 * factor actually caused it.
 *
 * WHY ordered rather than a fixed list: an aggregate returns groups times
 * buckets rows, and advice for one is useless for the other. Telling someone
 * grouping by a high-cardinality column in a `summary` query to use a coarser
 * granularity names a field their query does not have; telling someone whose
 * window is cut into more buckets than the cap allows to group by less will
 * not help them either.
 *
 * WHY there is no "add an `orderBy`" line: an ordering does not change the
 * outcome. An overflow is refused whether or not the query is ordered, because
 * a live page cannot act on a remedy — its query was fixed at authoring time
 * and its viewer did not write it — so a truncated result would be drawn as
 * though it were the whole set.
 */
export function overflowRemedies(
  query: kopaiQuery.KopaiQuery,
  limit: number,
  max: number
): string[] {
  const buckets = bucketCount(query);
  const isTimeSeries = buckets > 1;
  const grouped =
    query.mode === "aggregate" && (query.dimensions?.length ?? 0) > 0;

  const raiseLimit = limit < max ? [`Raise \`limit\`, up to ${max}.`] : [];
  // States what the declared window spans, not how many rows came back: a
  // bucket only materialises where there is data, so this is an upper bound.
  // It is still the useful number, because it is the one the caller chose.
  const coarser = `Use a coarser \`granularity\`: at this granularity the window spans up to ${buckets.toLocaleString("en-US")} buckets, and every group is counted once per bucket.`;
  const fewerGroups =
    "Group by fewer dimensions, or filter to the groups you care about — a high-cardinality column such as a span name or a route produces a row per distinct value.";
  const narrower = "Narrow the time window.";
  const summarise_ =
    'Use `output: { type: "summary" }` if the trend over time is not what you need.';

  // The buckets alone exceed the cap, so this cannot be regrouped out of.
  if (isTimeSeries && buckets > limit) {
    return [...raiseLimit, coarser, narrower, summarise_];
  }

  if (isTimeSeries) {
    // Rows are groups times buckets and the buckets fit, so the groups are
    // what overran — but a coarser granularity still divides the total, so it
    // stays on the list, second.
    return grouped
      ? [...raiseLimit, fewerGroups, coarser, narrower, summarise_]
      : [...raiseLimit, coarser, narrower];
  }

  // A summary query has no granularity at all; naming one would be noise.
  return [...raiseLimit, fewerGroups, narrower];
}
