import { useState, useCallback, useRef, useEffect } from "react";
import type { LogEntry } from "../../types.js";
import { AttributesTab } from "./AttributesTab.js";
import { JsonTreeView } from "./JsonTreeView.js";

export interface LogDetailPaneProps {
  log: LogEntry;
  onClose: () => void;
  onTraceLinkClick?: (traceId: string, spanId: string) => void;
  initialTab?: "message" | "attributes" | "resource" | "context";
}

type TabType = "message" | "attributes" | "resource" | "context";

export function LogDetailPane({
  log,
  onClose,
  onTraceLinkClick,
  initialTab = "message",
}: LogDetailPaneProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [copiedId, setCopiedId] = useState(false);
  const detailPaneRef = useRef<HTMLDivElement>(null);

  const handleCopyLogId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(log.logId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (err) {
      console.error("Failed to copy log ID:", err);
    }
  }, [log.logId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    detailPaneRef.current?.focus();
  }, []);

  const severityColor = getSeverityColor(log.severityText);

  return (
    <div
      ref={detailPaneRef}
      className="w-[500px] flex flex-col h-full bg-background border-l border-border"
      onKeyDown={handleKeyDown}
      role="complementary"
      aria-label="Log details"
      tabIndex={-1}
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">Log Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded transition-colors"
            aria-label="Close detail pane"
          >
            <svg
              className="w-6 h-6 text-muted-foreground"
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
        <div className="flex items-center gap-2 mb-2">
          <div
            className={`text-xs font-semibold px-2 py-0.5 rounded ${severityColor.bg} ${severityColor.text}`}
          >
            {log.severityText}
          </div>
          <div className="text-sm text-muted-foreground">{log.serviceName}</div>
        </div>
        <div className="text-xs font-medium text-muted-foreground mt-3 mb-1">
          Timestamp
        </div>
        <div className="text-xs text-foreground font-mono">
          {new Date(log.timeUnixMs).toISOString()}
        </div>
        <div className="text-xs font-medium text-muted-foreground mt-3 mb-1">
          Log ID
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLogId}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono bg-muted px-2 py-1 rounded"
            title="Click to copy log ID"
          >
            <span className="truncate max-w-[200px]">{log.logId}</span>
            <svg
              className="w-3 h-3 flex-shrink-0"
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
      <div className="flex border-b border-border">
        {(
          [
            "message",
            "attributes",
            "resource",
            ...(log.traceId ? ["context" as const] : []),
          ] as TabType[]
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "context"
              ? "Trace"
              : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "message" && (
          <pre className="text-sm text-foreground whitespace-pre-wrap break-words font-mono bg-muted p-3 rounded">
            {log.body || "No message body"}
          </pre>
        )}
        {activeTab === "attributes" && <AttributesTab log={log} />}
        {activeTab === "resource" && (
          <div>
            <div className="mb-3">
              <div className="text-sm font-semibold text-foreground mb-2">
                Service Name
              </div>
              <div className="text-sm text-foreground bg-muted p-2 rounded font-mono">
                {log.serviceName}
              </div>
            </div>
            {log.scopeName && (
              <div className="mb-3">
                <div className="text-sm font-semibold text-foreground mb-2">
                  Scope Name
                </div>
                <div className="text-sm text-foreground bg-muted p-2 rounded font-mono">
                  {log.scopeName}
                </div>
              </div>
            )}
            <div>
              <div className="text-sm font-semibold text-foreground mb-2">
                Resource Attributes
              </div>
              {Object.keys(log.resourceAttributes).length > 0 ? (
                <JsonTreeView data={log.resourceAttributes} />
              ) : (
                <div className="text-sm text-muted-foreground text-center py-4">
                  No resource attributes
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === "context" && log.traceId && (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-foreground mb-2">
                Trace ID
              </div>
              <div className="text-sm text-foreground bg-muted p-2 rounded font-mono break-all">
                {log.traceId}
              </div>
            </div>
            {log.spanId && (
              <div>
                <div className="text-sm font-semibold text-foreground mb-2">
                  Span ID
                </div>
                <div className="text-sm text-foreground bg-muted p-2 rounded font-mono break-all">
                  {log.spanId}
                </div>
              </div>
            )}
            {onTraceLinkClick && log.spanId && (
              <button
                onClick={() => onTraceLinkClick(log.traceId!, log.spanId!)}
                className="w-full px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm"
              >
                View Trace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getSeverityColor(severity: string): { text: string; bg: string } {
  const s = severity.toUpperCase();
  if (s === "FATAL" || s === "ERROR")
    return {
      text: "text-red-900 dark:text-red-100",
      bg: "bg-red-100 dark:bg-red-900/30",
    };
  if (s === "WARN" || s === "WARNING")
    return {
      text: "text-orange-900 dark:text-orange-100",
      bg: "bg-orange-100 dark:bg-orange-900/30",
    };
  if (s === "INFO")
    return {
      text: "text-blue-900 dark:text-blue-100",
      bg: "bg-blue-100 dark:bg-blue-900/30",
    };
  if (s === "DEBUG")
    return {
      text: "text-gray-900 dark:text-gray-100",
      bg: "bg-gray-100 dark:bg-gray-700/30",
    };
  return {
    text: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-50 dark:bg-gray-800/20",
  };
}
