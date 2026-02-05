import React from "react";
import { dashboardCatalog } from "../lib/catalog.js";
import type { CatalogueComponentProps } from "../lib/simple-component-catalog.js";

export function Heading({
  element,
}: CatalogueComponentProps<typeof dashboardCatalog.components.Heading>) {
  const { text, level } = element.props;
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
