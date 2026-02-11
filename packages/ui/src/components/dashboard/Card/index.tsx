import { dashboardCatalog } from "../../../lib/catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";

export function Card({
  element,
  children,
}: RendererComponentProps<typeof dashboardCatalog.components.Card>) {
  const { title, description, padding } = element.props as {
    title?: string | null;
    description?: string | null;
    padding?: string | null;
  };

  const paddings: Record<string, string> = {
    sm: "12px",
    md: "16px",
    lg: "24px",
  };

  return (
    <div
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--radius)",
      }}
    >
      {(title || description) && (
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid hsl(var(--border))",
          }}
        >
          {title && (
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {title}
            </h3>
          )}
          {description && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 14,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      <div style={{ padding: paddings[padding || ""] || "16px" }}>
        {children}
      </div>
    </div>
  );
}
