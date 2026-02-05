import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/component-catalog.js";

export function Grid({
  element,
  children,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Grid>) {
  const { columns, gap } = element.props;
  const gaps: Record<string, string> = {
    sm: "8px",
    md: "16px",
    lg: "24px",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns || 2}, 1fr)`,
        gap: gaps[gap || "md"],
      }}
    >
      {children}
    </div>
  );
}
