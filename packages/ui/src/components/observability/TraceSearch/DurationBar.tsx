/**
 * DurationBar - Horizontal bar showing relative trace duration.
 */

import { formatDuration } from "../utils/time.js";

export interface DurationBarProps {
  durationMs: number;
  maxDurationMs: number;
  color: string;
}

export function DurationBar({
  durationMs,
  maxDurationMs,
  color,
}: DurationBarProps) {
  const widthPct = maxDurationMs > 0 ? (durationMs / maxDurationMs) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted/30 rounded overflow-hidden">
        <div
          className="h-full rounded"
          style={{
            width: `${Math.max(widthPct, 1)}%`,
            backgroundColor: color,
            opacity: 0.7,
          }}
        />
      </div>
      <span className="text-xs text-foreground/80 shrink-0 w-16 text-right font-mono">
        {formatDuration(durationMs)}
      </span>
    </div>
  );
}
