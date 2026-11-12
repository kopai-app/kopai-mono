/**
 * Lookback the Traces and Logs pages search when the URL gives no time range.
 *
 * There is deliberately no "All time" choice: an unbounded search scans the
 * workspace's whole history and times out on a large one (KOP-216).
 */
export const DEFAULT_LOOKBACK = "1h";
export const DEFAULT_LOOKBACK_MS = 60 * 60_000;
