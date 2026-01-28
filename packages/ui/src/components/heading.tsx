import React from "react";
import { type ComponentRenderProps } from "@json-render/react";

export function Heading({ element }: ComponentRenderProps) {
  const { text, level } = element.props as {
    text: string;
    level?: string | null;
  };
  const Tag = (level || "h2") as keyof React.JSX.IntrinsicElements;
  const sizes: Record<string, string> = {
    h1: "28px",
    h2: "24px",
    h3: "20px",
    h4: "16px",
  };
  return (
    <Tag
      style={{
        margin: "0 0 16px",
        fontSize: sizes[level || "h2"],
        fontWeight: 600,
      }}
    >
      {text}
    </Tag>
  );
}
