/** Viewport helpers for layout D (PR §5.5): fit rule, level of detail, truncation. */
import {
  FIT_PAD_X,
  FIT_PAD_Y,
  HUB_ZOOM,
  LABEL_MIN_PX,
  LABEL_PX,
  MIN_FIT_SCALE,
  MIN_ZOOM_FLOOR,
  NAME_MAX,
} from "./constants.js";
import type { Bounds, Point } from "./layout-d.js";

export interface Size {
  width: number;
  height: number;
}

/** A React Flow viewport (`screen = flow × zoom + (x, y)`) plus the zoom floor. */
export interface InitialViewport {
  x: number;
  y: number;
  zoom: number;
  /** Lowest zoom the canvas allows; low enough to show the whole map. */
  minZoom: number;
  /** Scale at which the whole padded map fits the box. */
  fit: number;
  /** True when the map was too big to fit at MIN_FIT_SCALE and opens on the hub. */
  centredOnHub: boolean;
}

/**
 * Fits the whole map, never zooming past 100 % (a single node stays normal
 * size). When the fit scale would be below 0.4, opens centred on the hub at
 * zoom 0.8 instead; zooming out still shows everything.
 */
export function initialViewport(
  bounds: Bounds | null,
  size: Size,
  hubPos: Point | null
): InitialViewport {
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  if (!bounds) {
    const c = hubPos ?? { x: 0, y: 0 };
    return {
      x: W / 2 - c.x,
      y: H / 2 - c.y,
      zoom: 1,
      minZoom: MIN_ZOOM_FLOOR,
      fit: 1,
      centredOnHub: false,
    };
  }
  const w = bounds.maxX - bounds.minX + 2 * FIT_PAD_X;
  const h = bounds.maxY - bounds.minY + 2 * FIT_PAD_Y;
  const fit = Math.min(W / w, H / h);
  const minZoom = Math.min(MIN_ZOOM_FLOOR, fit);
  if (fit < MIN_FIT_SCALE && hubPos) {
    return {
      x: W / 2 - hubPos.x * HUB_ZOOM,
      y: H / 2 - hubPos.y * HUB_ZOOM,
      zoom: HUB_ZOOM,
      minZoom,
      fit,
      centredOnHub: true,
    };
  }
  const zoom = Math.min(1, fit);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    x: W / 2 - cx * zoom,
    y: H / 2 - cy * zoom,
    zoom,
    minZoom,
    fit,
    centredOnHub: false,
  };
}

/** Labels hide when they would render below 7.5 px. */
export function labelsVisible(zoom: number): boolean {
  return LABEL_PX * zoom >= LABEL_MIN_PX;
}

/** Cuts names longer than 20 characters and appends "…". */
export function truncateName(name: string): string {
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX) + "…" : name;
}
