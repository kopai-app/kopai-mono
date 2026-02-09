import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function Stack({
  element,
  children,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Stack>) {
  const { direction, gap, align } = element.props;
  const gaps: Record<string, string> = {
    sm: "8px",
    md: "16px",
    lg: "24px",
  };
  const alignments: Record<string, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    stretch: "stretch",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap: gaps[gap || "md"],
        alignItems: alignments[align || "stretch"],
      }}
    >
      {children}
    </div>
  );
}
