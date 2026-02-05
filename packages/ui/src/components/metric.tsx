import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/simple-component-catalog.js";

export function Metric({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Metric>) {
  const { label, valuePath, trend, trendValue } = element.props;

  // For example page, we just display the valuePath as placeholder
  const displayValue = valuePath;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 14, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 600 }}>{displayValue}</span>
      {(trend || trendValue) && (
        <span
          style={{
            fontSize: 14,
            color:
              trend === "up"
                ? "#22c55e"
                : trend === "down"
                  ? "#ef4444"
                  : "var(--muted)",
          }}
        >
          {trend === "up" ? "+" : trend === "down" ? "-" : ""}
          {trendValue}
        </span>
      )}
    </div>
  );
}
