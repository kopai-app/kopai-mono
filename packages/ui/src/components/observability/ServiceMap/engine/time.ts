const NS_PER_MS = 1_000_000n;
const DIGITS = /^\d+$/;

/**
 * Nanosecond string → epoch milliseconds (sub-millisecond part dropped).
 * Returns NaN for anything that is not an integer.
 */
export function nsToMs(ns: string): number {
  if (DIGITS.test(ns)) {
    // Fast path: drop the last 6 digits instead of going through BigInt.
    return ns.length <= 6 ? 0 : Number(ns.slice(0, -6));
  }
  try {
    return Number(BigInt(ns) / NS_PER_MS);
  } catch {
    return NaN;
  }
}

/** Epoch milliseconds → nanosecond string (milliseconds are floored). */
export function msToNs(ms: number): string {
  return (BigInt(Math.floor(ms)) * NS_PER_MS).toString();
}

/** `ns − 1` as a string, for an exclusive upper bound (`timestampMax = T0 − 1`). */
export function nsMinusOne(ns: string): string {
  return (BigInt(ns) - 1n).toString();
}

/** Index of the wall-clock minute that contains `ms`. */
export function minuteOf(ms: number): number {
  return Math.floor(ms / 60_000);
}

/** ISO datetime for a KopaiQuery absolute `timeDimension`. */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}
