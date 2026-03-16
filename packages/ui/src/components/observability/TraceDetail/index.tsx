import type { denormalizedSignals } from "@kopai/core";
import { TraceTimeline } from "../TraceTimeline/index.js";
import type { SpanNode } from "../types.js";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

export interface TraceDetailProps {
  traceId: string;
  rows: OtelTracesRow[];
  isLoading?: boolean;
  error?: Error;
  selectedSpanId?: string;
  onSpanClick?: (span: SpanNode) => void;
  onSpanDeselect?: () => void;
  onBack: () => void;
}

export function TraceDetail({
  traceId,
  rows,
  isLoading,
  error,
  selectedSpanId,
  onSpanClick,
  onSpanDeselect,
  onBack,
}: TraceDetailProps) {
  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <button
          onClick={onBack}
          className="hover:text-foreground transition-colors"
        >
          Traces
        </button>
        <span>/</span>
        <span className="text-foreground font-mono text-xs">
          {traceId.slice(0, 16)}...
        </span>
      </div>

      <TraceTimeline
        rows={rows}
        isLoading={isLoading}
        error={error}
        selectedSpanId={selectedSpanId}
        onSpanClick={onSpanClick}
        onSpanDeselect={onSpanDeselect}
      />
    </div>
  );
}
