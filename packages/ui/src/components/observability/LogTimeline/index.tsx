/**
 * LogTimeline - Accepts OtelLogsRow[] and renders log visualization.
 * Transforms denormalized rows to LogEntry[] internally.
 */

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { denormalizedSignals } from "@kopai/core";
import type { LogEntry } from "../types.js";
import { LogRow } from "./LogRow.js";
import { LogDetailPane } from "./LogDetailPane/index.js";
import { LoadingSkeleton } from "../shared/LoadingSkeleton.js";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

const LOG_ROW_HEIGHT = 44;
const OVERSCAN_COUNT = 20;
const DEFAULT_MAX_LOGS = 1000;
const BOTTOM_THRESHOLD_PX = 50;

const VIRTUAL_ROW_STYLE_BASE = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  width: "100%",
};

export interface LogTimelineProps {
  rows: OtelLogsRow[];
  onLogClick?: (log: LogEntry) => void;
  onTraceLinkClick?: (traceId: string, spanId: string) => void;
  selectedLogId?: string;
  isLoading?: boolean;
  error?: Error;
  streaming?: boolean;
  maxLogs?: number;
  totalReceived?: number;
  searchText?: string;
  onPause?: () => void;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function getSeverityText(
  severityNumber: number | undefined,
  severityText: string | undefined
): string {
  if (severityText) return severityText;
  const n = severityNumber ?? 0;
  if (n >= 21) return "FATAL";
  if (n >= 17) return "ERROR";
  if (n >= 13) return "WARN";
  if (n >= 9) return "INFO";
  if (n >= 5) return "DEBUG";
  if (n >= 1) return "TRACE";
  return "UNSPECIFIED";
}

/** Transform OtelLogsRow[] to LogEntry[] */
function buildLogs(rows: OtelLogsRow[]): LogEntry[] {
  return rows
    .map((row) => {
      const timeUnixMs = parseInt(row.Timestamp, 10) / 1e6;
      const body = row.Body ?? "";
      const severityText = getSeverityText(
        row.SeverityNumber,
        row.SeverityText
      );
      const logId = `${row.Timestamp}-${row.ServiceName ?? "unknown"}-${simpleHash(body)}`;

      return {
        logId,
        timeUnixMs,
        body,
        severityText,
        severityNumber: row.SeverityNumber ?? 0,
        serviceName: row.ServiceName ?? "unknown",
        traceId: row.TraceId,
        spanId: row.SpanId,
        attributes: row.LogAttributes ?? {},
        resourceAttributes: row.ResourceAttributes ?? {},
        scopeName: row.ScopeName,
      };
    })
    .sort((a, b) => a.timeUnixMs - b.timeUnixMs);
}

export function LogTimeline({
  rows,
  onLogClick,
  onTraceLinkClick,
  selectedLogId: externalSelectedLogId,
  isLoading,
  error,
  streaming = false,
  maxLogs = DEFAULT_MAX_LOGS,
  totalReceived,
  searchText = "",
  onPause,
}: LogTimelineProps) {
  const [internalSelectedLogId, setInternalSelectedLogId] = useState<
    string | null
  >(null);
  const [isDetailPaneOpen, setIsDetailPaneOpen] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const selectedLogId = externalSelectedLogId ?? internalSelectedLogId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const announcementRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const allLogs = useMemo(() => buildLogs(rows), [rows]);

  const boundedLogs = useMemo(() => {
    if (streaming && allLogs.length > maxLogs)
      return allLogs.slice(allLogs.length - maxLogs);
    return allLogs;
  }, [allLogs, streaming, maxLogs]);

  const selectedLog = useMemo(() => {
    return boundedLogs.find((log) => log.logId === selectedLogId) ?? null;
  }, [boundedLogs, selectedLogId]);

  useEffect(() => {
    if (externalSelectedLogId) setIsDetailPaneOpen(true);
  }, [externalSelectedLogId]);

  const checkIfAtBottom = useCallback(() => {
    if (!scrollRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight <= clientHeight) return true;
    return scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
  }, []);

  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    wasAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, [checkIfAtBottom]);

