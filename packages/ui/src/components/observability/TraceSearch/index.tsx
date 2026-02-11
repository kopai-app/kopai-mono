import { useState } from "react";
import { formatDuration, formatTimestamp } from "../utils/time.js";
import { getServiceColor } from "../utils/colors.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TraceSummary {
  traceId: string;
  rootSpanName: string;
  serviceName: string;
  durationMs: number;
  statusCode: string;
  timestampMs: number;
  spanCount: number;
  services: { name: string; count: number; hasError: boolean }[];
  errorCount: number;
}

export interface TraceSearchFilters {
  operation?: string;
  lookbackMs?: number;
  minDuration?: string;
  maxDuration?: string;
  limit: number;
}

export interface TraceSearchProps {
  service: string;
  traces: TraceSummary[];
  operations?: string[];
  isLoading?: boolean;
  error?: Error;
  onSelectTrace: (traceId: string) => void;
  onBack: () => void;
  onSearch?: (filters: TraceSearchFilters) => void;
}

// ---------------------------------------------------------------------------
// Lookback presets
// ---------------------------------------------------------------------------

const LOOKBACK_OPTIONS = [
  { label: "Last 5 Minutes", ms: 5 * 60_000 },
  { label: "Last 15 Minutes", ms: 15 * 60_000 },
  { label: "Last 30 Minutes", ms: 30 * 60_000 },
  { label: "Last 1 Hour", ms: 60 * 60_000 },
  { label: "Last 2 Hours", ms: 2 * 60 * 60_000 },
  { label: "Last 6 Hours", ms: 6 * 60 * 60_000 },
  { label: "Last 12 Hours", ms: 12 * 60 * 60_000 },
  { label: "Last 24 Hours", ms: 24 * 60 * 60_000 },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TraceSearch({
  service,
  traces,
  operations = [],
  isLoading,
  error,
  onSelectTrace,
  onBack,
  onSearch,
}: TraceSearchProps) {
  const [operation, setOperation] = useState("all");
  const [lookbackIdx, setLookbackIdx] = useState<number>(-1);
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [limit, setLimit] = useState(20);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const handleFindTraces = () => {
    onSearch?.({
      operation: operation !== "all" ? operation : undefined,
      lookbackMs:
        lookbackIdx >= 0 ? LOOKBACK_OPTIONS[lookbackIdx]!.ms : undefined,
      minDuration: minDuration || undefined,
      maxDuration: maxDuration || undefined,
      limit,
    });
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <button
          onClick={onBack}
          className="hover:text-foreground transition-colors"
        >
          Services
        </button>
        <span>/</span>
        <span className="text-foreground">{service}</span>
      </div>

      {/* Filter panel */}
      {onSearch && (
        <div className="border border-border rounded-lg mb-4">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
          >
            <span>Filters</span>
            <span className="text-muted-foreground text-xs">
              {filtersOpen ? "▲" : "▼"}
            </span>
          </button>
          {filtersOpen && (
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {/* Operation */}
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Operation
                  </span>
                  <select
                    value={operation}
                    onChange={(e) => setOperation(e.target.value)}
                    className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value="all">All</option>
                    {operations.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Lookback */}
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Lookback
                  </span>
                  <select
                    value={lookbackIdx}
                    onChange={(e) => setLookbackIdx(Number(e.target.value))}
                    className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value={-1}>All time</option>
                    {LOOKBACK_OPTIONS.map((opt, i) => (
                      <option key={i} value={i}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Limit */}
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Limit</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={limit}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setLimit(
                        Number.isNaN(n) ? 20 : Math.max(1, Math.min(1000, n))
                      );
                    }}
                    className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground"
                  />
                </label>

                {/* Min Duration */}
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Min Duration
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 100ms"
                    value={minDuration}
                    onChange={(e) => setMinDuration(e.target.value)}
                    className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
                  />
                </label>

                {/* Max Duration */}
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Max Duration
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 5s"
                    value={maxDuration}
                    onChange={(e) => setMaxDuration(e.target.value)}
                    className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
                  />
                </label>
              </div>

              <button
                onClick={handleFindTraces}
                className="px-4 py-1.5 text-sm font-medium bg-foreground text-background rounded hover:bg-foreground/90 transition-colors"
              >
                Find Traces
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          Loading traces...
        </div>
      )}

      {error && (
        <div className="text-red-400 py-4">
          Error loading traces: {error.message}
        </div>
      )}

      {!isLoading && !error && traces.length === 0 && (
        <div className="text-muted-foreground py-8">
          No traces found for {service}
        </div>
      )}

      {traces.length > 0 && (
        <div className="space-y-2">
          {traces.map((t) => (
            <div
              key={t.traceId}
              onClick={() => onSelectTrace(t.traceId)}
              className="border border-border rounded-lg px-4 py-3 hover:border-foreground/30 hover:bg-muted/30 cursor-pointer transition-colors"
            >
              {/* Title line */}
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-medium text-foreground truncate">
                    {t.serviceName}: {t.rootSpanName}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                    {t.traceId.slice(0, 7)}
                  </span>
                </div>
                <span className="text-sm text-foreground/80 shrink-0">
                  {formatDuration(t.durationMs)}
                </span>
              </div>

              {/* Tags line */}
              <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {t.spanCount} Span{t.spanCount !== 1 ? "s" : ""}
                </span>
                {t.errorCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                    {t.errorCount} Error{t.errorCount !== 1 ? "s" : ""}
                  </span>
                )}
                {t.services.map((svc) => (
                  <span
                    key={svc.name}
                    className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${getServiceColor(svc.name)}20`,
                      color: getServiceColor(svc.name),
                    }}
                  >
                    {svc.hasError && (
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    )}
                    {svc.name} ({svc.count})
                  </span>
                ))}
              </div>

              {/* Timestamp */}
              <div className="text-xs text-muted-foreground mt-1 text-right">
                {formatTimestamp(t.timestampMs)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
