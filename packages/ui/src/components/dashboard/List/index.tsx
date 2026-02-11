import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function List({
  element,
  children,
}: CatalogueComponentProps<typeof dashboardCatalog.components.List>) {
  const { dataPath, emptyMessage } = element.props;

  return (
    <div>
      {children}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 12,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Data: {dataPath} {emptyMessage && `| Empty: "${emptyMessage}"`}
      </p>
    </div>
  );
}
