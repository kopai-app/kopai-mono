/**
 * TraceTimeline - Accepts OtelTracesRow[] and renders trace visualization.
 * Transforms denormalized rows to SpanNode tree internally.
 */

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { denormalizedSignals } from "@kopai/core";
type OtelTracesRow = denormalizedSignals.OtelTracesRow;
import type { SpanNode, ParsedTrace } from "../types.js";
import { flattenTree, getAllSpanIds } from "../utils/flatten-tree.js";
import {
  calculateRelativeTime,
  calculateRelativeDuration,
  formatDuration,
} from "../utils/time.js";
import { TraceHeader } from "./TraceHeader.js";
import { SpanRow } from "./SpanRow.js";
import { DetailPane } from "./DetailPane/index.js";
import { LoadingSkeleton } from "../shared/LoadingSkeleton.js";
import { useRegisterShortcuts } from "../../KeyboardShortcuts/index.js";
import { TRACE_VIEWER_SHORTCUTS } from "./shortcuts.js";

export interface TraceTimelineProps {
  rows: OtelTracesRow[];
  onSpanClick?: (span: SpanNode) => void;
  selectedSpanId?: string;
  isLoading?: boolean;
  error?: Error;
}

/** Transform OtelTracesRow[] to ParsedTrace */
function buildTrace(rows: OtelTracesRow[]): ParsedTrace | null {
  if (rows.length === 0) return null;

  // Pass 1: Build SpanNode lookup + trace bounds
  const spanById = new Map<string, SpanNode>();
  let minTimeMs = Infinity;
  let maxTimeMs = -Infinity;
  let traceId = "";

  for (const row of rows) {
    const startMs = parseInt(row.Timestamp, 10) / 1e6;
    const durationNs = row.Duration ? parseInt(row.Duration, 10) : 0;
    const durationMs = durationNs / 1e6;
    const endMs = startMs + durationMs;

    // Zip parallel arrays for events
    const events: SpanNode["events"] = [];
    const eventNames = row["Events.Name"] ?? [];
    const eventTimestamps = row["Events.Timestamp"] ?? [];
    const eventAttributes = row["Events.Attributes"] ?? [];
    for (let i = 0; i < eventNames.length; i++) {
      events.push({
        timeUnixMs: eventTimestamps[i]
          ? parseInt(eventTimestamps[i]!, 10) / 1e6
          : startMs,
        name: eventNames[i] ?? "",
        attributes: (eventAttributes[i] as Record<string, unknown>) ?? {},
      });
    }

    // Zip parallel arrays for links
    const links: SpanNode["links"] = [];
    const linkTraceIds = row["Links.TraceId"] ?? [];
    const linkSpanIds = row["Links.SpanId"] ?? [];
    const linkAttributes = row["Links.Attributes"] ?? [];
    for (let i = 0; i < linkTraceIds.length; i++) {
      links.push({
        traceId: linkTraceIds[i] ?? "",
        spanId: linkSpanIds[i] ?? "",
        attributes: (linkAttributes[i] as Record<string, unknown>) ?? {},
      });
    }

    const span: SpanNode = {
      spanId: row.SpanId,
      parentSpanId: row.ParentSpanId || undefined,
      traceId: row.TraceId,
      name: row.SpanName ?? "",
      startTimeUnixMs: startMs,
      endTimeUnixMs: endMs,
      durationMs,
      kind: row.SpanKind ?? "INTERNAL",
      status: row.StatusCode ?? "UNSET",
      statusMessage: row.StatusMessage,
      serviceName: row.ServiceName ?? "unknown",
      attributes: row.SpanAttributes ?? {},
      resourceAttributes: row.ResourceAttributes ?? {},
      events,
      links,
      children: [],
    };

    spanById.set(span.spanId, span);
    minTimeMs = Math.min(minTimeMs, startMs);
    maxTimeMs = Math.max(maxTimeMs, endMs);
    if (!traceId) traceId = span.traceId;
  }

  if (spanById.size === 0) return null;

  // Pass 2: Build tree
  const rootSpans: SpanNode[] = [];
  for (const [, span] of spanById) {
    if (span.parentSpanId === span.spanId) {
      rootSpans.push(span);
      continue;
    }
    if (!span.parentSpanId || !spanById.has(span.parentSpanId)) {
      rootSpans.push(span);
    } else {
      spanById.get(span.parentSpanId)!.children.push(span);
    }
  }

  // Sort children by start time
  for (const [, span] of spanById) {
    span.children.sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);
  }
  rootSpans.sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);

  return {
    traceId,
    rootSpans,
    minTimeMs,
    maxTimeMs,
    totalSpanCount: spanById.size,
  };
}

