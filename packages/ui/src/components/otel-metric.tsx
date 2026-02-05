import { observabilityCatalog } from "../lib/observability-catalog.js";
import type { RendererComponentProps } from "../lib/renderer.js";

type OtelMetricProps = RendererComponentProps<
  typeof observabilityCatalog.components.Metric
>;

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

function formatDuration(ns: number): string {
  if (ns >= 1_000_000_000) {
    return `${(ns / 1_000_000_000).toFixed(2)}s`;
  }
  if (ns >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(2)}ms`;
  }
  if (ns >= 1_000) {
    return `${(ns / 1_000).toFixed(2)}us`;
  }
  return `${ns}ns`;
}

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          width: 60,
          height: 14,
          background: "var(--border)",
          borderRadius: 4,
        }}
      />
      <div
        style={{
          width: 80,
          height: 32,
          background: "var(--border)",
          borderRadius: 4,
          opacity: 0.7,
        }}
      />
    </div>
  );
}

function ErrorDisplay({ error }: { error: Error }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 14, color: "var(--muted)" }}>Error</span>
      <span style={{ fontSize: 14, color: "#ef4444" }}>{error.message}</span>
    </div>
  );
}

export function OtelMetric(props: OtelMetricProps) {
  const { label, valueKey, format } = props.element.props;

  // Handle dataSource case
  if (props.hasData) {
    if (props.loading) {
      return <LoadingSkeleton />;
    }
    if (props.error) {
      return <ErrorDisplay error={props.error} />;
    }

    const responseData = props.data as Record<string, unknown> | null;

    // Extract value using valueKey (supports nested paths like "total" or "data.length")
    const getValue = (obj: Record<string, unknown>, path: string): unknown => {
      return path.split(".").reduce((acc: unknown, key) => {
        if (acc && typeof acc === "object") {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, obj);
    };

    let rawValue = responseData ? getValue(responseData, valueKey) : undefined;

    // Handle array length
    if (Array.isArray(rawValue)) {
      rawValue = rawValue.length;
    }

    const numValue = typeof rawValue === "number" ? rawValue : 0;

    let displayValue: string;
    if (format === "duration") {
      displayValue = formatDuration(numValue);
    } else if (format === "count" || format === "number") {
      displayValue = formatNumber(numValue);
    } else {
      displayValue = String(rawValue ?? 0);
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 14, color: "var(--muted)" }}>{label}</span>
        <span style={{ fontSize: 32, fontWeight: 600 }}>{displayValue}</span>
      </div>
    );
  }

  // Fallback: display valueKey as placeholder (no dataSource)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 14, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 600 }}>{valueKey}</span>
    </div>
  );
}
