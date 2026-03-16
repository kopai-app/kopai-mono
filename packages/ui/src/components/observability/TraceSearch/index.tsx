import { useState, useMemo } from "react";
import { formatTimestamp } from "../utils/time.js";
import { getServiceColor } from "../utils/colors.js";
import { SearchForm } from "./SearchForm.js";
import type { SearchFormValues } from "./SearchForm.js";
import { ScatterPlot } from "./ScatterPlot.js";
import { SortDropdown } from "./SortDropdown.js";
import { DurationBar } from "./DurationBar.js";

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
  service?: string;
  operation?: string;
  tags?: string;
  lookback?: string;
  minDuration?: string;
  maxDuration?: string;
  limit: number;
}

export interface TraceSearchProps {
  // Search form data
  services?: string[];
  service: string;
  operations?: string[];
  // Results
  traces: TraceSummary[];
  isLoading?: boolean;
  error?: Error;
  // Callbacks
  onSelectTrace: (traceId: string) => void;
  onSearch?: (filters: TraceSearchFilters) => void;
  onCompare?: (traceIds: [string, string]) => void;
  // Sort
  sort?: string;
  onSortChange?: (sort: string) => void;
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

function sortTraces(traces: TraceSummary[], sort: string): TraceSummary[] {
  const sorted = [...traces];
  switch (sort) {
    case "longest":
      return sorted.sort((a, b) => b.durationMs - a.durationMs);
    case "shortest":
      return sorted.sort((a, b) => a.durationMs - b.durationMs);
    case "mostSpans":
      return sorted.sort((a, b) => b.spanCount - a.spanCount);
    case "leastSpans":
      return sorted.sort((a, b) => a.spanCount - b.spanCount);
    case "recent":
    default:
      return sorted.sort((a, b) => b.timestampMs - a.timestampMs);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TraceSearch({
  services = [],
  service,
  operations = [],
  traces,
  isLoading,
  error,
  onSelectTrace,
  onSearch,
  onCompare,
  sort: controlledSort,
  onSortChange,
}: TraceSearchProps) {
  // Sort state (internal fallback if not controlled)
  const [internalSort, setInternalSort] = useState("recent");
  const currentSort = controlledSort ?? internalSort;
  const handleSortChange = (s: string) => {
    if (onSortChange) onSortChange(s);
    else setInternalSort(s);
  };

  // Comparison state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelected = (traceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(traceId)) {
        next.delete(traceId);
      } else {
        // Max 2 selected
        if (next.size >= 2) return prev;
        next.add(traceId);
      }
      return next;
    });
  };

  const handleFormSubmit = (values: SearchFormValues) => {
    onSearch?.({
      service: values.service || undefined,
      operation: values.operation || undefined,
      tags: values.tags || undefined,
      lookback: values.lookback || undefined,
      minDuration: values.minDuration || undefined,
      maxDuration: values.maxDuration || undefined,
      limit: values.limit,
    });
  };

  const sortedTraces = useMemo(
    () => sortTraces(traces, currentSort),
    [traces, currentSort]
  );

  const maxDurationMs = useMemo(
    () => Math.max(...traces.map((t) => t.durationMs), 0),
    [traces]
  );

  const selectedArr = Array.from(selected);

  return (
    <div className="flex gap-6 min-h-0">
      {/* Left sidebar */}
      {onSearch && (
        <div className="w-72 shrink-0 border border-border rounded-lg p-4 self-start">
          <SearchForm
            services={services}
            operations={operations}
            initialValues={{ service }}
            onSubmit={handleFormSubmit}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Right content */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Scatter plot */}
        {traces.length > 0 && (
          <ScatterPlot traces={traces} onSelectTrace={onSelectTrace} />
        )}

        {/* Sort bar + result count */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {traces.length} Trace{traces.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            {onCompare && selected.size === 2 && (
              <button
                onClick={() => onCompare(selectedArr as [string, string])}
                className="px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded hover:bg-foreground/90 transition-colors"
              >
                Compare
              </button>
            )}
            <SortDropdown value={currentSort} onChange={handleSortChange} />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            Loading traces...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-red-400 py-4">
            Error loading traces: {error.message}
          </div>
        )}

        {/* Empty */}
        {!isLoading && !error && traces.length === 0 && (
          <div className="text-muted-foreground py-8">No traces found</div>
        )}

        {/* Result cards */}
        {sortedTraces.length > 0 && (
          <div className="space-y-2">
            {sortedTraces.map((t) => (
              <div
                key={t.traceId}
                className="border border-border rounded-lg px-4 py-3 hover:border-foreground/30 hover:bg-muted/30 cursor-pointer transition-colors"
              >
                {/* Title line */}
                <div className="flex items-center gap-2">
                  {onCompare && (
                    <input
                      type="checkbox"
                      checked={selected.has(t.traceId)}
                      onChange={() => toggleSelected(t.traceId)}
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0"
                      disabled={!selected.has(t.traceId) && selected.size >= 2}
                    />
                  )}
                  <div
                    className="flex-1 min-w-0"
                    onClick={() => onSelectTrace(t.traceId)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="font-medium text-foreground truncate">
                          {t.serviceName}: {t.rootSpanName}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {t.traceId.slice(0, 7)}
                        </span>
                      </div>
                    </div>

                    {/* Duration bar */}
                    <div className="mt-1.5">
                      <DurationBar
                        durationMs={t.durationMs}
                        maxDurationMs={maxDurationMs}
                        color={getServiceColor(t.serviceName)}
                      />
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
