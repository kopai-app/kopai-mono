import { type ComponentRenderProps } from "@json-render/react";

export function Empty({ element }: ComponentRenderProps) {
  const { title, description } = element.props as {
    title: string;
    description?: string | null;
  };

  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>
        {title}
      </h3>
      {description && (
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
          {description}
        </p>
      )}
    </div>
  );
}
