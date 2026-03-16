import { useMemo, useState, useCallback } from "react";
import type { ParsedTrace, SpanNode } from "../types.js";
import { getServiceColor } from "../utils/colors.js";
import { formatDuration } from "../utils/time.js";
import { flattenAllSpans } from "../utils/flatten-tree.js";

interface FlamegraphViewProps {
  trace: ParsedTrace;
  onSpanClick?: (span: SpanNode) => void;
  selectedSpanId?: string;
}

const ROW_HEIGHT = 24;
const MIN_WIDTH = 1;
const LABEL_MIN_WIDTH = 40;

function findSpanById(rootSpans: SpanNode[], spanId: string): SpanNode | null {
  for (const root of rootSpans) {
    if (root.spanId === spanId) return root;
    const found = findSpanById(root.children, spanId);
    if (found) return found;
  }
  return null;
}

function getAncestorPath(rootSpans: SpanNode[], targetId: string): SpanNode[] {
  const path: SpanNode[] = [];
  function walk(span: SpanNode, ancestors: SpanNode[]): boolean {
    if (span.spanId === targetId) {
      path.push(...ancestors, span);
      return true;
    }
    for (const child of span.children) {
      if (walk(child, [...ancestors, span])) return true;
    }
    return false;
  }
  for (const root of rootSpans) {
    if (walk(root, [])) break;
  }
  return path;
}

export function FlamegraphView({
  trace,
  onSpanClick,
  selectedSpanId,
}: FlamegraphViewProps) {
  const [zoomSpanId, setZoomSpanId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    span: SpanNode;
    x: number;
    y: number;
  } | null>(null);

  const zoomRoot = useMemo(() => {
    if (!zoomSpanId) return null;
    return findSpanById(trace.rootSpans, zoomSpanId);
  }, [trace.rootSpans, zoomSpanId]);

  const breadcrumbs = useMemo(() => {
    if (!zoomSpanId) return [];
    return getAncestorPath(trace.rootSpans, zoomSpanId);
  }, [trace.rootSpans, zoomSpanId]);

  const viewRoots = zoomRoot ? [zoomRoot] : trace.rootSpans;
  const viewMinTime = zoomRoot ? zoomRoot.startTimeUnixMs : trace.minTimeMs;
  const viewMaxTime = zoomRoot ? zoomRoot.endTimeUnixMs : trace.maxTimeMs;
  const viewDuration = viewMaxTime - viewMinTime;

  const flatSpans = useMemo(
    () =>
      flattenAllSpans(viewRoots).map((fs) => ({
        span: fs.span,
        depth: fs.level,
      })),
    [viewRoots]
  );

  const maxDepth = useMemo(
    () => flatSpans.reduce((max, fs) => Math.max(max, fs.depth), 0) + 1,
    [flatSpans]
  );

  const svgWidth = 1200;
  const svgHeight = maxDepth * ROW_HEIGHT;

  const handleClick = useCallback(
    (span: SpanNode) => {
      onSpanClick?.(span);
      setZoomSpanId(span.spanId);
    },
    [onSpanClick]
  );

  const handleZoomOut = useCallback((spanId: string | null) => {
    setZoomSpanId(spanId);
  }, []);

  return (
    <div className="flex-1 overflow-auto p-2">
      {/* Breadcrumb bar */}
      {breadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2 flex-wrap">
          <button
            className="hover:text-foreground underline"
            onClick={() => handleZoomOut(null)}
          >
            root
          </button>
          {breadcrumbs.map((bc, i) => (
            <span key={bc.spanId} className="flex items-center gap-1">
              <span className="text-muted-foreground/50">&gt;</span>
              {i < breadcrumbs.length - 1 ? (
                <button
                  className="hover:text-foreground underline"
                  onClick={() => handleZoomOut(bc.spanId)}
                >
                  {bc.serviceName}: {bc.name}
                </button>
              ) : (
                <span className="text-foreground">
                  {bc.serviceName}: {bc.name}
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* SVG flamegraph */}
      <div className="overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          className="block"
          onMouseLeave={() => setTooltip(null)}
        >
          {flatSpans.map(({ span, depth }) => {
            const x =
              viewDuration > 0
                ? ((span.startTimeUnixMs - viewMinTime) / viewDuration) *
                  svgWidth
                : 0;
            const w =
              viewDuration > 0
                ? Math.max(
                    MIN_WIDTH,
                    (span.durationMs / viewDuration) * svgWidth
                  )
                : svgWidth;
            const y = depth * ROW_HEIGHT;
            const color = getServiceColor(span.serviceName);
            const isSelected = span.spanId === selectedSpanId;
            const showLabel = w >= LABEL_MIN_WIDTH;
            const label = `${span.serviceName}: ${span.name}`;

            return (
              <g
                key={span.spanId}
                className="cursor-pointer"
                onClick={() => handleClick(span)}
                onMouseEnter={(e) =>
                  setTooltip({
                    span,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseMove={(e) =>
                  setTooltip((prev) =>
                    prev ? { ...prev, x: e.clientX, y: e.clientY } : null
                  )
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={ROW_HEIGHT - 1}
                  fill={color}
                  opacity={0.85}
                  rx={2}
                  stroke={isSelected ? "#ffffff" : "transparent"}
                  strokeWidth={isSelected ? 2 : 0}
                  className="hover:opacity-100"
                />
                {showLabel && (
                  <text
                    x={x + 4}
                    y={y + ROW_HEIGHT / 2 + 1}
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize={11}
                    fontFamily="monospace"
                    clipPath={`inset(0 0 0 0)`}
                  >
                    <tspan>
                      {label.length > w / 7
                        ? label.slice(0, Math.floor(w / 7) - 1) + "\u2026"
                        : label}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-popover border border-border rounded px-3 py-2 text-xs shadow-lg"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
          }}
        >
          <div className="font-medium text-foreground">{tooltip.span.name}</div>
          <div className="text-muted-foreground">
            {tooltip.span.serviceName}
          </div>
          <div className="text-foreground mt-1">
            {formatDuration(tooltip.span.durationMs)}
          </div>
        </div>
      )}
    </div>
  );
}
