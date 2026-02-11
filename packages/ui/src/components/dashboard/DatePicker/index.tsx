import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function DatePicker({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.DatePicker>) {
  const { label, bindPath } = element.props;
  const inputId = `datepicker-${bindPath}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: 14, fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type="date"
        style={{
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          border: "1px solid hsl(var(--border))",
          background: "hsl(var(--card))",
          color: "hsl(var(--foreground))",
          fontSize: 16,
          outline: "none",
        }}
      />
      <p
        style={{
          margin: "4px 0 0",
          fontSize: 12,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Bound to: {bindPath}
      </p>
    </div>
  );
}
