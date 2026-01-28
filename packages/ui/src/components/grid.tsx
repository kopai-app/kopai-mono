import { type ComponentRenderProps } from "@json-render/react";

export function Grid({ element, children }: ComponentRenderProps) {
  const { columns, gap } = element.props as {
    columns?: number | null;
    gap?: string | null;
  };
  const gaps: Record<string, string> = {
    none: "0",
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
