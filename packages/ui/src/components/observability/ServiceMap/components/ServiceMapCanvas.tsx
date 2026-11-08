/**
 * The Service Map canvas (React Flow, plan §5 step 2).
 *
 * - Positions come from layout D; nodes are not draggable or connectable.
 * - `onlyRenderVisibleElements` keeps pan and zoom cheap on large maps.
 * - The initial viewport (`initialViewport`: fit ≤ 100 %, or centred on the
 *   hub when the fit would be < 0.4) is applied once, when the map first has
 *   something to show. After that only the Fit button and Find move the view
 *   (PR P16), so the map never jumps under the user. One exception: when the
 *   canvas changes size (window resize) and the user has not panned or zoomed
 *   since the initial view or the last Fit, that view is applied again for
 *   the new size, so a map opened in a small window grows with it.
 * - The Find box narrows on a narrow canvas so it never covers the buttons.
 * - A Q19 block shift moves already-placed nodes; that change is tweened over
 *   300 ms with requestAnimationFrame, and applied at once under
 *   `prefers-reduced-motion`.
 * - Service nodes carry their size and handles, so React Flow never has to
 *   measure them again when the node objects are rebuilt (every snapshot and
 *   tween frame): they stay visible and their edges stay drawn.
 * - The Find box and the zoom buttons come before the nodes in tab order.
 *   Nodes take focus only when clickable (Enter or Space opens their traces).
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import type { ServiceMapSnapshot } from "../engine/types.js";
import { FIT_PAD_X, FIT_PAD_Y, MIN_ZOOM_FLOOR } from "../layout/constants.js";
import type { Bounds, LayoutResult, Point } from "../layout/layout-d.js";
import { initialViewport, type Size } from "../layout/viewport.js";
import {
  EDGE_COLOR,
  EDGE_COLOR_HIGHLIGHT,
  edgeVisual,
  nodeSize,
} from "./edge-style.js";
import { FindBox, type FindItem } from "./FindBox.js";
import {
  ServiceClickContext,
  ServiceNode,
  type ServiceFlowNode,
  type ServiceNodeData,
} from "./ServiceNode.js";
import { TrayBandNode, type TrayBandFlowNode } from "./TrayBandNode.js";

export const TRAY_BAND_ID = "__service-map-tray-band__";
export const MAX_ZOOM = 2;
/** Duration of the Q19 block-shift tween and of Fit/Find view moves. */
export const SHIFT_TWEEN_MS = 300;

const nodeTypes: NodeTypes = {
  service: ServiceNode,
  trayBand: TrayBandNode,
};

type FlowNode = ServiceFlowNode | TrayBandFlowNode;

export interface ServiceMapCanvasProps {
  snapshot: ServiceMapSnapshot;
  layout: LayoutResult;
  /** CSS height of the canvas (default 640 px). */
  height?: number | string;
  /** Called with the service name when a service node is clicked. */
  onServiceClick?: (service: string) => void;
}

/** True when the user asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** Room kept beside the Find box for the zoom/Fit buttons and panel margins. */
const FIND_RESERVE = 150;
const FIND_MAX_WIDTH = 256;
const FIND_MIN_WIDTH = 120;

/** Find box width for a canvas this wide: 256 px, less on a narrow canvas. */
export function findBoxWidth(canvasWidth: number): number {
  return Math.max(
    FIND_MIN_WIDTH,
    Math.min(FIND_MAX_WIDTH, Math.floor(canvasWidth - FIND_RESERVE))
  );
}

/** Every rendered node position: map nodes and tray nodes. */
export function allPositions(layout: LayoutResult): Map<string, Point> {
  const out = new Map<string, Point>(layout.positions);
  for (const [id, p] of layout.tray.positions) out.set(id, p);
  return out;
}

/**
 * Viewport that shows the whole map (the Fit button). Never zooms past
 * 100 %, and never below `minZoom`.
 */
export function fitAllViewport(
  bounds: Bounds,
  size: Size,
  minZoom: number
): { x: number; y: number; zoom: number } {
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  const w = bounds.maxX - bounds.minX + 2 * FIT_PAD_X;
  const h = bounds.maxY - bounds.minY + 2 * FIT_PAD_Y;
  const zoom = Math.max(minZoom, Math.min(1, W / w, H / h));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: W / 2 - cx * zoom, y: H / 2 - cy * zoom, zoom };
}

