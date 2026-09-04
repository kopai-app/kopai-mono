/**
 * RawDataTable - Display arbitrary tabular data with dynamic columns.
 * Accepts RawTableData directly (unchanged from source).
 */

import type { RawTableData } from "../types.js";
import { resolveUnitScale, formatDisplayValue } from "../utils/units.js";

export interface RawDataTableProps {
  data: RawTableData;
  /**
   * Optional per-column OTel unit, positionally aligned with `data.columns`.
   * A unit routes that column through the shared scale resolver — the same
   * one the charts and MetricStat use — so `ns`/`us`/`ms`/`s` render as
   * durations, `By` as bytes, `"1"` as a percent, and an unknown unit as a
   * scaled number with the unit appended. A nullish entry keeps plain SI.
   */
  units?: (string | null | undefined)[];
  /**
   * Optional per-column display header, positionally aligned with
   * `data.columns`. A nullish entry falls back to the raw column name — this
   * component applies no naming policy of its own.
   */
  headers?: (string | null | undefined)[];
  maxRows?: number;
  isLoading?: boolean;
  error?: Error;
  className?: string;
}

const SCALE_K = 1e3;
const SCALE_M = 1e6;
const SCALE_G = 1e9;

// A column is read against its neighbours, so durations get a second digit
// that a chart axis wouldn't bother with.
const CELL_FRACTION_DIGITS = 2;

function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  return ["Int", "UInt", "Float", "Decimal"].some((t) => type.includes(t));
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= SCALE_G) return `${(value / SCALE_G).toFixed(2)}G`;
  if (Math.abs(value) >= SCALE_M) return `${(value / SCALE_M).toFixed(2)}M`;
  if (Math.abs(value) >= SCALE_K) return `${(value / SCALE_K).toFixed(2)}K`;
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(2);
}

// Unit-annotated cells go through the same scale resolver as MetricStat and
// the chart axes, so one `By` value can't read as "5.24 MB" in a chart and
// "5.00 MiB" in a table. Unannotated cells keep this component's own K/M/G
// scaling — `resolveUnitScale(null)` would relabel 1.4e9 as "1.4 B", which
// collides with bytes in a table that may hold both.
function formatNumericCell(value: number, unit: string | null | undefined) {
  if (!unit) return formatNumber(value);
  const scale = resolveUnitScale(unit, Math.abs(value));
  return formatDisplayValue(value, scale, CELL_FRACTION_DIGITS);
}

function formatCell(value: unknown, unit?: string | null): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return formatNumericCell(value, unit);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RawDataTable({
  data,
  units,
  headers,
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
                  {headers?.[colIdx] ?? col}
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
                    {formatCell(row[colIdx], units?.[colIdx])}
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
