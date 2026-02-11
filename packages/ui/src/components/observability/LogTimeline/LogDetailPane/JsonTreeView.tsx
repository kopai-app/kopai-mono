import { useState } from "react";

export interface JsonTreeViewProps {
  data: Record<string, unknown> | unknown[];
  level?: number;
}

export function JsonTreeView({ data, level = 0 }: JsonTreeViewProps) {
  return (
    <div className="font-mono text-sm">
      {Array.isArray(data) ? (
        <ArrayView items={data} level={level} />
      ) : (
        <ObjectView obj={data} level={level} />
      )}
    </div>
  );
}

function ObjectView({
  obj,
  level,
}: {
  obj: Record<string, unknown>;
  level: number;
}) {
  const entries = Object.entries(obj);
  if (entries.length === 0)
    return <span className="text-muted-foreground">{"{}"}</span>;
  return (
    <div>
      {entries.map(([key, value]) => (
        <JsonTreeNode key={key} objKey={key} value={value} level={level} />
      ))}
    </div>
  );
}

function ArrayView({ items, level }: { items: unknown[]; level: number }) {
  if (items.length === 0)
    return <span className="text-muted-foreground">[]</span>;
  return (
    <div>
      {items.map((item, index) => (
        <JsonTreeNode
          key={index}
          objKey={String(index)}
          value={item}
          level={level}
          isArrayItem
        />
      ))}
    </div>
  );
}

function JsonTreeNode({
  objKey,
  value,
  level,
  isArrayItem = false,
}: {
  objKey: string;
  value: unknown;
  level: number;
  isArrayItem?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(level < 2);

  const isExpandable =
    value !== null &&
    typeof value === "object" &&
    (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);

  const indent = level * 16;

  if (!isExpandable) {
    return (
      <div
        style={{ paddingLeft: `${indent}px` }}
        className="py-0.5 hover:bg-muted"
      >
        {!isArrayItem && (
          <span className="text-blue-600 dark:text-blue-400">
            {objKey}
            {": "}
          </span>
        )}
        <span className="text-foreground">{formatPrimitiveValue(value)}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{ paddingLeft: `${indent}px` }}
        className="py-0.5 hover:bg-muted cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="inline-block w-4 text-muted-foreground">
          {isExpanded ? "▼" : "▶"}
        </span>
        {!isArrayItem && (
          <span className="text-blue-600 dark:text-blue-400">
            {objKey}
            {": "}
          </span>
        )}
        <span className="text-muted-foreground">
          {Array.isArray(value)
            ? `Array(${value.length})`
            : `Object(${Object.keys(value).length})`}
        </span>
      </div>
      {isExpanded && (
        <div>
          {Array.isArray(value) ? (
            <ArrayView items={value} level={level + 1} />
          ) : (
            <ObjectView
              obj={value as Record<string, unknown>}
              level={level + 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}
