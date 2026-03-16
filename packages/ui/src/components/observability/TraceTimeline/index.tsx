/**
 * TraceTimeline - Accepts OtelTracesRow[] and renders trace visualization.
 * Transforms denormalized rows to SpanNode tree internally.
 */

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
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
import { SpanDetailInline } from "./SpanDetailInline.js";
import { LoadingSkeleton } from "../shared/LoadingSkeleton.js";
import { useRegisterShortcuts } from "../../KeyboardShortcuts/index.js";
import { TRACE_VIEWER_SHORTCUTS } from "./shortcuts.js";
import { TimeRuler } from "./TimeRuler.js";
import { SpanSearch } from "./SpanSearch.js";
import { ViewTabs } from "./ViewTabs.js";
import { GraphView } from "./GraphView.js";
import { StatisticsView } from "./StatisticsView.js";
import { FlamegraphView } from "./FlamegraphView.js";
import { Minimap } from "./Minimap.js";

export interface TraceTimelineProps {
  rows: OtelTracesRow[];
  onSpanClick?: (span: SpanNode) => void;
  onSpanDeselect?: () => void;
  selectedSpanId?: string;
  isLoading?: boolean;
  error?: Error;
  view?: string;
  onViewChange?: (view: string) => void;
  uiFind?: string;
  onUiFindChange?: (value: string) => void;
  viewStart?: number;
  viewEnd?: number;
  onViewRangeChange?: (viewStart: number, viewEnd: number) => void;
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

function spanMatchesSearch(span: SpanNode, query: string): boolean {
  const q = query.toLowerCase();
  if (span.name.toLowerCase().includes(q)) return true;
  if (span.serviceName.toLowerCase().includes(q)) return true;
  for (const val of Object.values(span.attributes)) {
    if (String(val).toLowerCase().includes(q)) return true;
  }
  return false;
}

function collectServices(rootSpans: SpanNode[]): string[] {
  const set = new Set<string>();
  function walk(span: SpanNode) {
    set.add(span.serviceName);
    span.children.forEach(walk);
  }
  rootSpans.forEach(walk);
  return Array.from(set).sort();
}

export function TraceTimeline({
  rows,
  onSpanClick,
  onSpanDeselect,
  selectedSpanId: externalSelectedSpanId,
  isLoading,
  error,
  view: externalView,
  onViewChange,
  uiFind: externalUiFind,
  onUiFindChange,
  viewStart: externalViewStart,
  viewEnd: externalViewEnd,
  onViewRangeChange,
}: TraceTimelineProps) {
  useRegisterShortcuts("trace-viewer", TRACE_VIEWER_SHORTCUTS);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [internalSelectedSpanId, setInternalSelectedSpanId] = useState<
    string | null
  >(null);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [internalView, setInternalView] = useState("timeline");
  const [internalUiFind, setInternalUiFind] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [internalViewStart, setInternalViewStart] = useState(0);
  const [internalViewEnd, setInternalViewEnd] = useState(1);

  const selectedSpanId = externalSelectedSpanId ?? internalSelectedSpanId;
  const viewStart = externalViewStart ?? internalViewStart;
  const viewEnd = externalViewEnd ?? internalViewEnd;
  const activeView = externalView ?? internalView;
  const uiFind = externalUiFind ?? internalUiFind;
  const scrollRef = useRef<HTMLDivElement>(null);
  const announcementRef = useRef<HTMLDivElement>(null);

  const parsedTrace = useMemo(() => buildTrace(rows), [rows]);

  const services = useMemo(
    () => (parsedTrace ? collectServices(parsedTrace.rootSpans) : []),
    [parsedTrace]
  );

  const flattenedSpans = useMemo(() => {
    if (!parsedTrace) return [];
    return flattenTree(parsedTrace.rootSpans, collapsedIds);
  }, [parsedTrace, collapsedIds]);

  const matchingIndices = useMemo(() => {
    if (!uiFind) return [];
    return flattenedSpans
      .map((item, idx) => (spanMatchesSearch(item.span, uiFind) ? idx : -1))
      .filter((idx) => idx !== -1);
  }, [flattenedSpans, uiFind]);

  const handleToggleCollapse = (spanId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const handleDeselect = useCallback(() => {
    setInternalSelectedSpanId(null);
    onSpanDeselect?.();
  }, [onSpanDeselect]);

  const handleSpanClick = useCallback(
    (span: SpanNode) => {
      const isAlreadySelected = selectedSpanId === span.spanId;
      if (isAlreadySelected) {
        handleDeselect();
      } else {
        setInternalSelectedSpanId(span.spanId);
        onSpanClick?.(span);
        if (announcementRef.current) {
          announcementRef.current.textContent = `Selected span: ${span.name}, duration: ${formatDuration(span.durationMs)}`;
        }
      }
    },
    [onSpanClick, selectedSpanId, handleDeselect]
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

  const handleViewChange = useCallback(
    (view: string) => {
      if (onViewChange) onViewChange(view);
      else setInternalView(view);
    },
    [onViewChange]
  );

  const handleUiFindChange = useCallback(
    (value: string) => {
      if (onUiFindChange) onUiFindChange(value);
      else setInternalUiFind(value);
      setCurrentMatchIndex(0);
    },
    [onUiFindChange]
  );

  const handleViewRangeChange = useCallback(
    (start: number, end: number) => {
      if (onViewRangeChange) onViewRangeChange(start, end);
      else {
        setInternalViewStart(start);
        setInternalViewEnd(end);
      }
    },
    [onViewRangeChange]
  );

  const scrollToSpan = useCallback((spanId: string) => {
    const el = scrollRef.current?.querySelector(`[data-span-id="${spanId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const handleSearchNext = useCallback(() => {
    if (matchingIndices.length === 0) return;
    const next = (currentMatchIndex + 1) % matchingIndices.length;
    setCurrentMatchIndex(next);
    const idx = matchingIndices[next];
    if (idx !== undefined) {
      const item = flattenedSpans[idx];
      if (item) {
        handleSpanClick(item.span);
        scrollToSpan(item.span.spanId);
      }
    }
  }, [
    matchingIndices,
    currentMatchIndex,
    flattenedSpans,
    handleSpanClick,
    scrollToSpan,
  ]);

  const handleSearchPrev = useCallback(() => {
    if (matchingIndices.length === 0) return;
    const prev =
      (currentMatchIndex - 1 + matchingIndices.length) % matchingIndices.length;
    setCurrentMatchIndex(prev);
    const idx = matchingIndices[prev];
    if (idx !== undefined) {
      const item = flattenedSpans[idx];
      if (item) {
        handleSpanClick(item.span);
        scrollToSpan(item.span.spanId);
      }
    }
  }, [
    matchingIndices,
    currentMatchIndex,
    flattenedSpans,
    handleSpanClick,
    scrollToSpan,
  ]);

  useEffect(() => {
    if (!selectedSpanId) return;
    scrollToSpan(selectedSpanId);
  }, [selectedSpanId, scrollToSpan]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape always deselects when a span is selected
      if (e.key === "Escape" && selectedSpanId) {
        e.preventDefault();
        handleDeselect();
        return;
      }

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
          // handled above, before focus check
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
        <TraceHeader
          trace={parsedTrace}
          services={services}
          onHeaderToggle={() => setHeaderCollapsed((p) => !p)}
          isCollapsed={headerCollapsed}
        />
        <ViewTabs activeView={activeView} onChange={handleViewChange} />
        <SpanSearch
          value={uiFind}
          onChange={handleUiFindChange}
          matchCount={matchingIndices.length}
          currentMatch={currentMatchIndex}
          onPrev={handleSearchPrev}
          onNext={handleSearchNext}
        />

        {activeView === "graph" ? (
          <GraphView trace={parsedTrace} />
        ) : activeView === "statistics" ? (
          <StatisticsView trace={parsedTrace} />
        ) : activeView === "flamegraph" ? (
          <FlamegraphView
            trace={parsedTrace}
            onSpanClick={handleSpanClick}
            selectedSpanId={selectedSpanId ?? undefined}
          />
        ) : activeView !== "timeline" ? (
          <div className="flex items-center justify-center flex-1 text-muted-foreground">
            {activeView.charAt(0).toUpperCase() + activeView.slice(1)} view
            coming soon
          </div>
        ) : (
          <>
            <Minimap
              trace={parsedTrace}
              viewStart={viewStart}
              viewEnd={viewEnd}
              onViewChange={handleViewRangeChange}
            />
            <TimeRuler
              totalDurationMs={totalDurationMs * (viewEnd - viewStart)}
              leftColumnWidth="24rem"
              offsetMs={totalDurationMs * viewStart}
            />
            <div
              ref={scrollRef}
              className="flex-1 overflow-auto outline-none"
              role="tree"
              aria-label="Trace timeline"
              tabIndex={0}
            >
              {flattenedSpans.map((item) => {
                const { span, level } = item;
                const isCollapsed = collapsedIds.has(span.spanId);
                const isSelected = span.spanId === selectedSpanId;
                const isHovered = span.spanId === hoveredSpanId;
                const isParentOfHovered = hoveredSpanId
                  ? isSpanAncestorOf(span, hoveredSpanId, flattenedSpans)
                  : false;

                const viewRange = viewEnd - viewStart;
                const relativeStart =
                  (calculateRelativeTime(
                    span.startTimeUnixMs,
                    parsedTrace.minTimeMs,
                    parsedTrace.maxTimeMs
                  ) -
                    viewStart) /
                  viewRange;
                const relativeDuration =
                  calculateRelativeDuration(span.durationMs, totalDurationMs) /
                  viewRange;

                return (
                  <div key={span.spanId} data-span-id={span.spanId}>
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
                      uiFind={uiFind || undefined}
                    />
                    {isSelected && (
                      <SpanDetailInline
                        span={span}
                        traceStartMs={parsedTrace.minTimeMs}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
