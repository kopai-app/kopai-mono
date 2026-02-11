import { memo, useMemo } from "react";
import type { LogEntry } from "../types.js";
import { getServiceColor } from "../utils/colors.js";

export interface LogRowProps {
  log: LogEntry;
  isSelected: boolean;
  onClick: () => void;
  searchText?: string;
  relativeTime?: boolean;
  referenceTimeMs?: number;
}

function formatTimestamp(timeMs: number): string {
  const date = new Date(timeMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function formatRelativeTime(timeMs: number, referenceMs: number): string {
  const diffMs = timeMs - referenceMs;
  const sign = diffMs >= 0 ? "+" : "-";
  const abs = Math.abs(diffMs);
  if (abs < 1000) return `${sign}${abs.toFixed(4)}ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(4)}s`;
  const mins = Math.floor(abs / 60_000);
  const secs = ((abs % 60_000) / 1000).toFixed(4);
  return `${sign}${mins}m${secs}s`;
}

function truncateMessage(message: string, maxLength = 120): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "...";
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
  if (s === "TRACE")
    return {
      text: "text-gray-700 dark:text-gray-300",
      bg: "bg-gray-50 dark:bg-gray-800/30",
    };
  return {
    text: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-50 dark:bg-gray-800/20",
  };
}

function highlightSearchText(
  text: string,
  searchText: string
): React.ReactNode {
  if (!searchText || !text) return text;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const searchLower = searchText.toLowerCase();
  const textLower = text.toLowerCase();
  let index = textLower.indexOf(searchLower);

  while (index !== -1) {
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const matchText = text.slice(index, index + searchText.length);
    parts.push(
      <mark
        key={`${index}-${matchText}`}
        className="bg-yellow-200 dark:bg-yellow-700 text-foreground"
      >
        {matchText}
      </mark>
    );
    lastIndex = index + searchText.length;
    index = textLower.indexOf(searchLower, lastIndex);
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? <>{parts}</> : text;
}

export const LogRow = memo(function LogRow({
  log,
  isSelected,
  onClick,
  searchText,
  relativeTime,
  referenceTimeMs,
}: LogRowProps) {
  const severityColor = getSeverityColor(log.severityText);
  const message = useMemo(() => log.body || "", [log.body]);
  const timestamp =
    relativeTime && referenceTimeMs != null
      ? formatRelativeTime(log.timeUnixMs, referenceTimeMs)
      : formatTimestamp(log.timeUnixMs);
  const lineCount = message.split("\n").length;
  const hasMultipleLines = lineCount > 1;

  return (
    <div
      style={{ contain: "layout style paint" }}
      className={`flex items-center gap-3 px-4 h-[44px] border-b border-border cursor-pointer overflow-hidden outline-none ${
        isSelected
          ? "bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500"
          : "hover:bg-muted"
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex-shrink-0 w-28 font-mono text-xs text-muted-foreground">
        {timestamp}
      </div>
      <div
        className={`flex-shrink-0 w-24 text-xs font-semibold px-2 py-0.5 rounded truncate ${severityColor.bg} ${severityColor.text}`}
      >
        {log.severityText}
      </div>
      <div
        className="flex-shrink-0 w-32 text-xs truncate"
        style={{ color: getServiceColor(log.serviceName) }}
      >
        {log.serviceName}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <div className="text-sm text-foreground truncate">
          {searchText
            ? highlightSearchText(
                truncateMessage(message.split("\n")[0] || "", 100),
                searchText
              )
            : truncateMessage(message.split("\n")[0] || "", 100)}
        </div>
        {hasMultipleLines && (
          <span className="flex-shrink-0 text-xs text-muted-foreground">
            +{lineCount - 1} lines
          </span>
        )}
        {log.traceId && (
          <span className="flex-shrink-0 text-xs text-indigo-600 dark:text-indigo-400">
            trace: {log.traceId.slice(0, 16)}...
          </span>
        )}
      </div>
    </div>
  );
});
