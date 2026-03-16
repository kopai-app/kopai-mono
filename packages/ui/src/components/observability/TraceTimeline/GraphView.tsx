/**
 * GraphView - SVG-based DAG showing service dependencies within a trace.
 */

import { useMemo } from "react";
import type { ParsedTrace, SpanNode } from "../types.js";
import { getServiceColor } from "../utils/colors.js";

export interface GraphViewProps {
  trace: ParsedTrace;
}

// ── DAG types ──

interface ServiceNode {
  name: string;
  spanCount: number;
  errorCount: number;
  layer: number;
  x: number;
  y: number;
}

interface ServiceEdge {
  from: string;
  to: string;
  callCount: number;
  totalDurationMs: number;
}

// ── DAG construction ──

function buildDAG(trace: ParsedTrace) {
  const nodeMap = new Map<string, { spanCount: number; errorCount: number }>();
  const edgeMap = new Map<
    string,
    { callCount: number; totalDurationMs: number }
  >();
  const childServices = new Map<string, Set<string>>();

  function walk(span: SpanNode, parentService?: string) {
    const svc = span.serviceName;

    const existing = nodeMap.get(svc);
    if (existing) {
      existing.spanCount++;
      if (span.status === "ERROR") existing.errorCount++;
    } else {
      nodeMap.set(svc, {
        spanCount: 1,
        errorCount: span.status === "ERROR" ? 1 : 0,
      });
    }

    if (parentService && parentService !== svc) {
      const key = `${parentService}→${svc}`;
      const edge = edgeMap.get(key);
      if (edge) {
        edge.callCount++;
        edge.totalDurationMs += span.durationMs;
      } else {
        edgeMap.set(key, { callCount: 1, totalDurationMs: span.durationMs });
      }
      if (!childServices.has(parentService))
        childServices.set(parentService, new Set());
      childServices.get(parentService)!.add(svc);
    }

    for (const child of span.children) {
      walk(child, svc);
    }
  }

  for (const root of trace.rootSpans) {
    walk(root);
  }

  const edges: ServiceEdge[] = [];
  for (const [key, meta] of edgeMap) {
    const [from, to] = key.split("→");
    if (from && to) edges.push({ from, to, ...meta });
  }

  return { nodeMap, edges, childServices };
}

// ── Layout ──

const NODE_W = 160;
const NODE_H = 60;
const LAYER_GAP_Y = 100;
const NODE_GAP_X = 40;

function layoutNodes(
  nodeMap: Map<string, { spanCount: number; errorCount: number }>,
  edges: ServiceEdge[]
): ServiceNode[] {
  // Build adjacency for BFS
  const children = new Map<string, Set<string>>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    if (!children.has(e.from)) children.set(e.from, new Set());
    children.get(e.from)!.add(e.to);
    hasParent.add(e.to);
  }

  // Root services = no incoming edges
  const roots = [...nodeMap.keys()].filter((s) => !hasParent.has(s));
  if (roots.length === 0 && nodeMap.size > 0) {
    roots.push(nodeMap.keys().next().value!);
  }

  // BFS to assign layers (with cycle protection)
  const layerOf = new Map<string, number>();
  const enqueueCount = new Map<string, number>();
  const maxEnqueue = nodeMap.size * 2;
  const queue: string[] = [];
  for (const r of roots) {
    layerOf.set(r, 0);
    queue.push(r);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layerOf.get(cur)!;
    const kids = children.get(cur);
    if (!kids) continue;
    for (const kid of kids) {
      const prev = layerOf.get(kid);
      const count = enqueueCount.get(kid) ?? 0;
      if ((prev === undefined || curLayer + 1 > prev) && count < maxEnqueue) {
        layerOf.set(kid, curLayer + 1);
        enqueueCount.set(kid, count + 1);
        queue.push(kid);
      }
    }
  }

  // Any unvisited nodes get layer 0
  for (const name of nodeMap.keys()) {
    if (!layerOf.has(name)) layerOf.set(name, 0);
  }

  // Group by layer
  const layers = new Map<number, string[]>();
  for (const [name, layer] of layerOf) {
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(name);
  }

  // Position
  const nodes: ServiceNode[] = [];
  const maxLayerWidth = Math.max(
    ...Array.from(layers.values()).map((l) => l.length),
    1
  );
  const totalWidth = maxLayerWidth * (NODE_W + NODE_GAP_X) - NODE_GAP_X;

  for (const [layer, names] of layers) {
    const layerWidth = names.length * (NODE_W + NODE_GAP_X) - NODE_GAP_X;
    const offsetX = (totalWidth - layerWidth) / 2;
    names.forEach((name, i) => {
      const meta = nodeMap.get(name)!;
      nodes.push({
        name,
        spanCount: meta.spanCount,
        errorCount: meta.errorCount,
        layer,
        x: offsetX + i * (NODE_W + NODE_GAP_X),
        y: layer * (NODE_H + LAYER_GAP_Y),
      });
    });
  }

  return nodes;
}

