/**
 * Service Map container and presentational view (plan §5 step 1).
 *
 * `ServiceMap` subscribes to the tab's shared session (`useServiceMap`) and
 * renders `ServiceMapView`. The view runs layout D only when the graph's
 * sorted node-id + edge-pair signature (or the hub) changes: a snapshot that
 * only changes counts restyles nodes and edges and never moves anything
 * (the Kiali rule, PR §2.2). The canvas is never cleared during an update
 * (grafana#112117); the last layout stays until the next one is ready.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ServiceMapSnapshot } from "../engine/types.js";
import {
  updateLayout,
  type LayoutGraph,
  type LayoutResult,
  type LayoutState,
} from "../layout/layout-d.js";
import {
  useServiceMap,
  type UseServiceMapOptions,
} from "../session/use-service-map.js";
import { Legend } from "./Legend.js";
import { ServiceMapCanvas } from "./ServiceMapCanvas.js";
import { ServiceMapHeader } from "./ServiceMapHeader.js";

/** Sorted node ids, sorted edge pairs and the hub: what layout depends on. */
export function graphSignature(s: ServiceMapSnapshot): string {
  const ids = s.nodes.map((n) => n.id).sort();
  const pairs = s.edges.map((e) => `${e.source}\u0001${e.target}`).sort();
  return `${s.hub ?? ""}\u0002${ids.join("\u0000")}\u0002${pairs.join("\u0000")}`;
}

/** The layout's view of a snapshot. */
export function snapshotGraph(s: ServiceMapSnapshot): LayoutGraph {
  return {
    hub: s.hub,
    nodes: s.nodes.map((n) => ({ id: n.id, spans: n.spans })),
    edges: s.edges.map((e) => ({
      source: e.source,
      target: e.target,
      calls: e.calls,
    })),
  };
}

const EMPTY_LAYOUT: LayoutResult = updateLayout(null, {
  nodes: [],
  edges: [],
  hub: null,
});

export interface LayoutCache {
  key: string;
  result: LayoutResult;
}

/** A place to keep the layout cache that can outlive the component. */
export interface LayoutSlot {
  current: LayoutCache | null;
}

/**
 * Incremental layout keyed by the graph signature. The cache makes the
 * memo idempotent (StrictMode may call it twice): the same key returns the
 * same result, and a new key always builds on the last committed state.
 *
 * With `layoutFrames`, those earlier snapshots are laid out first, in order,
 * so a story can jump straight to frame n with the same anchoring as a live
 * session that saw frames 1…n.
 */
export function useMapLayout(
  snapshot: ServiceMapSnapshot | null,
  layoutFrames?: readonly ServiceMapSnapshot[],
  slot?: LayoutSlot
): LayoutResult {
  const own = useRef<LayoutCache | null>(null);
  const cache: LayoutSlot = slot ?? own;
  const key = useMemo(() => {
    if (!snapshot) return "";
    const head = layoutFrames?.map(graphSignature).join("\u0003") ?? "";
    return `${head}\u0004${graphSignature(snapshot)}`;
  }, [snapshot, layoutFrames]);

  return useMemo(() => {
    if (!snapshot) return EMPTY_LAYOUT;
    const c = cache.current;
    if (c && c.key === key) return c.result;
    let result: LayoutResult;
    if (layoutFrames) {
      let state: LayoutState | null = null;
      for (const f of layoutFrames) {
        state = updateLayout(state, snapshotGraph(f)).state;
      }
      result = updateLayout(state, snapshotGraph(snapshot));
    } else {
      // A restarted engine (hidden longer than M) may choose another hub:
      // lay the new graph out around it instead of the old centre.
      const prev = c?.result.state ?? null;
      const base =
        prev && snapshot.hub !== null && prev.hub !== snapshot.hub
          ? null
          : prev;
      result = updateLayout(base, snapshotGraph(snapshot));
    }
    cache.current = { key, result };
    return result;
    // `key` captures everything layout reads; counts alone never relayout.
  }, [key, cache]);
}

/** True when no two services are connected by a real (span-paired) call. */
export function hasNoServiceCalls(s: ServiceMapSnapshot): boolean {
  const kind = new Map(s.nodes.map((n) => [n.id, n.kind]));
  return !s.edges.some(
    (e) =>
      !e.virtual &&
      kind.get(e.source) === "service" &&
      kind.get(e.target) === "service"
  );
}

export const LOADING_TEXT = "Looking for spans…";
export const EMPTY_TEXT =
  "No spans in the past 60 minutes. Services appear here as soon as traces arrive.";
export const NO_CALLS_HINT =
  "No calls between services found yet — the map needs at least 2 instrumented services or outgoing CLIENT spans.";

export interface ServiceMapViewProps {
  snapshot: ServiceMapSnapshot | null;
  onRetry?: () => void;
  /** Earlier snapshots to lay out first (stories replaying discovery frames). */
  layoutFrames?: readonly ServiceMapSnapshot[];
  /** CSS height of the canvas (default 640 px), or "fill": the whole map fills the rest of the window and the page never scrolls. */
  height?: number | string;
  /** Called with the service name when a service node is clicked. */
  onServiceClick?: (service: string) => void;
  /**
   * Where the incremental layout is kept. The live map passes its session's
   * slot, so leaving the tab and coming back keeps every node where it was.
   */
  layoutSlot?: LayoutSlot;
}

