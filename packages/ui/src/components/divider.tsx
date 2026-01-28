import { type ComponentRenderProps } from "@json-render/react";

// TODO: extract styling
export function Divider({ element }: ComponentRenderProps) {
  const { orientation } = element.props as { orientation?: string | null };
  if (orientation === "vertical") {
    return (
      <div
        style={{ width: 1, background: "var(--border)", alignSelf: "stretch" }}
      />
    );
  }
  return (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid var(--border)",
        margin: "16px 0",
      }}
    />
  );
}
