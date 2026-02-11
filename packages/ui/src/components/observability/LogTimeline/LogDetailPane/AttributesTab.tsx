import { useMemo } from "react";
import type { LogEntry } from "../../types.js";
import {
  formatAttributeValue,
  isComplexValue,
} from "../../utils/attributes.js";

export interface AttributesTabProps {
  log: LogEntry;
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
