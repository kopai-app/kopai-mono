import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function Empty({
  element,
  onAction,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Empty> & {
  onAction?: (action: string) => void;
}) {
  const { title, description, action, actionLabel } = element.props;

  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>
        {title}
      </h3>
      {description && (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 14,
            color: "hsl(var(--muted-foreground))",
          }}
        >
          {description}
        </p>
      )}
      {action && actionLabel && (
        <button
          onClick={() => onAction?.(action)}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius)",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
            color: "hsl(var(--foreground))",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
