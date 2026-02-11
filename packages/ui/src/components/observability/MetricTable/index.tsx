/**
 * MetricTable - Accepts OtelMetricsRow[] and renders tabular metric data.
 */

import { useMemo } from "react";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

export interface MetricTableProps {
  rows: OtelMetricsRow[];
  isLoading?: boolean;
  error?: Error;
  maxRows?: number;
  formatValue?: (value: number) => string;
  formatTimestamp?: (timestamp: number) => string;
  columns?: ("timestamp" | "metric" | "labels" | "value")[];
  className?: string;
}

interface TableRow {
  id: string;
  timestamp: number;
  metricName: string;
  labels: Record<string, string>;
  value: number;
  unit: string;
}

const defaultFormatValue = (value: number): string => {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
};

const defaultFormatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "-";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

function buildTableRows(rows: OtelMetricsRow[], maxRows: number): TableRow[] {
  const result: TableRow[] = [];

  for (const row of rows) {
    if (
      row.MetricType === "Histogram" ||
      row.MetricType === "ExponentialHistogram" ||
      row.MetricType === "Summary"
    )
      continue;

    const timestamp = Number(BigInt(row.TimeUnix) / 1_000_000n);
    const value = "Value" in row ? row.Value : 0;
    const labels: Record<string, string> = {};
    if (row.Attributes) {
      for (const [k, v] of Object.entries(row.Attributes))
        labels[k] = String(v);
    }
    const key = row.Attributes ? JSON.stringify(row.Attributes) : "__default__";

    result.push({
      id: `${row.MetricName}-${key}-${timestamp}`,
      timestamp,
      metricName: row.MetricName ?? "unknown",
      labels,
      value,
      unit: row.MetricUnit ?? "",
    });
  }

  return result.sort((a, b) => b.timestamp - a.timestamp).slice(0, maxRows);
}

export function MetricTable({
  rows,
  isLoading = false,
  error,
  maxRows = 100,
  formatValue = defaultFormatValue,
  formatTimestamp = defaultFormatTimestamp,
  columns = ["timestamp", "metric", "labels", "value"],
  className = "",
}: MetricTableProps) {
  const tableRows = useMemo(
    () => buildTableRows(rows, maxRows),
    [rows, maxRows]
  );

  if (isLoading) {
    return (
      <div className={`bg-background rounded-lg p-4 ${className}`}>
        <div className="animate-pulse" data-testid="metric-table-loading">
          <div className="h-10 bg-gray-800 rounded mb-2" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-gray-800/50 rounded mb-1" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-red-800 ${className}`}
        data-testid="metric-table-error"
      >
        <p className="text-red-400">Error loading metrics: {error.message}</p>
      </div>
    );
  }

  if (tableRows.length === 0) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-gray-800 ${className}`}
        data-testid="metric-table-empty"
      >
        <p className="text-gray-500 text-center py-4">
          No metric data available
        </p>
      </div>
    );
  }

  return (
    <div
      className={`bg-background rounded-lg overflow-hidden ${className}`}
      data-testid="metric-table"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800 text-gray-300 text-left">
              {columns.includes("timestamp") && (
                <th className="px-4 py-3 font-medium">Timestamp</th>
              )}
              {columns.includes("metric") && (
                <th className="px-4 py-3 font-medium">Metric</th>
              )}
              {columns.includes("labels") && (
                <th className="px-4 py-3 font-medium">Labels</th>
              )}
              {columns.includes("value") && (
                <th className="px-4 py-3 font-medium text-right">Value</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {tableRows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-gray-800/50 transition-colors"
              >
                {columns.includes("timestamp") && (
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {formatTimestamp(row.timestamp)}
                  </td>
                )}
                {columns.includes("metric") && (
                  <td className="px-4 py-3 text-gray-200 font-mono">
                    {row.metricName}
                  </td>
                )}
                {columns.includes("labels") && (
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                    {formatLabels(row.labels)}
                  </td>
                )}
                {columns.includes("value") && (
                  <td className="px-4 py-3 text-white font-medium text-right whitespace-nowrap">
                    {formatValue(row.value)}
                    {row.unit && (
                      <span className="text-gray-500 ml-1">{row.unit}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tableRows.length === maxRows && (
        <div className="px-4 py-2 bg-gray-800 text-gray-500 text-xs text-center">
          Showing first {maxRows} rows
        </div>
      )}
    </div>
  );
}
