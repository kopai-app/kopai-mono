import { useMemo } from "react";
import type { LogEntry } from "../../types.js";

export interface AttributesTabProps {
  log: LogEntry;
}

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value) || typeof value === "object")
    return JSON.stringify(value, null, 2);
  return String(value);
}

function isComplexValue(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (Array.isArray(value) || Object.keys(value).length > 0)
  );
}

export function AttributesTab({ log }: AttributesTabProps) {
  const sortedAttributes = useMemo(() => {
    return Object.entries(log.attributes).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }, [log.attributes]);

  if (sortedAttributes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No attributes available
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedAttributes.map(([key, value]) => {
        const isComplex = isComplexValue(value);
        const formattedValue = formatAttributeValue(value);
        return (
          <div key={key} className="p-2 rounded bg-muted">
            <div
              className="font-mono font-medium text-xs text-foreground mb-1"
              title={key}
            >
              {key}
            </div>
            <div>
              {isComplex ? (
                <pre className="text-xs text-foreground bg-background p-2 rounded border border-border overflow-x-auto">
                  {formattedValue}
                </pre>
              ) : (
                <span className="text-sm text-foreground break-words">
                  {formattedValue}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
