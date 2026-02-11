import { useState } from "react";
import type { ParsedTrace } from "../types.js";
import { formatDuration, formatTimestamp } from "../utils/time.js";

export interface TraceHeaderProps {
  trace: ParsedTrace;
}

export function TraceHeader({ trace }: TraceHeaderProps) {
  const [copied, setCopied] = useState(false);

  const rootSpan = trace.rootSpans[0];
  const rootServiceName = rootSpan?.serviceName ?? "unknown";
  const rootSpanName = rootSpan?.name ?? "unknown";
  const totalDuration = trace.maxTimeMs - trace.minTimeMs;

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
            Root:
          </span>
          <span className="text-sm">
            <span className="text-muted-foreground">{rootServiceName}</span>
            <span className="mx-1 text-muted-foreground/70">/</span>
            <span className="font-medium text-foreground">{rootSpanName}</span>
          </span>
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
            Started:
          </span>
          <span className="text-sm text-foreground">
            {formatTimestamp(trace.minTimeMs)}
          </span>
        </div>
      </div>
    </div>
  );
}
