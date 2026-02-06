import { memo } from "react";
import type { SpanNode } from "../types.js";
import { TimelineBar } from "./TimelineBar.js";
import { formatDuration } from "../utils/time.js";

export interface SpanRowProps {
  span: SpanNode;
  level: number;
  isCollapsed: boolean;
  isSelected: boolean;
  isHovered?: boolean;
  isParentOfHovered?: boolean;
  relativeStart: number;
  relativeDuration: number;
  onClick: () => void;
  onToggleCollapse: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

function getHttpContext(span: SpanNode): string | null {
  const attrs = span.attributes;
  const method = attrs["http.method"];
  const url = attrs["http.url"] || attrs["http.target"];
  const statusCode = attrs["http.status_code"];

  if (!method && !url) return null;

  const parts: string[] = [];
  if (method) parts.push(String(method));
  if (url) parts.push(String(url));
  if (statusCode) parts.push(`[${statusCode}]`);

  return parts.join(" ");
}

export const SpanRow = memo(function SpanRow({
  span,
  level,
  isCollapsed,
  isSelected,
  isParentOfHovered = false,
  relativeStart,
  relativeDuration,
  onClick,
  onToggleCollapse,
  onMouseEnter,
  onMouseLeave,
}: SpanRowProps) {
  const hasChildren = span.children.length > 0;
  const isError = span.status === "ERROR";
  const httpContext = getHttpContext(span);

  return (
    <div
      className={`flex h-8 border-b border-border hover:bg-muted cursor-pointer ${
        isSelected
          ? "bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          : ""
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="treeitem"
      aria-expanded={hasChildren ? !isCollapsed : undefined}
      aria-selected={isSelected}
      aria-label={`${span.name}, ${span.serviceName}, ${formatDuration(span.durationMs)}${isError ? ", error" : ""}`}
      aria-level={level + 1}
    >
      {/* Left side: Service name + span name with indentation */}
      <div className="flex items-center min-w-0 flex-shrink-0 w-96 px-2">
        {Array.from({ length: level }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-full border-l flex-shrink-0 ${
              isParentOfHovered ? "border-blue-500 border-l-2" : "border-border"
            }`}
          />
        ))}

        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? (
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            ) : (
              <svg
                className="w-3 h-3"
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
            )}
          </button>
        ) : (
          <div className="w-4 flex-shrink-0" />
        )}

        {isError && (
          <svg
            className="w-4 h-4 text-red-500 flex-shrink-0 mr-1"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        )}

        <span className="text-xs text-muted-foreground flex-shrink-0 mr-2">
          {span.serviceName}
        </span>

        <span className="text-sm font-medium truncate flex-1 min-w-0 text-foreground">
          {span.name}
        </span>

        {hasChildren && (
          <span className="text-xs text-muted-foreground flex-shrink-0 ml-1">
            ({span.children.length})
          </span>
        )}

        {httpContext && (
          <span className="text-xs text-muted-foreground truncate ml-2 flex-shrink-0 max-w-xs">
            {httpContext}
          </span>
        )}

        <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
          {formatDuration(span.durationMs)}
        </span>
      </div>

      {/* Right side: Timeline bar */}
      <div className="flex-1 min-w-0 px-2">
        <TimelineBar
          span={span}
          relativeStart={relativeStart}
          relativeDuration={relativeDuration}
        />
      </div>
    </div>
  );
});
