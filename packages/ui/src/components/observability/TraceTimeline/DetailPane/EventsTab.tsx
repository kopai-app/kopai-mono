import { useState } from "react";
import type { SpanNode } from "../../types.js";
import { formatDuration } from "../../utils/time.js";
import { formatAttributeValue } from "../../utils/attributes.js";

export interface EventsTabProps {
  span: SpanNode;
}

function formatRelativeTime(eventTimeMs: number, spanStartMs: number): string {
  const relativeMs = eventTimeMs - spanStartMs;
  return `+${formatDuration(relativeMs)}`;
}

export function EventsTab({ span }: EventsTabProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const toggleEventExpanded = (index: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (!span.events || span.events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No events available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {span.events.map((event, index) => {
        const isExpanded = expandedEvents.has(index);
        const hasAttributes =
          event.attributes && Object.keys(event.attributes).length > 0;
        const relativeTime = formatRelativeTime(
          event.timeUnixMs,
          span.startTimeUnixMs
        );

        return (
          <div
            key={index}
            className="border border-border rounded-lg overflow-hidden"
          >
            <div className="bg-muted p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">
                    {event.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {relativeTime} from span start
                  </div>
                </div>
                {hasAttributes && (
                  <button
                    onClick={() => toggleEventExpanded(index)}
                    className="p-1 hover:bg-muted/80 rounded transition-colors"
                    aria-label={
                      isExpanded ? "Collapse attributes" : "Expand attributes"
                    }
                    aria-expanded={isExpanded}
                  >
                    <svg
                      className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {hasAttributes && isExpanded && (
              <div className="p-3 bg-background border-t border-border">
                <div className="text-xs font-semibold text-foreground mb-2">
                  Attributes
                </div>
                <div className="space-y-2">
                  {Object.entries(event.attributes).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[minmax(100px,1fr)_2fr] gap-3 text-xs"
                    >
                      <div className="font-mono font-medium text-foreground break-words">
                        {key}
                      </div>
                      <div className="text-foreground break-words">
                        {typeof value === "object" ? (
                          <pre className="text-xs bg-muted p-2 rounded border border-border overflow-x-auto">
                            {formatAttributeValue(value)}
                          </pre>
                        ) : (
                          <span>{formatAttributeValue(value)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hasAttributes && (
              <div className="px-3 pb-3 text-xs text-muted-foreground italic">
                No attributes
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
