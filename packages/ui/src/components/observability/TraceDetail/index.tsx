import type { denormalizedSignals } from "@kopai/core";
import { TraceTimeline } from "../TraceTimeline/index.js";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

export interface TraceDetailProps {
  service: string;
  traceId: string;
  rows: OtelTracesRow[];
  isLoading?: boolean;
  error?: Error;
  onBack: () => void;
}

export function TraceDetail({
  service,
  traceId,
  rows,
  isLoading,
  error,
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
          Services / {service}
        </button>
        <span>/</span>
        <span className="text-foreground font-mono text-xs">
          {traceId.slice(0, 16)}...
        </span>
      </div>

      <TraceTimeline rows={rows} isLoading={isLoading} error={error} />
    </div>
  );
}
