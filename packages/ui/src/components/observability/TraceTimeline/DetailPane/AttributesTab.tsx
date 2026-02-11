import { useMemo } from "react";
import type { SpanNode } from "../../types.js";
import {
  formatAttributeValue,
  isComplexValue,
} from "../../utils/attributes.js";

export interface AttributesTabProps {
  span: SpanNode;
}

const HTTP_SEMANTIC_CONVENTIONS = new Set([
  "http.method",
  "http.url",
  "http.status_code",
  "http.target",
  "http.host",
  "http.scheme",
  "http.route",
  "http.user_agent",
  "http.request_content_length",
  "http.response_content_length",
]);

export function AttributesTab({ span }: AttributesTabProps) {
  const { httpAttributes, otherAttributes, resourceAttributes } =
    useMemo(() => {
      const http: Array<[string, unknown]> = [];
      const other: Array<[string, unknown]> = [];
      const resource: Array<[string, unknown]> = [];

      if (span.attributes) {
        Object.entries(span.attributes).forEach(([key, value]) => {
          if (HTTP_SEMANTIC_CONVENTIONS.has(key)) {
            http.push([key, value]);
          } else {
            other.push([key, value]);
          }
        });
      }

      if (span.resourceAttributes) {
        Object.entries(span.resourceAttributes).forEach(([key, value]) => {
          resource.push([key, value]);
        });
      }

      http.sort(([a], [b]) => a.localeCompare(b));
      other.sort(([a], [b]) => a.localeCompare(b));
      resource.sort(([a], [b]) => a.localeCompare(b));

      return {
        httpAttributes: http,
        otherAttributes: other,
        resourceAttributes: resource,
      };
    }, [span]);

  const hasAttributes =
    httpAttributes.length > 0 ||
    otherAttributes.length > 0 ||
    resourceAttributes.length > 0;

  if (!hasAttributes) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No attributes available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {httpAttributes.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center">
            <span className="w-2 h-2 bg-blue-500 rounded-full mr-2" />
            HTTP Attributes
          </h3>
          <div className="space-y-2">
            {httpAttributes.map(([key, value]) => (
              <AttributeRow key={key} attrKey={key} value={value} highlighted />
            ))}
          </div>
        </section>
      )}

      {otherAttributes.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Span Attributes
          </h3>
          <div className="space-y-2">
            {otherAttributes.map(([key, value]) => (
              <AttributeRow key={key} attrKey={key} value={value} />
            ))}
          </div>
        </section>
      )}

      {resourceAttributes.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Resource Attributes
          </h3>
          <div className="space-y-2">
            {resourceAttributes.map(([key, value]) => (
              <AttributeRow key={key} attrKey={key} value={value} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface AttributeRowProps {
  attrKey: string;
  value: unknown;
  highlighted?: boolean;
}

function AttributeRow({ attrKey, value, highlighted }: AttributeRowProps) {
  const isComplex = isComplexValue(value);
  const formattedValue = formatAttributeValue(value);

  return (
    <div
      className={`grid grid-cols-[minmax(150px,1fr)_2fr] gap-4 p-2 rounded text-sm ${
        highlighted
          ? "bg-blue-50 dark:bg-blue-950 border-l-2 border-blue-500"
          : "bg-muted"
      }`}
    >
      <div
        className={`font-mono font-medium break-words ${highlighted ? "text-blue-700 dark:text-blue-300" : "text-foreground"}`}
        title={attrKey}
      >
        {attrKey}
      </div>
      <div className="break-words">
        {isComplex ? (
          <pre className="text-xs text-foreground bg-background p-2 rounded border border-border overflow-x-auto">
            {formattedValue}
          </pre>
        ) : (
          <span className="text-foreground">{formattedValue}</span>
        )}
      </div>
    </div>
  );
}
