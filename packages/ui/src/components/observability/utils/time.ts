/**
 * Time formatting utilities for trace visualization
 */

export function formatDuration(durationMs: number): string {
  if (durationMs < 1) {
    const microseconds = durationMs * 1000;
    return `${microseconds.toFixed(2)}μs`;
  } else if (durationMs < 1000) {
    return `${durationMs.toFixed(2)}ms`;
  } else {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(2)}s`;
  }
}

export function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

export function calculateRelativeTime(
  timeMs: number,
  minTimeMs: number,
  maxTimeMs: number
): number {
  const totalDuration = maxTimeMs - minTimeMs;
  if (totalDuration === 0) return 0;
  return (timeMs - minTimeMs) / totalDuration;
}

export function calculateRelativeDuration(
  durationMs: number,
  totalDurationMs: number
): number {
  if (totalDurationMs === 0) return 0;
  return durationMs / totalDurationMs;
}
