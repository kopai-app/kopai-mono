import { type ComponentRenderProps } from "@json-render/react";
import { useData } from "@json-render/react";
import { getByPath } from "@json-render/core";

export function DatePicker({ element }: ComponentRenderProps) {
  const { label, valuePath } = element.props as {
    label: string;
    valuePath: string;
  };
  const { data, set } = useData();
  const value = getByPath(data, valuePath) as string | undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 14, fontWeight: 500 }}>{label}</label>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => set(valuePath, e.target.value)}
        style={{
          padding: "8px 12px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
          fontSize: 16,
          outline: "none",
        }}
      />
    </div>
  );
}
