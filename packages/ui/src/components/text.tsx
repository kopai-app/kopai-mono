import { type ComponentRenderProps } from "@json-render/react";

export function Text({ element }: ComponentRenderProps) {
  const { content, variant } = element.props as {
    content: string;
    variant?: string | null;
  };
  const colors: Record<string, string> = {
    default: "var(--foreground)",
    muted: "var(--muted)",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
  };
  return (
    <p style={{ margin: 0, color: colors[variant || "default"] }}>{content}</p>
  );
}
