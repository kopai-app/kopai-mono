/** Layout D geometry (plan §2.2, PR §5.5). All values are in flow units (px at zoom 1). */

/** Vertical distance between two rows of one lane. */
export const ROW = 64;
/** Width of one lane inside a column. */
export const LANE = 170;
/** Gap between two neighbouring columns. */
export const COL_GAP = 50;
/** Horizontal distance between two tray slots. */
export const TRAY_COL = 160;
/** Vertical distance between two tray rows. */
export const TRAY_ROW = 54;
/** Gap between the last reserved row and the first tray row. */
export const TRAY_GAP = 70;
/** The tray always has at least this many slots per row. */
export const TRAY_MIN_PER_ROW = 4;

/** Lanes hold K = clamp(ceil(sqrt(N)), K_MIN, K_MAX) rows. */
export const K_MIN = 6;
export const K_MAX = 14;
/** Lane penalty in the row score `|r − dRow| + LANE_PENALTY × lane`. */
export const LANE_PENALTY = 2.5;

/** Below this whole-graph fit scale the view opens centred on the hub. */
export const MIN_FIT_SCALE = 0.4;
/** Zoom used when the view opens centred on the hub. */
export const HUB_ZOOM = 0.8;
/** Smallest minZoom the canvas ever gets. */
export const MIN_ZOOM_FLOOR = 0.05;
/** Labels hide when they would render smaller than this (px). */
export const LABEL_MIN_PX = 7.5;
/** Label font size at zoom 1 (px). */
export const LABEL_PX = 11.5;
/** Names longer than this are truncated with "…". */
export const NAME_MAX = 20;
/** Padding added around the node centres when fitting. */
export const FIT_PAD_X = 100;
export const FIT_PAD_Y = 40;
