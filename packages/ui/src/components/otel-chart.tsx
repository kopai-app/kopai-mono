import { observabilityCatalog } from "../lib/observability-catalog.js";
import type { RendererComponentProps } from "../lib/renderer.js";

type OtelChartProps = RendererComponentProps<
  typeof observabilityCatalog.components.Chart
>;

function LoadingSkeleton({ height }: { height: number }) {
  return (
    <div>
      <div
        style={{
          width: 100,
          height: 14,
          background: "var(--border)",
          borderRadius: 4,
          marginBottom: 16,
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          height,
        }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${30 + Math.random() * 60}%`,
              background: "var(--border)",
              borderRadius: "4px 4px 0 0",
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorDisplay({ error }: { error: Error }) {
  return (
    <div
      style={{
        padding: 16,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        color: "#dc2626",
      }}
    >
      <strong>Error:</strong> {error.message}
    </div>
  );
}

export function OtelChart(props: OtelChartProps) {
  const { type, title, xKey, yKey, height: propHeight } = props.element.props;
  const height = propHeight || 120;

  // Handle dataSource case
  if (props.hasData) {
    if (props.loading) {
      return <LoadingSkeleton height={height} />;
    }
    if (props.error) {
      return <ErrorDisplay error={props.error} />;
    }

    const responseData = props.data as { data?: unknown[] } | null;
    const rawData = responseData?.data ?? [];

    // Extract x and y values using keys
    const getNestedValue = (
      obj: Record<string, unknown>,
      path: string
    ): unknown => {
      return path.split(".").reduce((acc: unknown, key) => {
        if (acc && typeof acc === "object") {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, obj);
    };

    const chartData = rawData.map((item) => ({
      x: String(getNestedValue(item as Record<string, unknown>, xKey) ?? ""),
      y: Number(getNestedValue(item as Record<string, unknown>, yKey) ?? 0),
    }));

    if (chartData.length === 0) {
      return (
        <div>
          {title && (
            <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
              {title}
            </h4>
          )}
          <div
            style={{
              height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
              fontSize: 14,
            }}
          >
            No data available
          </div>
        </div>
      );
    }

    const maxValue = Math.max(...chartData.map((d) => d.y), 1);

    // Render based on chart type
    if (type === "line" || type === "area") {
      const points = chartData.map((d, i) => {
        const x = (i / (chartData.length - 1 || 1)) * 100;
        const y = 100 - (d.y / maxValue) * 100;
        return `${x},${y}`;
      });

      const pathD = `M ${points.join(" L ")}`;
      const areaD =
        type === "area" ? `${pathD} L 100,100 L 0,100 Z` : undefined;

      return (
        <div>
          {title && (
            <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
              {title}
            </h4>
          )}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: "100%", height }}
          >
            {type === "area" && (
              <path d={areaD} fill="var(--foreground)" opacity={0.1} />
            )}
            <path
              d={pathD}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={0.5}
            />
            {chartData.map((d, i) => {
              const x = (i / (chartData.length - 1 || 1)) * 100;
              const y = 100 - (d.y / maxValue) * 100;
              return (
                <circle key={i} cx={x} cy={y} r={1} fill="var(--foreground)" />
              );
            })}
          </svg>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
            }}
          >
            {chartData.slice(0, 5).map((d, i) => (
              <span key={i} style={{ fontSize: 10, color: "var(--muted)" }}>
                {d.x.slice(0, 8)}
              </span>
            ))}
          </div>
        </div>
      );
    }

    // Bar chart (default)
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
            gap: 4,
            alignItems: "flex-end",
            height,
          }}
        >
          {chartData.slice(0, 20).map((d, i) => (
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
                  height: `${(d.y / maxValue) * 100}%`,
                  background: "var(--foreground)",
                  borderRadius: "4px 4px 0 0",
                  minHeight: 4,
                }}
                title={`${d.x}: ${d.y}`}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          {chartData.slice(0, 5).map((d, i) => (
            <span key={i} style={{ fontSize: 10, color: "var(--muted)" }}>
              {d.x.slice(0, 8)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Fallback: no dataSource
  return (
    <div>
      {title && (
        <h4 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 600 }}>
          {title}
        </h4>
      )}
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        No data source configured
      </div>
    </div>
  );
}
