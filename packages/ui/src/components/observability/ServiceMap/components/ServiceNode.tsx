/**
 * One node of the Service Map (React Flow custom node).
 *
 * Shape by kind (circle = service, rounded square = database, diamond =
 * queue, dashed circle = external), size from fixed log breakpoints of the
 * span count, a ring on the hub, an error cue that is a glyph as well as a
 * colour, dimmed when it had no traffic in the past 60 min, and a label that
 * hides below the level-of-detail zoom unless the node is hovered or found.
 *
 * The node box is exactly the shape; the label hangs below it absolutely, so
 * React Flow measures the shape only and edges attach to it.
 */
import { memo } from "react";
import {
  Handle,
  Position,
  useStore,
  type Node,
  type NodeProps,
  type ReactFlowState,
} from "@xyflow/react";
import type { NodeKind } from "../engine/types.js";
import { labelsVisible, truncateName } from "../layout/viewport.js";
import { getServiceColor, getServiceLabelColor } from "../../utils/colors.js";
import {
  DIM_OPACITY,
  VIRTUAL_FILL,
  VIRTUAL_STROKE,
  errorLevel,
  nodeSize,
} from "./edge-style.js";

export interface ServiceNodeData extends Record<string, unknown> {
  /** Display name (service name, or "postgres · orders" for a virtual node). */
  label: string;
  kind: NodeKind;
  spans: number;
  errorRate: number;
  active: boolean;
  hub: boolean;
  /** Selected through Find: highlighted and its label forced visible. */
  found: boolean;
  /** In the "Not connected to the map yet" tray. */
  inTray: boolean;
  /** Clicking the node opens its traces. */
  clickable?: boolean;
}

export type ServiceFlowNode = Node<ServiceNodeData, "service">;

const selectLabelsVisible = (s: ReactFlowState) =>
  labelsVisible(s.transform[2]);

function Shape({
  kind,
  size,
  fill,
  stroke,
  strokeWidth,
}: {
  kind: NodeKind;
  size: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}) {
  const c = size / 2;
  const r = c - strokeWidth / 2;
  const common = { fill, stroke, strokeWidth };
  let shape;
  if (kind === "database") {
    shape = (
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={size - strokeWidth}
        height={size - strokeWidth}
        rx={size * 0.18}
        {...common}
      />
    );
  } else if (kind === "messaging") {
    shape = (
      <polygon
        points={`${c},${strokeWidth / 2} ${size - strokeWidth / 2},${c} ${c},${size - strokeWidth / 2} ${strokeWidth / 2},${c}`}
        strokeLinejoin="round"
        {...common}
      />
    );
  } else {
    shape = (
      <circle
        cx={c}
        cy={c}
        r={r}
        strokeDasharray={kind === "external" ? "3 2.5" : undefined}
        {...common}
      />
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block overflow-visible"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

function ServiceNodeImpl({ data }: NodeProps<ServiceFlowNode>) {
  const zoomLabels = useStore(selectLabelsVisible);
  const size = nodeSize(data.kind, data.spans);
  const err = errorLevel(data.errorRate);
  const isService = data.kind === "service";
  // A service keeps the colour it has in the traces and logs views: filled
  // with getServiceColor, rimmed and labelled with the lighter label colour.
  // Errors are shown by the "!" badge only, so they never hide that colour.
  const stroke = isService ? getServiceLabelColor(data.label) : VIRTUAL_STROKE;
  const fill = isService ? getServiceColor(data.label) : VIRTUAL_FILL;
  const strokeWidth = data.hub ? 2.6 : 1.6;
  const showLabel = zoomLabels || data.found || data.hub;
  const classes = [
    "sm-node group relative",
    `sm-kind-${data.kind}`,
    data.hub ? "sm-hub" : "",
    data.found ? "sm-found" : "",
    data.active ? "" : "sm-dim",
    data.clickable ? "cursor-pointer" : "",
    err !== "none" ? `sm-err-${err}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{
        width: size,
        height: size,
        opacity: data.active ? 1 : DIM_OPACITY,
      }}
      data-testid={`sm-node-${data.label}`}
      data-active={data.active ? "true" : "false"}
    >
      {data.hub && (
        <span
          className="sm-hub-ring pointer-events-none absolute rounded-full border-2 border-foreground/80"
          style={{ inset: -6 }}
          aria-hidden="true"
        />
      )}
      {data.found && (
        <span
          className="pointer-events-none absolute animate-pulse rounded-full border-2 border-sky-400"
          style={{ inset: -10 }}
          aria-hidden="true"
        />
      )}
      <Shape
        kind={data.kind}
        size={size}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <span
        className={[
          "sm-label pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11.5px] leading-none",
          isService ? "" : "text-foreground",
          data.hub ? "font-semibold" : "",
          showLabel ? "" : "hidden group-hover:block",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          top: size + 5,
          color: isService ? getServiceLabelColor(data.label) : undefined,
          textShadow:
            "0 0 3px hsl(var(--background)), 0 0 3px hsl(var(--background)), 0 0 2px hsl(var(--background))",
        }}
      >
        {truncateName(data.label)}
      </span>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="sm-handle"
        style={{ opacity: 0, left: 0, border: 0, width: 1, height: 1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="sm-handle"
        style={{ opacity: 0, right: 0, border: 0, width: 1, height: 1 }}
      />
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeImpl);
