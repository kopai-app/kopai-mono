import { type ComponentRenderProps } from "@json-render/react";
import { useData } from "@json-render/react";
import { getByPath } from "@json-render/core";

function useResolvedValue<T>(
  value: T | { path: string } | null | undefined
): T | undefined {
  const { data } = useData();
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object" && "path" in value) {
    return getByPath(data, value.path) as T | undefined;
  }
  return value as T;
}

export function Badge({ element }: ComponentRenderProps) {
  const { text, variant } = element.props as {
    text: string | { path: string };
    variant?: string | null;
  };
  const resolvedText = useResolvedValue(text);

  const colors: Record<string, string> = {
    default: "var(--foreground)",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
    info: "var(--muted)",
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        background: "var(--border)",
        color: colors[variant || "default"],
      }}
    >
      {resolvedText}
    </span>
  );
}
