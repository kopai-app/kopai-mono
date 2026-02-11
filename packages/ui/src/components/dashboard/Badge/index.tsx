import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function Badge({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Badge>) {
  const { text, variant } = element.props;

  const colors: Record<string, string> = {
    default: "hsl(var(--foreground))",
    success: "#22c55e",
    warning: "#eab308",
    danger: "#ef4444",
    info: "hsl(var(--muted-foreground))",
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        background: "hsl(var(--border))",
        color: colors[variant || "default"],
      }}
    >
      {text}
    </span>
  );
}