// ── Brightness check ──

function isLightColor(hslStr: string): boolean {
  const match = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return false;
  return parseInt(match[3]!, 10) > 55;
}

// ── Component ──

export function GraphView({ trace }: GraphViewProps) {
  const { nodes, edges, svgWidth, svgHeight } = useMemo(() => {
    const { nodeMap, edges } = buildDAG(trace);
    const nodes = layoutNodes(nodeMap, edges);

    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W), NODE_W);
    const maxY = Math.max(...nodes.map((n) => n.y + NODE_H), NODE_H);
    const padding = 40;

    return {
      nodes,
      edges,
      svgWidth: maxX + padding * 2,
      svgHeight: maxY + padding * 2,
    };
  }, [trace]);

  const nodeByName = useMemo(() => {
    const m = new Map<string, ServiceNode>();
    for (const n of nodes) m.set(n.name, n);
    return m;
  }, [nodes]);

  const padding = 40;

  return (
    <div className="flex-1 overflow-auto bg-background p-4 flex justify-center">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
        height={svgHeight}
        role="img"
        aria-label="Service dependency graph"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge) => {
          const from = nodeByName.get(edge.from);
          const to = nodeByName.get(edge.to);
          if (!from || !to) return null;

          const x1 = padding + from.x + NODE_W / 2;
          const y1 = padding + from.y + NODE_H;
          const x2 = padding + to.x + NODE_W / 2;
          const y2 = padding + to.y;

          const midY = (y1 + y2) / 2;

          const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

          return (
            <g key={`${edge.from}→${edge.to}`}>
              <path
                d={d}
                fill="none"
                stroke="#475569"
                strokeWidth={1.5}
                markerEnd="url(#arrowhead)"
              />
              {edge.callCount > 1 && (
                <text
                  x={(x1 + x2) / 2}
                  y={midY - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#94a3b8"
                >
                  {edge.callCount}x
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const color = getServiceColor(node.name);
          const hasError = node.errorCount > 0;
          const textColor = isLightColor(color) ? "#1e293b" : "#f8fafc";
          const nx = padding + node.x;
          const ny = padding + node.y;

          return (
            <g key={node.name}>
              <rect
                x={nx}
                y={ny}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                ry={8}
                fill={color}
                stroke={hasError ? "#ef4444" : "none"}
                strokeWidth={hasError ? 2 : 0}
              />
              <text
                x={nx + NODE_W / 2}
                y={ny + 24}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill={textColor}
              >
                {node.name.length > 18
                  ? node.name.slice(0, 16) + "..."
                  : node.name}
              </text>
              <text
                x={nx + NODE_W / 2}
                y={ny + 44}
                textAnchor="middle"
                fontSize={11}
                fill={textColor}
                opacity={0.85}
              >
                {node.spanCount} span{node.spanCount !== 1 ? "s" : ""}
                {node.errorCount > 0 && ` · ${node.errorCount} err`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
