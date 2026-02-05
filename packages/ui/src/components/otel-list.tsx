import type { ReactNode } from "react";
import { observabilityCatalog } from "../lib/observability-catalog.js";
import type { RendererComponentProps } from "../lib/renderer.js";

type OtelListProps = RendererComponentProps<
  typeof observabilityCatalog.components.List
>;

function LoadingSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 40,
            background: "var(--border)",
            borderRadius: 4,
            opacity: 0.5,
          }}
        />
      ))}
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

export function OtelList(props: OtelListProps & { children?: ReactNode }) {
  const { emptyMessage } = props.element.props;
  const { children } = props;

  // Handle dataSource case
  if (props.hasData) {
    if (props.loading) {
      return <LoadingSkeleton />;
    }
    if (props.error) {
      return <ErrorDisplay error={props.error} />;
    }

    const responseData = props.data as { data?: unknown[] } | null;
    const items = responseData?.data ?? [];

    if (items.length === 0) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          {emptyMessage || "No items"}
        </div>
      );
    }

    // Children are rendered by the parent renderer for each iteration
    return <div>{children}</div>;
  }

  // Fallback: static rendering (no dataSource)
  return (
    <div>
      {children}
      {emptyMessage && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>
          Empty: "{emptyMessage}"
        </p>
      )}
    </div>
  );
}