function isSpanAncestorOf(
  potentialAncestor: SpanNode,
  descendantId: string,
  flattenedSpans: Array<{ span: SpanNode; level: number }>
): boolean {
  const descendantItem = flattenedSpans.find(
    (item) => item.span.spanId === descendantId
  );
  if (!descendantItem) return false;

  let current: SpanNode | undefined = descendantItem.span;
  while (current?.parentSpanId) {
    if (current.parentSpanId === potentialAncestor.spanId) return true;
    const parentItem = flattenedSpans.find(
      (item) => item.span.spanId === current!.parentSpanId
    );
    current = parentItem?.span;
  }
  return false;
}

export function TraceTimeline({
  rows,
  onSpanClick,
  selectedSpanId: externalSelectedSpanId,
  isLoading,
  error,
}: TraceTimelineProps) {
  useRegisterShortcuts("trace-viewer", TRACE_VIEWER_SHORTCUTS);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [internalSelectedSpanId, setInternalSelectedSpanId] = useState<
    string | null
  >(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const selectedSpanId = externalSelectedSpanId ?? internalSelectedSpanId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const announcementRef = useRef<HTMLDivElement>(null);

  const parsedTrace = useMemo(() => buildTrace(rows), [rows]);

  const flattenedSpans = useMemo(() => {
    if (!parsedTrace) return [];
    return flattenTree(parsedTrace.rootSpans, collapsedIds);
  }, [parsedTrace, collapsedIds]);

  const virtualizer = useVirtualizer({
    count: flattenedSpans.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 5,
  });

  const handleToggleCollapse = (spanId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const handleSpanClick = useCallback(
    (span: SpanNode) => {
      setInternalSelectedSpanId(span.spanId);
      onSpanClick?.(span);
      if (announcementRef.current) {
        announcementRef.current.textContent = `Selected span: ${span.name}, duration: ${formatDuration(span.durationMs)}`;
      }
    },
    [onSpanClick]
  );

  const handleExpandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    if (!parsedTrace) return;
    setCollapsedIds(new Set(getAllSpanIds(parsedTrace.rootSpans)));
  }, [parsedTrace]);

  const handleNavigateUp = useCallback(() => {
    if (flattenedSpans.length === 0) return;
    const currentIndex = flattenedSpans.findIndex(
      (item) => item.span.spanId === selectedSpanId
    );
    if (currentIndex > 0) {
      const prevItem = flattenedSpans[currentIndex - 1];
      if (prevItem) handleSpanClick(prevItem.span);
    } else if (currentIndex === -1 && flattenedSpans.length > 0) {
      const lastItem = flattenedSpans[flattenedSpans.length - 1];
      if (lastItem) handleSpanClick(lastItem.span);
    }
  }, [flattenedSpans, selectedSpanId, handleSpanClick]);

  const handleNavigateDown = useCallback(() => {
    if (flattenedSpans.length === 0) return;
    const currentIndex = flattenedSpans.findIndex(
      (item) => item.span.spanId === selectedSpanId
    );
    if (currentIndex >= 0 && currentIndex < flattenedSpans.length - 1) {
      const nextItem = flattenedSpans[currentIndex + 1];
      if (nextItem) handleSpanClick(nextItem.span);
    } else if (currentIndex === -1 && flattenedSpans.length > 0) {
      const firstItem = flattenedSpans[0];
      if (firstItem) handleSpanClick(firstItem.span);
    }
  }, [flattenedSpans, selectedSpanId, handleSpanClick]);

  const handleCollapseExpand = useCallback(
    (collapse: boolean) => {
      if (!selectedSpanId) return;
      const selectedItem = flattenedSpans.find(
        (item) => item.span.spanId === selectedSpanId
      );
      if (!selectedItem || selectedItem.span.children.length === 0) return;
      if (collapse) {
        setCollapsedIds((prev) => new Set([...prev, selectedItem.span.spanId]));
      } else {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(selectedItem.span.spanId);
          return next;
        });
      }
    },
    [selectedSpanId, flattenedSpans]
  );

  const handleDeselect = useCallback(() => {
    setInternalSelectedSpanId(null);
  }, []);

  useEffect(() => {
    if (!selectedSpanId) return;
    const selectedIndex = flattenedSpans.findIndex(
      (item) => item.span.spanId === selectedSpanId
    );
    if (selectedIndex !== -1) {
      virtualizer.scrollToIndex(selectedIndex, {
        align: "center",
        behavior: "smooth",
      });
    }
  }, [selectedSpanId, flattenedSpans, virtualizer]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const timelineElement = scrollRef.current?.parentElement;
      if (!timelineElement?.contains(document.activeElement)) return;

      switch (e.key) {
        case "ArrowUp":
        case "k":
        case "K":
          e.preventDefault();
          handleNavigateUp();
          break;
        case "ArrowDown":
        case "j":
        case "J":
          e.preventDefault();
          handleNavigateDown();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleCollapseExpand(true);
          break;
        case "ArrowRight":
          e.preventDefault();
          handleCollapseExpand(false);
          break;
        case "Escape":
          e.preventDefault();
          handleDeselect();
          break;
        case "Enter": {
          if (selectedSpanId) {
            e.preventDefault();
            const detailPane = document.querySelector(
              '[role="complementary"][aria-label="Span details"]'
            );
            if (detailPane) {
              detailPane.scrollIntoView({ behavior: "smooth", block: "start" });
              (detailPane as HTMLElement).focus?.();
            }
          }
          break;
        }
        case "e":
        case "E":
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            handleExpandAll();
          }
          break;
        case "c":
        case "C":
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            handleCollapseAll();
          } else if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const selected = flattenedSpans.find(
              (item) => item.span.spanId === selectedSpanId
            );
            if (selected) {
              navigator.clipboard.writeText(selected.span.name).catch(() => {});
            }
          }
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleNavigateUp,
    handleNavigateDown,
    handleCollapseExpand,
    handleDeselect,
    handleExpandAll,
    handleCollapseAll,
    selectedSpanId,
    flattenedSpans,
  ]);

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 bg-background">
        <div className="text-red-600 dark:text-red-400">
          <div className="font-semibold">Error loading trace</div>
          <div className="text-sm">{error.message}</div>
        </div>
      </div>
    );
  }

  if (rows.length === 0 || !parsedTrace) {
    return (
      <div className="flex items-center justify-center h-64 bg-background">
        <div className="text-muted-foreground">No trace data available</div>
      </div>
    );
  }

  const totalDurationMs = parsedTrace.maxTimeMs - parsedTrace.minTimeMs;
  const selectedSpan =
    selectedSpanId && flattenedSpans.length > 0
      ? flattenedSpans.find((item) => item.span.spanId === selectedSpanId)?.span
      : null;

  return (
    <div className="flex h-full bg-background">
      <div className="flex flex-col flex-1 min-w-0">
        <div
          ref={announcementRef}
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        />
        <TraceHeader trace={parsedTrace} />
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto outline-none"
          role="tree"
          aria-label="Trace timeline"
          tabIndex={0}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = flattenedSpans[virtualItem.index];
              if (!item) return null;

              const { span, level } = item;
              const isCollapsed = collapsedIds.has(span.spanId);
              const isSelected = span.spanId === selectedSpanId;
              const isHovered = span.spanId === hoveredSpanId;
              const isParentOfHovered = hoveredSpanId
                ? isSpanAncestorOf(span, hoveredSpanId, flattenedSpans)
                : false;

              const relativeStart = calculateRelativeTime(
                span.startTimeUnixMs,
                parsedTrace.minTimeMs,
                parsedTrace.maxTimeMs
              );
              const relativeDuration = calculateRelativeDuration(
                span.durationMs,
                totalDurationMs
              );

              return (
                <div
                  key={span.spanId}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <SpanRow
                    span={span}
                    level={level}
                    isCollapsed={isCollapsed}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    isParentOfHovered={isParentOfHovered}
                    relativeStart={relativeStart}
                    relativeDuration={relativeDuration}
                    onClick={() => handleSpanClick(span)}
                    onToggleCollapse={() => handleToggleCollapse(span.spanId)}
                    onMouseEnter={() => setHoveredSpanId(span.spanId)}
                    onMouseLeave={() => setHoveredSpanId(null)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedSpan && (
        <div className="w-96 h-full flex-shrink-0">
          <DetailPane
            span={selectedSpan}
            onClose={handleDeselect}
            onLinkClick={(traceId, spanId) =>
              console.log("Navigate to trace:", traceId, "span:", spanId)
            }
          />
        </div>
      )}
    </div>
  );
}
