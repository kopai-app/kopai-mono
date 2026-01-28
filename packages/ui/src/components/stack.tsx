import { type ComponentRenderProps } from "@json-render/react";

export function Stack({ element, children }: ComponentRenderProps) {
  const { direction, gap, align } = element.props as {
    direction?: string | null;
    gap?: string | null;
    align?: string | null;
  };
  const gaps: Record<string, string> = {
    none: "0",
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
