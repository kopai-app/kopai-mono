/**
 * MetricLeaderboard - Renders AggregatedMetricRow[] as a ranked list.
 *
 * Pure CSS layout (no Recharts). Each row: rank, label, optional proportional
 * bar, formatted value. Sorted DESC by value, sliced to maxRows.
 */

import { useMemo } from "react";
import type { denormalizedSignals } from "@kopai/core";
import { formatOtelValue } from "../utils/units.js";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

// Solid bar color — first entry from MetricHistogram COLORS palette.
const BAR_COLOR = "#8884d8";

export interface MetricLeaderboardProps {
  rows: AggregatedMetricRow[];
  isLoading?: boolean;
  error?: Error;
  maxRows?: number;
  unit?: string;
  showBar?: boolean;
  label?: string;
  formatValue?: (value: number, unit?: string) => string;
  className?: string;
}

interface DisplayRow {
  rank: number;
  label: string;
  value: number;
  widthPct: number;
}

function coerceGroupLabel(groups: Record<string, unknown>): string {
  const values = Object.values(groups);
  if (values.length === 0) return "(no value)";
  const parts = values.map((v) => {
    if (v === null || v === undefined) return "(no value)";
    const s = String(v);
    return s.length === 0 ? "(no value)" : s;
  });
  return parts.join(" / ");
}

function buildDisplayRows(
  rows: AggregatedMetricRow[],
  maxRows: number
): DisplayRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, maxRows);
  const max = sorted.length > 0 ? sorted[0]!.value : 0;
  return sorted.map((row, index) => {
    const label = coerceGroupLabel(row.groups);
    const widthPct = max > 0 ? (row.value / max) * 100 : 0;
    return {
      rank: index + 1,
      label,
      value: row.value,
      widthPct,
    };
  });
}

export function MetricLeaderboard({
  rows,
  isLoading = false,
  error,
  maxRows = 10,
  unit,
  showBar = true,
  label,
  formatValue,
  className = "",
}: MetricLeaderboardProps) {
  const displayRows = useMemo(
    () => buildDisplayRows(rows, maxRows),
    [rows, maxRows]
  );

  const fmt = formatValue ?? formatOtelValue;

  if (isLoading) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-gray-800 animate-pulse ${className}`}
        data-testid="metric-leaderboard-loading"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-6 bg-gray-700 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-red-800 ${className}`}
        data-testid="metric-leaderboard-error"
      >
        <p className="text-red-400 text-sm">{error.message}</p>
      </div>
    );
  }

  if (displayRows.length === 0) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-gray-800 ${className}`}
        data-testid="metric-leaderboard-empty"
      >
        <p className="text-gray-500 text-sm">No data</p>
      </div>
    );
  }

  return (
    <div
      className={`bg-background rounded-lg p-4 border border-gray-800 ${className}`}
      data-testid="metric-leaderboard"
    >
      {label && (
        <p className="text-gray-400 text-sm font-medium mb-2">{label}</p>
      )}
      <div className="flex flex-col gap-1">
        {displayRows.map((row) => (
          <div
            key={`${row.rank}-${row.label}`}
            className="flex items-center gap-3 py-1"
            data-testid="metric-leaderboard-row"
          >
            <span
              className="text-gray-500 text-xs font-mono w-8 flex-shrink-0"
              data-testid="metric-leaderboard-rank"
            >
              #{row.rank}
            </span>
            <span
              className="text-gray-200 text-sm truncate flex-shrink-0"
              style={{ minWidth: "8rem", maxWidth: "16rem" }}
              data-testid="metric-leaderboard-label"
              title={row.label}
            >
              {row.label}
            </span>
            {showBar && (
              <div className="flex-1 h-2 bg-gray-800 rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${row.widthPct}%`,
                    backgroundColor: BAR_COLOR,
                  }}
                  data-testid="metric-leaderboard-bar"
                />
              </div>
            )}
            <span
              className="text-white text-sm font-semibold tabular-nums flex-shrink-0"
              data-testid="metric-leaderboard-value"
            >
              {fmt(row.value, unit ?? "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
