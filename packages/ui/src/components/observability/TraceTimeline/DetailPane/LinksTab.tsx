import { useState } from "react";
import type { SpanNode } from "../../types.js";
import { formatAttributeValue } from "../../utils/attributes.js";

export interface LinksTabProps {
  span: SpanNode;
  onLinkClick?: (traceId: string, spanId: string) => void;
}

function truncateId(id: string): string {
  return id.length > 8 ? `${id.substring(0, 8)}...` : id;
}

export function LinksTab({ span, onLinkClick }: LinksTabProps) {
  const [expandedLinks, setExpandedLinks] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleLinkExpanded = (index: number) => {
    setExpandedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const copyToClipboard = async (text: string, type: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(`${type}-${index}-${text}`);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!span.links || span.links.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No links available
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {span.links.map((link, index) => {
        const isExpanded = expandedLinks.has(index);
        const hasAttributes =
          link.attributes && Object.keys(link.attributes).length > 0;

        return (
          <div
            key={index}
            className="border border-border rounded-lg overflow-hidden"
          >
            <div className="bg-muted p-3">
              <div className="mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Trace ID
                </div>
                <div className="flex items-center gap-2">
                  <code
                    className="text-xs font-mono text-foreground bg-background px-2 py-1 rounded border border-border flex-1 truncate"
                    title={link.traceId}
                  >
                    {truncateId(link.traceId)}
                  </code>
                  <button
                    onClick={() =>
                      copyToClipboard(link.traceId, "trace", index)
                    }
                    className="p-1 hover:bg-muted/80 rounded transition-colors"
                    aria-label="Copy trace ID"
                  >
                    <svg
                      className={`w-4 h-4 ${copiedId === `trace-${index}-${link.traceId}` ? "text-green-600" : "text-muted-foreground"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {copiedId === `trace-${index}-${link.traceId}` ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mb-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">
                  Span ID
                </div>
                <div className="flex items-center gap-2">
                  <code
                    className="text-xs font-mono text-foreground bg-background px-2 py-1 rounded border border-border flex-1 truncate"
                    title={link.spanId}
                  >
                    {truncateId(link.spanId)}
                  </code>
                  <button
                    onClick={() => copyToClipboard(link.spanId, "span", index)}
                    className="p-1 hover:bg-muted/80 rounded transition-colors"
                    aria-label="Copy span ID"
                  >
                    <svg
                      className={`w-4 h-4 ${copiedId === `span-${index}-${link.spanId}` ? "text-green-600" : "text-muted-foreground"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      {copiedId === `span-${index}-${link.spanId}` ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {onLinkClick && (
                <button
                  onClick={() => onLinkClick(link.traceId, link.spanId)}
                  className="w-full mt-2 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors"
                >
                  Navigate to Span
                </button>
              )}

              {hasAttributes && (
                <button
                  onClick={() => toggleLinkExpanded(index)}
                  className="w-full mt-2 px-3 py-1.5 text-xs text-foreground bg-background border border-border rounded hover:bg-muted transition-colors flex items-center justify-center gap-1"
                  aria-expanded={isExpanded}
                >
                  <span>
                    {isExpanded ? "Hide" : "Show"} Attributes (
                    {Object.keys(link.attributes).length})
                  </span>
                  <svg
                    className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
              )}
            </div>

            {hasAttributes && isExpanded && (
              <div className="p-3 bg-background border-t border-border">
                <div className="space-y-2">
                  {Object.entries(link.attributes).map(([key, value]) => (
                    <div
                      key={key}
                      className="grid grid-cols-[minmax(100px,1fr)_2fr] gap-3 text-xs"
                    >
                      <div className="font-mono font-medium text-foreground break-words">
                        {key}
                      </div>
                      <div className="text-foreground break-words">
                        {typeof value === "object" ? (
                          <pre className="text-xs bg-muted p-2 rounded border border-border overflow-x-auto">
                            {formatAttributeValue(value)}
                          </pre>
                        ) : (
                          <span>{formatAttributeValue(value)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
