import { formatDuration } from "../utils/time.js";

export interface TimeRulerProps {
  totalDurationMs: number;
  leftColumnWidth: string;
  offsetMs?: number;
}

const TICK_COUNT = 5;

export function TimeRuler({
  totalDurationMs,
  leftColumnWidth,
  offsetMs = 0,
}: TimeRulerProps) {
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const fraction = i / TICK_COUNT;
    return {
      label: formatDuration(offsetMs + totalDurationMs * fraction),
      percent: fraction * 100,
    };
  });

  return (
    <div className="flex border-b border-border bg-background">
      <div className="flex-shrink-0" style={{ width: leftColumnWidth }} />
      <div className="flex-1 relative h-6 px-2">
        {ticks.map((tick) => (
          <div
            key={tick.percent}
            className="absolute top-0 h-full flex flex-col justify-end"
            style={{ left: `${tick.percent}%` }}
          >
            <div className="h-2 border-l border-muted-foreground/40" />
            <span
              className="text-[10px] text-muted-foreground font-mono -translate-x-1/2 absolute bottom-0 whitespace-nowrap"
              style={{
                left: 0,
                transform:
                  tick.percent === 100
                    ? "translateX(-100%)"
                    : tick.percent === 0
                      ? "none"
                      : "translateX(-50%)",
              }}
            >
              {tick.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
