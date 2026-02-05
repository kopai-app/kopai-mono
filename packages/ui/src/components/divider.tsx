import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/component-catalog.js";

export function Divider({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Divider>) {
  const { label } = element.props;

  if (label) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          margin: "16px 0",
        }}
      >
        <hr
          style={{
            flex: 1,
            border: "none",
            borderTop: "1px solid var(--border)",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
        <hr
          style={{
            flex: 1,
            border: "none",
            borderTop: "1px solid var(--border)",
          }}
        />
      </div>
    );
  }

  return (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid var(--border)",
        margin: "16px 0",
      }}
    />
  );
}