  useEffect(() => {
    const atBottom = checkIfAtBottom();
    wasAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, [boundedLogs.length, checkIfAtBottom]);

  useEffect(() => {
    if (streaming && wasAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [boundedLogs, streaming]);

  const virtualizer = useVirtualizer({
    count: boundedLogs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LOG_ROW_HEIGHT,
    overscan: OVERSCAN_COUNT,
  });

  const handleLogClick = useCallback(
    (log: LogEntry) => {
      setInternalSelectedLogId(log.logId);
      setIsDetailPaneOpen(true);
      onLogClick?.(log);
      if (announcementRef.current) {
        announcementRef.current.textContent = `Selected log from ${log.serviceName}: ${log.body.slice(0, 100)}`;
      }
    },
    [onLogClick]
  );

  const logClickHandlers = useMemo(() => {
    const handlers = new Map<string, () => void>();
    boundedLogs.forEach((log) => {
      handlers.set(log.logId, () => handleLogClick(log));
    });
    return handlers;
  }, [boundedLogs, handleLogClick]);

  const handleCloseDetailPane = useCallback(() => {
    setIsDetailPaneOpen(false);
    setInternalSelectedLogId(null);
  }, []);

  const handleScrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      wasAtBottomRef.current = true;
      setIsAtBottom(true);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case "ArrowUp": {
          e.preventDefault();
          const idx = boundedLogs.findIndex((l) => l.logId === selectedLogId);
          if (idx > 0) {
            const prev = boundedLogs[idx - 1];
            if (prev) handleLogClick(prev);
          } else if (idx === -1 && boundedLogs.length > 0) {
            const last = boundedLogs[boundedLogs.length - 1];
            if (last) handleLogClick(last);
          }
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const idx = boundedLogs.findIndex((l) => l.logId === selectedLogId);
          if (idx >= 0 && idx < boundedLogs.length - 1) {
            const next = boundedLogs[idx + 1];
            if (next) handleLogClick(next);
          } else if (idx === -1 && boundedLogs.length > 0) {
            const first = boundedLogs[0];
            if (first) handleLogClick(first);
          }
          break;
        }
        case "Escape":
          if (isDetailPaneOpen) {
            e.preventDefault();
            handleCloseDetailPane();
          }
          break;
        case "g":
        case "G":
          e.preventDefault();
          handleScrollToBottom();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    boundedLogs,
    selectedLogId,
    handleLogClick,
    handleCloseDetailPane,
    handleScrollToBottom,
    isDetailPaneOpen,
  ]);

  if (isLoading && !boundedLogs.length) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center p-6">
          <div className="text-red-600 dark:text-red-400 mb-2">
            Failed to load logs
          </div>
          <div className="text-sm text-muted-foreground">{error.message}</div>
        </div>
      </div>
    );
  }

  if (boundedLogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center p-6">
          <div className="text-muted-foreground mb-2">No logs</div>
          <div className="text-sm text-muted-foreground">
            {streaming ? "Waiting for logs..." : "No log data available"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div
        ref={announcementRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-sm font-medium text-muted-foreground">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h7"
                    />
                  </svg>
                  {totalReceived ?? boundedLogs.length}{" "}
                  {(totalReceived ?? boundedLogs.length) === 1 ? "log" : "logs"}
                </div>
                {streaming && (
                  <span className="text-xs text-green-600 dark:text-green-400">
                    LIVE
                  </span>
                )}
              </div>
              {streaming && onPause && (
                <button
                  onClick={onPause}
                  className="px-3 py-1 text-xs font-medium rounded-md text-white"
                  style={{ backgroundColor: "rgb(34 197 94)" }}
                  aria-label="Stop streaming"
                >
                  Stop streaming
                </button>
              )}
            </div>
          </div>

          {/* Virtual Scroll */}
          <div className="flex-1 relative">
            <div
              ref={scrollRef}
              className="absolute inset-0 overflow-auto"
              onScroll={handleScroll}
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: "100%",
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const log = boundedLogs[virtualRow.index];
                  if (!log) return null;
                  return (
                    <div
                      key={virtualRow.index}
                      style={{
                        ...VIRTUAL_ROW_STYLE_BASE,
                        height: LOG_ROW_HEIGHT,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <LogRow
                        log={log}
                        isSelected={log.logId === selectedLogId}
                        onClick={logClickHandlers.get(log.logId)!}
                        searchText={searchText}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {!isAtBottom && (
              <button
                onClick={handleScrollToBottom}
                className="absolute bottom-4 right-4 px-3 py-1.5 text-xs font-medium rounded-md bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg transition-colors z-10"
                aria-label="Scroll to bottom"
              >
                <span className="flex items-center gap-1">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3 h-3"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Scroll to bottom
                </span>
              </button>
            )}
          </div>
        </div>

        {isDetailPaneOpen && selectedLog && (
          <LogDetailPane
            log={selectedLog}
            onClose={handleCloseDetailPane}
            onTraceLinkClick={onTraceLinkClick}
          />
        )}
      </div>
    </div>
  );
}
