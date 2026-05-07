import { observabilityCatalog } from "@kopai/ui-core";
import type { CatalogueComponentProps } from "@kopai/ui-core";

export function Grid({
  element,
  children,
}: CatalogueComponentProps<typeof observabilityCatalog.components.Grid>) {
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
