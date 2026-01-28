import { type ComponentRenderProps } from "@json-render/react";
import { useData } from "@json-render/react";
import { getByPath } from "@json-render/core";

// TODO: extract styling
export function Chart({ element }: ComponentRenderProps) {
  const { title, dataPath } = element.props as {
    title?: string | null;
    dataPath: string;
  };
  const { data } = useData();
  const chartData = getByPath(data, dataPath) as
    | Array<{ label: string; value: number }>
    | undefined;

  if (!chartData || !Array.isArray(chartData)) {
    return <div style={{ padding: 20, color: "var(--muted)" }}>No data</div>;
  }

  const maxValue = Math.max(...chartData.map((d) => d.value));

  return (
    <div>
      {title && (
        <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
          {title}
        </h4>
      )}
      <div
        style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}
      >
        {chartData.map((d, i) => (
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
                background: "var(--foreground)",
                borderRadius: "4px 4px 0 0",
                minHeight: 4,
              }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
