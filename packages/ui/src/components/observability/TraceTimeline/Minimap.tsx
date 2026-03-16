/**
 * Minimap - Compressed overview of all spans with a draggable viewport.
 */

import { useRef, useCallback, useMemo, useEffect } from "react";
import type { ParsedTrace } from "../types.js";
import { getSpanBarColor } from "../utils/colors.js";
import { flattenAllSpans } from "../utils/flatten-tree.js";

export interface MinimapProps {
  trace: ParsedTrace;
  viewStart: number; // 0-1 fraction
  viewEnd: number; // 0-1 fraction
  onViewChange: (viewStart: number, viewEnd: number) => void;
}

const MINIMAP_HEIGHT = 40;
const SPAN_HEIGHT = 2;
const SPAN_GAP = 1;
const MIN_VIEWPORT_WIDTH = 0.02;
const HANDLE_WIDTH = 6;

type DragMode = "pan" | "resize-left" | "resize-right" | null;

export function Minimap({
  trace,
  viewStart,
  viewEnd,
  onViewChange,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    origViewStart: number;
    origViewEnd: number;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const allSpans = useMemo(
    () => flattenAllSpans(trace.rootSpans),
    [trace.rootSpans]
  );

  const traceDuration = trace.maxTimeMs - trace.minTimeMs;

  const getFraction = useCallback((clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const clampView = useCallback(
    (start: number, end: number): [number, number] => {
      let s = Math.max(0, Math.min(1 - MIN_VIEWPORT_WIDTH, start));
      let e = Math.max(s + MIN_VIEWPORT_WIDTH, Math.min(1, end));
      if (e > 1) {
        e = 1;
        s = Math.max(0, e - Math.max(MIN_VIEWPORT_WIDTH, end - start));
      }
      return [s, e];
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();
      cleanupRef.current?.();
      dragRef.current = {
        mode,
        startX: e.clientX,
        origViewStart: viewStart,
        origViewEnd: viewEnd,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const deltaFrac = (ev.clientX - drag.startX) / rect.width;

        let newStart: number;
        let newEnd: number;

        if (drag.mode === "pan") {
          const width = drag.origViewEnd - drag.origViewStart;
          newStart = drag.origViewStart + deltaFrac;
          newEnd = newStart + width;
          if (newStart < 0) {
            newStart = 0;
            newEnd = width;
          }
          if (newEnd > 1) {
            newEnd = 1;
            newStart = 1 - width;
          }
        } else if (drag.mode === "resize-left") {
          newStart = drag.origViewStart + deltaFrac;
          newEnd = drag.origViewEnd;
        } else {
          newStart = drag.origViewStart;
          newEnd = drag.origViewEnd + deltaFrac;
        }

        const [s, e] = clampView(newStart, newEnd);
        onViewChange(s, e);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        cleanupRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      cleanupRef.current = handleMouseUp;
    },
    [viewStart, viewEnd, onViewChange, clampView]
  );

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return;
      const frac = getFraction(e.clientX);
      const width = viewEnd - viewStart;
      const half = width / 2;
      const [s, eVal] = clampView(frac - half, frac + half);
      onViewChange(s, eVal);
    },
    [viewStart, viewEnd, onViewChange, getFraction, clampView]
  );

  const viewStartPct = viewStart * 100;
  const viewEndPct = viewEnd * 100;
  const viewWidthPct = viewEndPct - viewStartPct;

  // Calculate span row height to fit within minimap
  const totalRows = allSpans.length;
  const availableHeight = MINIMAP_HEIGHT - 4; // 2px padding top/bottom
  const rowHeight =
    totalRows > 0
      ? Math.min(SPAN_HEIGHT + SPAN_GAP, availableHeight / totalRows)
      : SPAN_HEIGHT;

  return (
    <div
      ref={containerRef}
      className="relative w-full border-b border-border bg-muted/30 select-none"
      style={{ height: MINIMAP_HEIGHT }}
      onClick={handleBackgroundClick}
      role="slider"
      aria-label="Trace minimap viewport"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(viewStartPct)}
    >
      {/* Span bars */}
      {traceDuration > 0 &&
        allSpans.map(({ span }, i) => {
          const left =
            ((span.startTimeUnixMs - trace.minTimeMs) / traceDuration) * 100;
          const width = Math.max(0.2, (span.durationMs / traceDuration) * 100);
          const color = getSpanBarColor(
            span.serviceName,
            span.status === "ERROR"
          );
          return (
            <div
              key={span.spanId}
              className="absolute pointer-events-none"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: 2 + i * rowHeight,
                height: Math.max(1, rowHeight - SPAN_GAP),
                backgroundColor: color,
                opacity: 0.8,
                borderRadius: 1,
              }}
            />
          );
        })}

      {/* Left overlay (outside viewport) */}
      {viewStartPct > 0 && (
        <div
          className="absolute top-0 left-0 h-full bg-black/30 pointer-events-none"
          style={{ width: `${viewStartPct}%` }}
        />
      )}

      {/* Right overlay (outside viewport) */}
      {viewEndPct < 100 && (
        <div
          className="absolute top-0 h-full bg-black/30 pointer-events-none"
          style={{ left: `${viewEndPct}%`, right: 0 }}
        />
      )}

      {/* Viewport rectangle */}
      <div
        className="absolute top-0 h-full border border-blue-500/50 bg-blue-500/10 cursor-grab active:cursor-grabbing"
        style={{
          left: `${viewStartPct}%`,
          width: `${viewWidthPct}%`,
        }}
        onMouseDown={(e) => handleMouseDown(e, "pan")}
      >
        {/* Left resize handle */}
        <div
          className="absolute top-0 left-0 h-full cursor-ew-resize z-10"
          style={{ width: HANDLE_WIDTH, marginLeft: -HANDLE_WIDTH / 2 }}
          onMouseDown={(e) => handleMouseDown(e, "resize-left")}
        />
        {/* Right resize handle */}
        <div
          className="absolute top-0 right-0 h-full cursor-ew-resize z-10"
          style={{ width: HANDLE_WIDTH, marginRight: -HANDLE_WIDTH / 2 }}
          onMouseDown={(e) => handleMouseDown(e, "resize-right")}
        />
      </div>
    </div>
  );
}
