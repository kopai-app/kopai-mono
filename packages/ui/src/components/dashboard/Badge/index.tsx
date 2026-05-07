import { observabilityCatalog } from "@kopai/ui-core";
import type { CatalogueComponentProps } from "@kopai/ui-core";

export function Badge({
  element,
}: CatalogueComponentProps<typeof observabilityCatalog.components.Badge>) {
  const { text, variant } = element.props;

  const colors: Record<string, string> = {
    default: "hsl(var(--foreground))",
    success: "#22c55e",
    warning: "#eab308",
    danger: "#ef4444",
    info: "hsl(var(--muted-foreground))",
  };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        background: "hsl(var(--border))",
        color: colors[variant || "default"],
      }}
    >
      {text}
    </span>
  );
}
