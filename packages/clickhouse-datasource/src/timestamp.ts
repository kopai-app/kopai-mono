/**
 * Convert a nanosecond string (e.g. "1704067200123456789") to ClickHouse DateTime64(9) format
 * (e.g. "2024-01-01 00:00:00.123456789").
 *
 * Uses BigInt to preserve nanosecond precision that JavaScript Date cannot represent.
 */
export function nanosToDateTime64(nanos: string): string {
  const totalNanos = BigInt(nanos);
  const NANOS_PER_SECOND = 1_000_000_000n;
  const seconds = totalNanos / NANOS_PER_SECOND;
  const fracNanos = totalNanos % NANOS_PER_SECOND;

  // Handle negative fractional part (for timestamps before epoch, though unlikely)
  const adjustedSeconds = fracNanos < 0n ? seconds - 1n : seconds;
  const adjustedFrac =
    fracNanos < 0n ? fracNanos + NANOS_PER_SECOND : fracNanos;

  const date = new Date(Number(adjustedSeconds) * 1000);
  const yyyy = date.getUTCFullYear().toString().padStart(4, "0");
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = date.getUTCDate().toString().padStart(2, "0");
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const min = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  const frac = adjustedFrac.toString().padStart(9, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}.${frac}`;
}

/**
 * Convert a ClickHouse DateTime64(9) string (e.g. "2024-01-01 00:00:00.123456789")
 * to a nanosecond string (e.g. "1704067200123456789").
 *
 * Preserves full nanosecond precision from the string rather than relying on Date.getTime().
 */
export function dateTime64ToNanos(dt64: string): string {
  // Parse "YYYY-MM-DD HH:MM:SS.nnnnnnnnn"
  const dotIdx = dt64.indexOf(".");
  const dateTimePart = dotIdx === -1 ? dt64 : dt64.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? "0" : dt64.slice(dotIdx + 1);

  // Parse date/time to get seconds since epoch
  const isoString = dateTimePart.replace(" ", "T") + "Z";
  const date = new Date(isoString);
  const epochSeconds = BigInt(Math.floor(date.getTime() / 1000));

  // Parse fractional nanoseconds, pad to 9 digits
  const nanosFrac = BigInt(fracPart.padEnd(9, "0").slice(0, 9));

  const NANOS_PER_SECOND = 1_000_000_000n;
  const totalNanos = epochSeconds * NANOS_PER_SECOND + nanosFrac;

  return totalNanos.toString();
}
