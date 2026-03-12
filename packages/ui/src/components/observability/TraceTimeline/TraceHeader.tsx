import { useState } from "react";
import type { ParsedTrace } from "../types.js";
import { formatDuration, formatTimestamp } from "../utils/time.js";
import { getServiceColor } from "../utils/colors.js";

export interface TraceHeaderProps {
  trace: ParsedTrace;
  services?: string[];
  onHeaderToggle?: () => void;
  isCollapsed?: boolean;
}

function computeMaxDepth(spans: ParsedTrace["rootSpans"]): number {
  let max = 0;
  function walk(nodes: ParsedTrace["rootSpans"], depth: number) {
    for (const node of nodes) {
      if (depth > max) max = depth;
      walk(node.children, depth + 1);
    }
  }
  walk(spans, 1);
  return max;
}

export function TraceHeader({
  trace,
  services = [],
  onHeaderToggle,
  isCollapsed = false,
}: TraceHeaderProps) {
  const [copied, setCopied] = useState(false);

  const rootSpan = trace.rootSpans[0];
  const rootServiceName = rootSpan?.serviceName ?? "unknown";
  const rootSpanName = rootSpan?.name ?? "unknown";
  const totalDuration = trace.maxTimeMs - trace.minTimeMs;
  const maxDepth = computeMaxDepth(trace.rootSpans);

  const handleCopyTraceId = async () => {
    try {
      await navigator.clipboard.writeText(trace.traceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy trace ID:", err);
    }
  };

  return (
    <div className="bg-background border-b border-border px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        {onHeaderToggle && (
          <button
            onClick={onHeaderToggle}
            className="p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={isCollapsed ? "Expand header" : "Collapse header"}
          >
            <svg
              className={`w-4 h-4 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
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
        <span className="text-sm font-semibold text-foreground">
          {rootServiceName}: {rootSpanName}
        </span>
      </div>

      {!isCollapsed && (
        <>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Trace ID:
              </span>
              <button
                onClick={handleCopyTraceId}
                className="text-sm font-mono bg-muted px-2 py-1 rounded hover:bg-muted/80 transition-colors text-foreground"
                title="Click to copy"
              >
                {trace.traceId.slice(0, 16)}...
              </button>
              {copied && (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                  Copied!
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Duration:
              </span>
              <span className="text-sm font-medium text-foreground">
                {formatDuration(totalDuration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Spans:
              </span>
              <span className="text-sm font-medium text-foreground">
                {trace.totalSpanCount}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Depth:
              </span>
              <span className="text-sm font-medium text-foreground">
                {maxDepth}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Started:
              </span>
              <span className="text-sm text-foreground">
                {formatTimestamp(trace.minTimeMs)}
              </span>
            </div>
          </div>

          {services.length > 0 && (
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {services.map((svc) => (
                <div key={svc} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getServiceColor(svc) }}
                  />
                  <span className="text-xs text-muted-foreground">{svc}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
