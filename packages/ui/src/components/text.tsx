import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/simple-component-catalog.js";

export function Text({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Text>) {
  const { content, color } = element.props;
  const colors: Record<string, string> = {
    default: "var(--foreground)",
    muted: "var(--muted)",
    success: "#22c55e",
    warning: "#eab308",
    danger: "#ef4444",
  };
  return (
    <p style={{ margin: 0, color: colors[color || "default"] }}>{content}</p>
  );
}
