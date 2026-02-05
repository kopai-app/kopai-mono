import { useState } from "react";
import { observabilityCatalog } from "../lib/observability-catalog.js";
import type { RendererComponentProps } from "../lib/renderer.js";

type OtelTableProps = RendererComponentProps<
  typeof observabilityCatalog.components.Table
>;

type ColumnFormat =
  | "text"
  | "timestamp"
  | "duration"
  | "truncate"
  | "badge"
  | "json"
  | "currency"
  | "date"
  | null;

const LIMIT_OPTIONS = [10, 25, 50, 100] as const;

function formatTimestamp(ns: number | string): string {
  const ms =
    typeof ns === "string" ? parseInt(ns, 10) / 1_000_000 : ns / 1_000_000;
  return new Date(ms).toLocaleString();
}

function formatDuration(ns: number | string): string {
  const num = typeof ns === "string" ? parseInt(ns, 10) : ns;
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}s`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}ms`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}us`;
  }
  return `${num}ns`;
}

function truncateString(value: string, maxLen = 50): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "...";
}

function getBadgeColor(value: string): string {
  const upper = String(value).toUpperCase();
  if (upper === "OK" || upper === "SUCCESS" || upper === "ACTIVE")
    return "#22c55e";
  if (upper === "ERROR" || upper === "FAILED" || upper === "DANGER")
    return "#ef4444";
  if (upper === "WARNING" || upper === "PENDING") return "#f59e0b";
  return "var(--muted)";
}

function LoadingSkeleton({ columns }: { columns: number }) {
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: "12px 8px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 14,
                    background: "var(--border)",
                    borderRadius: 4,
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, rowIdx) => (
            <tr key={rowIdx}>
              {Array.from({ length: columns }).map((_, colIdx) => (
                <td
                  key={colIdx}
                  style={{
                    padding: "12px 8px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      width: "80%",
                      height: 14,
                      background: "var(--border)",
                      borderRadius: 4,
                      opacity: 0.5,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorDisplay({ error }: { error: Error }) {
  return (
    <div
      style={{
        padding: 16,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        color: "#dc2626",
      }}
    >
      <strong>Error:</strong> {error.message}
    </div>
  );
}

export function OtelTable(props: OtelTableProps) {
  const { columns, title } = props.element.props;
  const [limit, setLimit] = useState<(typeof LIMIT_OPTIONS)[number]>(10);

  // Handle dataSource case
  if (props.hasData) {
    if (props.loading) {
      return <LoadingSkeleton columns={columns.length} />;
    }
    if (props.error) {
      return <ErrorDisplay error={props.error} />;
    }

    const responseData = props.data as { data?: unknown[] } | null;
    const rows = responseData?.data ?? [];

    const formatCell = (value: unknown, format: ColumnFormat) => {
      if (value === null || value === undefined) return "-";

      if (
        format === "timestamp" &&
        (typeof value === "number" || typeof value === "string")
      ) {
        return formatTimestamp(value as number | string);
      }
      if (
        format === "duration" &&
        (typeof value === "number" || typeof value === "string")
      ) {
        return formatDuration(value as number | string);
      }
      if (format === "truncate" && typeof value === "string") {
        return truncateString(value);
      }
      if (format === "badge") {
        return (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 500,
              background: getBadgeColor(String(value)),
              color: "#fff",
            }}
          >
            {String(value)}
          </span>
        );
      }
      if (format === "json" && typeof value === "object") {
        return (
          <code
            style={{
              fontSize: 11,
              background: "var(--border)",
              padding: "2px 4px",
              borderRadius: 4,
            }}
          >
            {truncateString(JSON.stringify(value), 60)}
          </code>
        );
      }
      if (format === "currency" && typeof value === "number") {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(value);
      }
      if (format === "date" && typeof value === "string") {
        return new Date(value).toLocaleDateString();
      }
      return String(value);
    };

    const getNestedValue = (
      obj: Record<string, unknown>,
      path: string
    ): unknown => {
      return path.split(".").reduce((acc: unknown, key) => {
        if (acc && typeof acc === "object") {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, obj);
    };

    return (
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          {title && (
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              {title}
            </h4>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Show:</span>
            <select
              value={limit}
              onChange={(e) => {
                const newLimit = Number(
                  e.target.value
                ) as (typeof LIMIT_OPTIONS)[number];
                setLimit(newLimit);
                props.refetch({ limit: newLimit });
              }}
              style={{
                padding: "4px 8px",
                fontSize: 12,
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
              }}
            >
              {LIMIT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: "left",
                    padding: "12px 8px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: "24px 8px",
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 14,
                  }}
                >
                  No data available
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        padding: "12px 8px",
                        borderBottom: "1px solid var(--border)",
                        fontSize: 14,
                      }}
                    >
                      {formatCell(
                        getNestedValue(row as Record<string, unknown>, col.key),
                        col.format
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
          Showing {rows.length} results
        </p>
      </div>
    );
  }

  // Fallback: no dataSource
  return (
    <div>
      {title && (
        <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>
          {title}
        </h4>
      )}
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        No data source configured
      </div>
    </div>
  );
}
