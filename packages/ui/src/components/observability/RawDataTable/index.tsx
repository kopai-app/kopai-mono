/**
 * RawDataTable - Display arbitrary tabular data with dynamic columns.
 * Accepts RawTableData directly (unchanged from source).
 */

import type { RawTableData } from "../types.js";

export interface RawDataTableProps {
  data: RawTableData;
  maxRows?: number;
  isLoading?: boolean;
  error?: Error;
  className?: string;
}

const SCALE_K = 1e3;
const SCALE_M = 1e6;
const SCALE_G = 1e9;

function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  return ["Int", "UInt", "Float", "Decimal"].some((t) => type.includes(t));
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= SCALE_G) return `${(value / SCALE_G).toFixed(2)}G`;
  if (Math.abs(value) >= SCALE_M) return `${(value / SCALE_M).toFixed(2)}M`;
  if (Math.abs(value) >= SCALE_K) return `${(value / SCALE_K).toFixed(2)}K`;
  if (Number.isInteger(value)) return value.toLocaleString();
  if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RawDataTable({
  data,
  maxRows = 50,
  isLoading = false,
  error,
  className = "",
}: RawDataTableProps) {
  if (isLoading) {
    return (
      <div className={`bg-background rounded-lg p-4 ${className}`}>
        <div className="animate-pulse" data-testid="raw-data-table-loading">
          <div className="h-10 bg-muted rounded mb-2" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-muted/50 rounded mb-1" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-destructive ${className}`}
        data-testid="raw-data-table-error"
      >
        <p className="text-destructive">Error: {error.message}</p>
      </div>
    );
  }

  const { columns, types, rows } = data;

  if (rows.length === 0) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-border ${className}`}
        data-testid="raw-data-table-empty"
      >
        <p className="text-muted-foreground text-center py-4">
          No data available
        </p>
      </div>
    );
  }

  const isTruncated = rows.length > maxRows;
  const displayRows = rows.slice(0, maxRows);

  return (
    <div
      className={`bg-background rounded-lg overflow-hidden border border-border ${className}`}
      data-testid="raw-data-table"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted text-muted-foreground text-left">
              {columns.map((col, colIdx) => (
                <th
                  key={colIdx}
                  className={`px-4 py-3 font-medium whitespace-nowrap ${isNumericType(types[colIdx]) ? "text-right" : "text-left"}`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-muted/50 transition-colors">
                {columns.map((_, colIdx) => (
                  <td
                    key={colIdx}
                    className={`px-4 py-3 whitespace-nowrap ${isNumericType(types[colIdx]) ? "text-right text-foreground font-medium" : "text-foreground"}`}
                  >
                    {formatCell(row[colIdx])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isTruncated && (
        <div className="px-4 py-2 bg-muted text-muted-foreground text-xs text-center">
          Showing first {maxRows} of {rows.length} rows
        </div>
      )}
    </div>
  );
}
