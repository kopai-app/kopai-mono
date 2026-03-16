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
  const rawPct = maxDurationMs > 0 ? (durationMs / maxDurationMs) * 100 : 0;
  const widthPct = durationMs <= 0 ? 0 : Math.min(Math.max(rawPct, 1), 100);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted/30 rounded overflow-hidden">
        <div
          className="h-full rounded"
          style={{
            width: `${widthPct}%`,
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
