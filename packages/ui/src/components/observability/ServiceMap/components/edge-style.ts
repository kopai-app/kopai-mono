/**
 * Fixed visual scales for the Service Map (PR P13): edge width and node size
 * come from fixed log scales of the raw counts, never normalised to a running
 * maximum, so a node or edge keeps its size while other parts of the map grow.
 */
import type { NodeKind } from "../engine/types.js";

/** Thinnest and thickest edge stroke (px at zoom 1). */
export const EDGE_MIN_WIDTH = 1;
export const EDGE_MAX_WIDTH = 6;

/**
 * Edge stroke width from calls in the last 60 min:
 * `clamp(1 + 1.2 · log10(max(1, calls)), 1, 6)`.
 */
export function edgeStrokeWidth(calls: number): number {
  const c = Number.isFinite(calls) ? Math.max(1, calls) : 1;
  const w = 1 + 1.2 * Math.log10(c);
  return Math.min(EDGE_MAX_WIDTH, Math.max(EDGE_MIN_WIDTH, w));
}

/**
 * Node diameter breakpoints by spans in the window (upper bound exclusive →
 * diameter in px). A service with more spans than the last bound gets
 * `SERVICE_SIZE_MAX`.
 */
export const SERVICE_SIZE_BREAKPOINTS: readonly (readonly [number, number])[] =
  [
    [100, 16],
    [1_000, 20],
    [10_000, 24],
    [100_000, 30],
  ];
export const SERVICE_SIZE_MAX = 36;
/** Databases, queues and external APIs have no spans of their own. */
export const VIRTUAL_SIZE = 22;

/** Node diameter (px at zoom 1) from fixed log breakpoints. */
export function nodeSize(kind: NodeKind, spans: number): number {
  if (kind !== "service") return VIRTUAL_SIZE;
  const s = Number.isFinite(spans) ? spans : 0;
  for (const [below, size] of SERVICE_SIZE_BREAKPOINTS) {
    if (s < below) return size;
  }
  return SERVICE_SIZE_MAX;
}

export type ErrorLevel = "none" | "warn" | "high";

/** Error rate (fraction) at which a node gets the amber cue. */
export const ERROR_WARN = 0.01;
/** Error rate (fraction) at which a node gets the red cue. */
export const ERROR_HIGH = 0.05;

/** ≥1 % amber, ≥5 % red. */
export function errorLevel(errorRate: number): ErrorLevel {
  if (!(errorRate >= ERROR_WARN)) return "none";
  return errorRate >= ERROR_HIGH ? "high" : "warn";
}

/** Opacity of nodes and edges with no traffic in the last 60 min (R2-3). */
export const DIM_OPACITY = 0.35;
export const EDGE_DIM_OPACITY = 0.2;

/** Stroke dash of virtual edges (service → db/queue/external, from the seed). */
export const VIRTUAL_DASH = "5 4";

export const EDGE_COLOR = "hsl(0 0% 55%)";
export const EDGE_COLOR_HIGHLIGHT = "hsl(210 90% 65%)";
export const ERROR_COLOR: Record<Exclude<ErrorLevel, "none">, string> = {
  warn: "hsl(38 92% 55%)",
  high: "hsl(0 84% 60%)",
};

export interface EdgeVisual {
  strokeWidth: number;
  opacity: number;
  strokeDasharray: string | undefined;
}

/** Stroke of one edge: fixed-scale width, dimmed when inactive, dashed when virtual. */
export function edgeVisual(e: {
  calls: number;
  active: boolean;
  virtual: boolean;
}): EdgeVisual {
  return {
    strokeWidth: edgeStrokeWidth(e.calls),
    opacity: e.active ? 0.85 : EDGE_DIM_OPACITY,
    strokeDasharray: e.virtual ? VIRTUAL_DASH : undefined,
  };
}

/** Fill and stroke of a virtual node (database, queue, external API). */
export const VIRTUAL_FILL = "hsl(0 0% 18%)";
export const VIRTUAL_STROKE = "hsl(0 0% 62%)";
