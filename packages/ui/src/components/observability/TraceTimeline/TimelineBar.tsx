import type { SpanNode } from "../types.js";
import { getSpanBarColor } from "../utils/colors.js";
import { formatDuration } from "../utils/time.js";
import { Tooltip } from "./Tooltip.js";

export interface TimelineBarProps {
  span: SpanNode;
  relativeStart: number;
  relativeDuration: number;
}

export function TimelineBar({
  span,
  relativeStart,
  relativeDuration,
}: TimelineBarProps) {
  const isError = span.status === "ERROR";
  const barColor = getSpanBarColor(span.serviceName, isError);

  const leftPercent = relativeStart * 100;
  const widthPercent = Math.max(0.2, relativeDuration * 100);
  const isWide = widthPercent > 8;

  const tooltipText = `${span.name}\n${formatDuration(span.durationMs)}\nStatus: ${isError ? "ERROR" : "OK"}`;
  const durationLabel = formatDuration(span.durationMs);

  return (
    <div className="relative h-full">
      <Tooltip content={tooltipText}>
        <div className="absolute inset-0">
          <div
            className="absolute top-1/2 -translate-y-1/2 h-2 rounded-sm cursor-pointer hover:opacity-80 transition-opacity flex items-center"
            style={{
              left: `${leftPercent}%`,
              width: `max(2px, ${widthPercent}%)`,
              backgroundColor: barColor,
            }}
          >
            {isWide && (
              <span className="text-[10px] font-mono text-white px-1 truncate">
                {durationLabel}
              </span>
            )}
          </div>
          {!isWide && (
            <span
              className="absolute top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground whitespace-nowrap"
              style={{ left: `calc(${leftPercent + widthPercent}% + 4px)` }}
            >
              {durationLabel}
            </span>
          )}
        </div>
      </Tooltip>
    </div>
  );
}
