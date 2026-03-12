/**
 * ScatterPlot - Scatter chart showing trace duration vs timestamp.
 */

import { useMemo, useCallback } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { TraceSummary } from "./index.js";
import { getServiceColor } from "../utils/colors.js";
import { formatDuration, formatTimestamp } from "../utils/time.js";

export interface ScatterPlotProps {
  traces: TraceSummary[];
  onSelectTrace: (traceId: string) => void;
}

interface ScatterPoint {
  x: number;
  y: number;
  traceId: string;
  serviceName: string;
  rootSpanName: string;
  spanCount: number;
  hasError: boolean;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-foreground">
        {d.serviceName}: {d.rootSpanName}
      </div>
      <div className="text-muted-foreground mt-1">
        {d.spanCount} span{d.spanCount !== 1 ? "s" : ""} &middot;{" "}
        {formatDuration(d.y)}
      </div>
      <div className="text-muted-foreground">{formatTimestamp(d.x)}</div>
    </div>
  );
}

export function ScatterPlot({ traces, onSelectTrace }: ScatterPlotProps) {
  const data = useMemo<ScatterPoint[]>(
    () =>
      traces.map((t) => ({
        x: t.timestampMs,
        y: t.durationMs,
        traceId: t.traceId,
        serviceName: t.serviceName,
        rootSpanName: t.rootSpanName,
        spanCount: t.spanCount,
        hasError: t.errorCount > 0,
      })),
    [traces]
  );

  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (entry: any) => {
      const payload = entry?.payload as ScatterPoint | undefined;
      if (payload?.traceId) {
        onSelectTrace(payload.traceId);
      }
    },
    [onSelectTrace]
  );

  if (traces.length === 0) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-background">
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.4}
          />
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => {
              const d = new Date(v);
              return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
            }}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--border))"
            name="Time"
          />
          <YAxis
            dataKey="y"
            type="number"
            tickFormatter={(v: number) => formatDuration(v)}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            stroke="hsl(var(--border))"
            name="Duration"
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter data={data} onClick={handleClick} cursor="pointer">
            {data.map((point, i) => (
              <Cell
                key={i}
                fill={
                  point.hasError
                    ? "#ef4444"
                    : getServiceColor(point.serviceName)
                }
                stroke={point.hasError ? "#ef4444" : "none"}
                strokeWidth={point.hasError ? 2 : 0}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