/** Only edges whose two endpoints are on the canvas (grafana#133391); no self-loops. */
export function renderableEdges(
  snapshot: ServiceMapSnapshot,
  positions: ReadonlyMap<string, Point>
): ServiceMapSnapshot["edges"] {
  return snapshot.edges.filter(
    (e) =>
      e.source !== e.target &&
      positions.has(e.source) &&
      positions.has(e.target)
  );
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Positions on screen. When already-shown nodes change position (a Q19
 * block shift), they are tweened from where they are drawn now to the new
 * target over 300 ms; new nodes appear at their target at once.
 */
export function useTweenedPositions(
  target: ReadonlyMap<string, Point>
): ReadonlyMap<string, Point> {
  const [shown, setShown] = useState<ReadonlyMap<string, Point>>(target);
  const drawnRef = useRef<ReadonlyMap<string, Point>>(target);

  useLayoutEffect(() => {
    const from = drawnRef.current;
    const moved: { id: string; a: Point; b: Point }[] = [];
    for (const [id, b] of target) {
      const a = from.get(id);
      if (a && (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5)) {
        moved.push({ id, a, b });
      }
    }
    if (
      moved.length === 0 ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== "function"
    ) {
      drawnRef.current = target;
      setShown(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / SHIFT_TWEEN_MS);
      const k = easeOutCubic(t);
      const frame = new Map(target);
      for (const m of moved) {
        frame.set(m.id, {
          x: m.a.x + (m.b.x - m.a.x) * k,
          y: m.a.y + (m.b.y - m.a.y) * k,
        });
      }
      drawnRef.current = frame;
      setShown(frame);
      if (t < 1) raf = requestAnimationFrame(step);
      else drawnRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return shown;
}

export type MapColorMode = "dark" | "light";

/**
 * The theme the map sits in: a `.dark` / `.light` class on an ancestor (the
 * shadcn convention the Kopai app uses), else dark, to match the package's
 * dark-only default tokens (`bg-background` is near-black without a theme).
 */
export function detectColorMode(el: Element | null): MapColorMode {
  const themed = el?.closest(".dark, .light");
  if (themed) return themed.classList.contains("dark") ? "dark" : "light";
  return "dark";
}

/** Background dot colour per theme (a faint grid on the canvas). */
export const DOT_COLOR: Record<MapColorMode, string> = {
  dark: "hsl(0 0% 18%)",
  light: "hsl(0 0% 82%)",
};

function measure(el: HTMLElement | null): Size {
  return {
    width: el?.offsetWidth || el?.clientWidth || 800,
    height: el?.offsetHeight || el?.clientHeight || 600,
  };
}

function CanvasInner({
  snapshot,
  layout,
  height = 640,
  onServiceClick,
}: ServiceMapCanvasProps) {
  const rf = useReactFlow<FlowNode, Edge>();
  // React Flow builds its marker, pattern and aria ids from the flow id
  // (default "1"); a unique one keeps several maps on a page apart.
  const flowId = `sm-${useId().replace(/[^\w-]/g, "")}`;
  const boxRef = useRef<HTMLDivElement>(null);
  // Dark until measured (the Kopai app is dark), then the host's theme,
  // followed when the themed ancestor's (or the root's) class changes.
  const [colorMode, setColorMode] = useState<MapColorMode>("dark");
  useLayoutEffect(() => {
    const el = boxRef.current;
    const update = () => setColorMode(detectColorMode(el));
    update();
    if (!el || typeof MutationObserver !== "function") return;
    const mo = new MutationObserver(update);
    const watched = new Set<Element>([document.documentElement]);
    const themed = el.closest(".dark, .light");
    if (themed) watched.add(themed);
    for (const t of watched) {
      mo.observe(t, { attributes: true, attributeFilter: ["class"] });
    }
    return () => mo.disconnect();
  }, []);
  const [ready, setReady] = useState(false);
  const [minZoom, setMinZoom] = useState(MIN_ZOOM_FLOOR);
  const [foundId, setFoundId] = useState<string | null>(null);
  // Hovering a node highlights its connections, like Find does.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const focusId = hoverId ?? foundId;
  const appliedRef = useRef(false);
  /**
   * Which view follows a resize: the initial view or the last Fit, until the
   * user pans or zooms (then null: the view stays where the user put it).
   */
  const autoViewRef = useRef<"initial" | "fit" | null>("initial");
  const [size, setSize] = useState<Size | null>(null);

  const target = useMemo(() => allPositions(layout), [layout]);
  const shown = useTweenedPositions(target);
  const hubPos = snapshot.hub ? (target.get(snapshot.hub) ?? null) : null;
  const trayIds = useMemo(() => new Set(layout.tray.ids), [layout]);

  // Canvas size, kept up to date (window resize, a dashboard's grid).
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      const next = measure(el);
      setSize((prev) =>
        prev && prev.width === next.width && prev.height === next.height
          ? prev
          : next
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial viewport, applied once (and the zoom floor, kept up to date).
  // After a resize, the automatic view (initial or Fit) is applied again for
  // the new size while the user has not moved the view.
  const appliedSizeRef = useRef<Size | null>(null);
  useEffect(() => {
    if (!ready || !layout.bounds) return;
    const box = size ?? measure(boxRef.current);
    const iv = initialViewport(layout.bounds, box, hubPos);
    setMinZoom(iv.minZoom);
    if (!appliedRef.current) {
      appliedRef.current = true;
      appliedSizeRef.current = box;
      void rf.setViewport({ x: iv.x, y: iv.y, zoom: iv.zoom });
      return;
    }
    const last = appliedSizeRef.current;
    if (last && last.width === box.width && last.height === box.height) return;
    appliedSizeRef.current = box;
    const auto = autoViewRef.current;
    if (auto === "initial") {
      void rf.setViewport({ x: iv.x, y: iv.y, zoom: iv.zoom });
    } else if (auto === "fit") {
      void rf.setViewport(fitAllViewport(layout.bounds, box, iv.minZoom));
    }
  }, [ready, layout.bounds, hubPos, rf, size]);

  const nodes = useMemo<FlowNode[]>(() => {
    const out: FlowNode[] = [];
    const band = layout.tray.band;
    if (band) {
      out.push({
        id: TRAY_BAND_ID,
        type: "trayBand",
        position: { x: band.x, y: band.y },
        origin: [0, 0],
        data: {
          count: layout.tray.count,
          width: band.width,
          height: band.height,
        },
        width: band.width,
        height: band.height,
        // No handles, said up front: React Flow keeps it initialized.
        handles: [],
        zIndex: -1,
        draggable: false,
        selectable: false,
        focusable: false,
      });
    }
    for (const n of snapshot.nodes) {
      const p = shown.get(n.id) ?? target.get(n.id);
      if (!p) continue;
      const d = nodeSize(n.kind, n.spans);
      const data: ServiceNodeData = {
        label: n.label,
        kind: n.kind,
        spans: n.spans,
        errorRate: n.errorRate,
        active: n.active,
        hub: n.id === snapshot.hub,
        found: n.id === foundId,
        inTray: trayIds.has(n.id),
        clickable: !!onServiceClick && n.kind === "service",
      };
      out.push({
        id: n.id,
        type: "service",
        position: p,
        data,
        // Fixed size and handles: React Flow keeps the node initialized
        // when this object is rebuilt, instead of hiding it until measured.
        width: d,
        height: d,
        handles: [
          {
            type: "target",
            position: Position.Left,
            x: 0,
            y: d / 2 - 0.5,
            width: 1,
            height: 1,
          },
          {
            type: "source",
            position: Position.Right,
            x: d - 1,
            y: d / 2 - 0.5,
            width: 1,
            height: 1,
          },
        ],
        draggable: false,
        selectable: false,
        connectable: false,
        // A clickable node is its own button (ServiceNode); others are images.
        focusable: false,
        ...(data.clickable ? {} : { ariaRole: "img", ariaLabel: n.label }),
      });
    }
    return out;
  }, [snapshot, layout, shown, target, foundId, trayIds, onServiceClick]);

  const edges = useMemo<Edge[]>(
    () =>
      renderableEdges(snapshot, target).map((e) => {
        const v = edgeVisual(e);
        const hl =
          focusId !== null && (e.source === focusId || e.target === focusId);
        const color = hl ? EDGE_COLOR_HIGHLIGHT : EDGE_COLOR;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          className: [
            "sm-edge",
            e.active ? "" : "sm-edge-dim",
            e.virtual ? "sm-edge-virtual" : "",
          ]
            .filter(Boolean)
            .join(" "),
          style: {
            stroke: color,
            strokeWidth: v.strokeWidth,
            opacity: hl ? 1 : v.opacity,
            strokeDasharray: v.strokeDasharray,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 10,
            height: 10,
            markerUnits: "userSpaceOnUse",
          },
          focusable: false,
          selectable: false,
          ariaLabel: `${e.source} to ${e.target}: ${e.calls.toLocaleString("en-US")} calls in the past 60 min`,
        };
      }),
    [snapshot, target, focusId]
  );

  const findItems = useMemo<FindItem[]>(
    () =>
      snapshot.nodes.flatMap((n) => {
        const p = target.get(n.id);
        return p
          ? [
              {
                id: n.id,
                label: n.label,
                kind: n.kind,
                x: p.x,
                y: p.y,
                inTray: trayIds.has(n.id),
              },
            ]
          : [];
      }),
    [snapshot, target, trayIds]
  );

  const duration = () => (prefersReducedMotion() ? 0 : SHIFT_TWEEN_MS);

  const onFind = useCallback(
    (item: FindItem) => {
      autoViewRef.current = null;
      setFoundId(item.id);
      void rf.setCenter(item.x, item.y, {
        zoom: Math.max(rf.getZoom(), 1),
        duration: duration(),
      });
    },
    [rf]
  );

  const onNodeClick = useCallback(
    (_: unknown, node: FlowNode) => {
      if (node.type !== "service" || !onServiceClick) return;
      // A service node's id is the service name.
      if ((node.data as ServiceNodeData).kind === "service") {
        onServiceClick(node.id);
      }
    },
    [onServiceClick]
  );

  const onNodeMouseEnter = useCallback((_: unknown, node: FlowNode) => {
    if (node.type === "service") setHoverId(node.id);
  }, []);
  const onNodeMouseLeave = useCallback(() => setHoverId(null), []);

  const onFit = useCallback(() => {
    if (!layout.bounds) return;
    autoViewRef.current = "fit";
    void rf.setViewport(
      fitAllViewport(layout.bounds, measure(boxRef.current), minZoom),
      { duration: duration() }
    );
  }, [rf, layout.bounds, minZoom]);

  return (
    <div
      ref={boxRef}
      className="sm-canvas relative w-full overflow-hidden rounded-lg border border-border bg-background"
      style={{ height }}
    >
      {/* The controls sit before the canvas in the DOM, so they come first
        in tab order; placed like React Flow panels. */}
      <div className="sm-panel absolute left-0 top-0 z-10 m-[15px]">
        <FindBox
          width={findBoxWidth((size ?? measure(boxRef.current)).width)}
          items={findItems}
          onFind={onFind}
          onClear={() => setFoundId(null)}
        />
      </div>
      <div className="sm-panel absolute right-0 top-0 z-10 m-[15px]">
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              autoViewRef.current = null;
              void rf.zoomIn({ duration: duration() });
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground hover:bg-muted"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              autoViewRef.current = null;
              void rf.zoomOut({ duration: duration() });
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground hover:bg-muted"
          >
            −
          </button>
          <button
            type="button"
            onClick={onFit}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-sm text-foreground hover:bg-muted"
          >
            Fit
          </button>
        </div>
      </div>
      <ServiceClickContext.Provider value={onServiceClick}>
        <ReactFlow<FlowNode, Edge>
          id={flowId}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodeOrigin={[0.5, 0.5]}
          onInit={() => setReady(true)}
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          nodesFocusable={false}
          // Nothing is selectable or movable: no "press Enter to select" hint.
          disableKeyboardA11y
          minZoom={minZoom}
          maxZoom={MAX_ZOOM}
          colorMode={colorMode}
          zoomOnDoubleClick={false}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onMoveStart={(event) => {
            // A pan or zoom by the user (programmatic moves have no event).
            if (event) autoViewRef.current = null;
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color={DOT_COLOR[colorMode]}
          />
        </ReactFlow>
      </ServiceClickContext.Provider>
    </div>
  );
}

function ServiceMapCanvasImpl(props: ServiceMapCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export const ServiceMapCanvas = memo(ServiceMapCanvasImpl);
