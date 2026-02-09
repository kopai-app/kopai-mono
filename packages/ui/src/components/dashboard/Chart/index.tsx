import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function Chart({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Chart>) {
  const { type, dataPath, title, height } = element.props;

  // Static mock data for example page
  const mockData = [
    { label: "Mon", value: 40 },
    { label: "Tue", value: 65 },
    { label: "Wed", value: 45 },
    { label: "Thu", value: 80 },
    { label: "Fri", value: 55 },
  ];

  const maxValue = Math.max(...mockData.map((d) => d.value));

  return (
    <div>
      {title && (
        <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
          {title}
        </h4>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          height: height || 120,
        }}
      >
        {mockData.map((d, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            <div
              style={{
                width: "100%",
                height: `${(d.value / maxValue) * 100}%`,
                background: "hsl(var(--foreground))",
                borderRadius: "4px 4px 0 0",
                minHeight: 4,
              }}
            />
            <span
              style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 12,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        Type: {type} | Data: {dataPath}
      </p>
    </div>
  );
}
