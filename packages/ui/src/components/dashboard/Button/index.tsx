import { dashboardCatalog } from "../../../lib/catalog.js";
import type { CatalogueComponentProps } from "../../../lib/component-catalog.js";

export function Button({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Button>) {
  const { label, variant, size, action, disabled } = element.props;

  const variants: Record<
    string,
    { bg: string; color: string; border: string }
  > = {
    primary: {
      bg: "hsl(var(--foreground))",
      color: "hsl(var(--background))",
      border: "hsl(var(--foreground))",
    },
    secondary: {
      bg: "hsl(var(--card))",
      color: "hsl(var(--foreground))",
      border: "hsl(var(--border))",
    },
    danger: {
      bg: "#ef4444",
      color: "white",
      border: "#ef4444",
    },
    ghost: {
      bg: "transparent",
      color: "hsl(var(--foreground))",
      border: "transparent",
    },
  };

  const sizes: Record<string, { padding: string; fontSize: number }> = {
    sm: { padding: "6px 12px", fontSize: 12 },
    md: { padding: "8px 16px", fontSize: 14 },
    lg: { padding: "12px 24px", fontSize: 16 },
  };

  const v = variants[variant || "primary"] ?? variants["primary"]!;
  const s = sizes[size || "md"] ?? sizes["md"]!;

  return (
    <button
      disabled={disabled || false}
      onClick={() => console.log("Action:", action)}
      style={{
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 500,
        borderRadius: "var(--radius)",
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
