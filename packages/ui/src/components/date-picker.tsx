import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/component-catalog.js";

export function DatePicker({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.DatePicker>) {
  const { label, bindPath, placeholder } = element.props;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <label style={{ fontSize: 14, fontWeight: 500 }}>{label}</label>
      )}
      <input
        type="date"
        placeholder={placeholder || undefined}
        style={{
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          fontSize: 16,
          outline: "none",
        }}
      />
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
        Bound to: {bindPath}
      </p>
    </div>
  );
}
