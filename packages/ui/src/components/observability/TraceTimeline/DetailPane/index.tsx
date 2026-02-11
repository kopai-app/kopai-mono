import { useState, useCallback } from "react";
import type { SpanNode } from "../../types.js";
import { AttributesTab } from "./AttributesTab.js";
import { EventsTab } from "./EventsTab.js";
import { LinksTab } from "./LinksTab.js";

export interface DetailPaneProps {
  span: SpanNode;
  onClose: () => void;
  onLinkClick?: (traceId: string, spanId: string) => void;
  initialTab?: "attributes" | "events" | "links";
}

type TabType = "attributes" | "events" | "links";

export function DetailPane({
  span,
  onClose,
  onLinkClick,
  initialTab = "attributes",
}: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [copiedId, setCopiedId] = useState(false);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  const handleCopySpanId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(span.spanId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (err) {
      console.error("Failed to copy span ID:", err);
    }
  }, [span.spanId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return (
    <div
      className="flex flex-col h-full bg-background border-l border-border"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="complementary"
      aria-label="Span details"
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground truncate">
            Span Details
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
            aria-label="Close detail pane"
            title="Close (Esc)"
          >
            <svg
              className="w-5 h-5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="mb-2">
          <div
            className="text-sm font-medium text-foreground truncate"
            title={span.name}
          >
            {span.name}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Span ID:</span>
          <code
            className="text-xs font-mono text-foreground bg-muted px-2 py-1 rounded flex-1 truncate"
            title={span.spanId}
          >
            {span.spanId}
          </code>
          <button
            onClick={handleCopySpanId}
            className="p-1 hover:bg-muted rounded transition-colors"
            aria-label="Copy span ID"
          >
            <svg
              className={`w-4 h-4 ${copiedId ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {copiedId ? (
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

      {/* Tabs */}
      <div
        className="flex border-b border-border"
        role="tablist"
        aria-label="Span detail tabs"
      >
        {(["attributes", "events", "links"] as const).map((tab) => {
          const count =
            tab === "attributes"
              ? Object.keys(span.attributes).length
              : tab === "events"
                ? span.events.length
                : span.links.length;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => handleTabChange(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {count > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "attributes" && <AttributesTab span={span} />}
        {activeTab === "events" && <EventsTab span={span} />}
        {activeTab === "links" && (
          <LinksTab span={span} onLinkClick={onLinkClick} />
        )}
      </div>
    </div>
  );
}