/** Smallest height the "fill" mode shrinks the whole map section to. */
export const FILL_MIN_HEIGHT = 420;

/**
 * Height that makes `ref`'s element end exactly at the bottom of the window:
 * the window height minus where the element starts and minus the bottom
 * padding and borders of its ancestors. Re-measured on resize and whenever
 * the element moves (something above it changed height: a wrapping tab bar,
 * late fonts), then corrected once if the page still overflows, so the page
 * never scrolls.
 */
export function useFillHeight(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof window === "undefined") return;
    const topOf = () => el.getBoundingClientRect().top + window.scrollY;
    let lastTop = Number.NaN;
    const measure = () => {
      const top = topOf();
      lastTop = top;
      let below = 0;
      for (
        let n = el.parentElement;
        n && n !== document.documentElement;
        n = n.parentElement
      ) {
        const cs = getComputedStyle(n);
        below +=
          (parseFloat(cs.paddingBottom) || 0) +
          (parseFloat(cs.borderBottomWidth) || 0);
      }
      setHeight(
        Math.max(FILL_MIN_HEIGHT, Math.floor(window.innerHeight - top - below))
      );
    };
    measure();
    window.addEventListener("resize", measure);
    // The page's own size changes when anything on it does; re-measure only
    // when that moved the element, so the map's own height change (and the
    // overflow correction below) never loops.
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            if (topOf() !== lastTop) measure();
          })
        : null;
    ro?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref, enabled]);
  // Anything the ancestors add that the measure missed (margins, siblings
  // below): shrink by exactly the overflow, once per measured height.
  useLayoutEffect(() => {
    if (!enabled || height === null || typeof window === "undefined") return;
    const overflow = document.documentElement.scrollHeight - window.innerHeight;
    if (overflow > 0 && height - overflow >= FILL_MIN_HEIGHT) {
      setHeight(height - overflow);
    }
  }, [enabled, height]);
  return height;
}

export function ServiceMapView({
  snapshot,
  onRetry,
  layoutFrames,
  height = 640,
  onServiceClick,
  layoutSlot,
}: ServiceMapViewProps) {
  const layout = useMapLayout(snapshot, layoutFrames, layoutSlot);
  const sectionRef = useRef<HTMLElement>(null);
  const fill = height === "fill";
  const fillHeight = useFillHeight(sectionRef, fill);
  // In "fill" mode the body takes the space the header and legend leave.
  const bodyHeight = fill ? "100%" : height;
  const state = snapshot?.scan.state ?? "idle";
  const starting = state === "idle" || state === "seeding";

  let body;
  // Nodes can be known (getServices) before the hub is chosen: nothing can
  // be placed until then, so keep the placeholder rather than a blank canvas.
  const nothingPlaced =
    !!snapshot && snapshot.nodes.length > 0 && layout.state === null;
  if (!snapshot || (snapshot.nodes.length === 0 && starting) || nothingPlaced) {
    body = (
      <div
        className="sm-loading flex animate-pulse items-center justify-center rounded-lg border border-border bg-card/40 text-sm text-muted-foreground"
        style={{ height: bodyHeight }}
        role="status"
      >
        {LOADING_TEXT}
      </div>
    );
  } else if (snapshot.nodes.length === 0) {
    body = (
      <div
        className="sm-empty flex items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-sm text-muted-foreground"
        style={{ height: bodyHeight }}
        role="status"
      >
        {EMPTY_TEXT}
      </div>
    );
  } else {
    body = (
      <ServiceMapCanvas
        snapshot={snapshot}
        layout={layout}
        height={bodyHeight}
        onServiceClick={onServiceClick}
      />
    );
  }

  return (
    <section
      ref={sectionRef}
      className="sm-root flex flex-col gap-3"
      style={fill ? { height: fillHeight ?? FILL_MIN_HEIGHT } : undefined}
      aria-label="Service map"
    >
      <ServiceMapHeader
        snapshot={snapshot}
        onRetry={onRetry}
        hint={
          snapshot && !starting && hasNoServiceCalls(snapshot)
            ? NO_CALLS_HINT
            : null
        }
      />
      {fill ? <div className="min-h-0 flex-1">{body}</div> : body}
      <Legend />
    </section>
  );
}

export interface ServiceMapProps extends UseServiceMapOptions {
  /** CSS height of the canvas (default 640 px), or "fill": the whole map fills the rest of the window and the page never scrolls. */
  height?: number | string;
  /** Called with the service name when a service node is clicked. */
  onServiceClick?: (service: string) => void;
}

/** The live Service Map: the tab's shared session rendered by `ServiceMapView`. */
export function ServiceMap({
  height,
  onServiceClick,
  ...options
}: ServiceMapProps) {
  const { snapshot, retry, layoutSlot } = useServiceMap(options);
  return (
    <ServiceMapView
      snapshot={snapshot}
      onRetry={retry}
      height={height}
      onServiceClick={onServiceClick}
      layoutSlot={layoutSlot}
    />
  );
}
