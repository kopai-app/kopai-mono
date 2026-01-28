import { type ComponentRenderProps } from "@json-render/react";
import { useData } from "@json-render/react";
import { getByPath } from "@json-render/core";

export function List({ element, children }: ComponentRenderProps) {
  const { dataPath } = element.props as { dataPath: string };
  const { data } = useData();
  const listData = getByPath(data, dataPath) as Array<unknown> | undefined;

  if (!listData || !Array.isArray(listData)) {
    return <div style={{ color: "var(--muted)" }}>No items</div>;
  }

  return <div>{children}</div>;
}
