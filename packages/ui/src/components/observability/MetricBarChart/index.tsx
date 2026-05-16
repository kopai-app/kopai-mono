/**
 * MetricBarChart - Renders categorical bar charts from AggregatedMetricRow[].
 *
 * Accepts pre-aggregated rows of shape `{ groups, value }` (the shape returned
 * by `searchAggregatedMetrics`) and renders them as a Recharts bar chart with
 * one bar per row. Supports vertical (default columns) and horizontal
 * (categories on Y-axis) orientations, optional log scale, and `maxBars`
 * truncation.
 */

import { useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipPayload,
} from "recharts";
import type { denormalizedSignals } from "@kopai/core";
import {
  resolveUnitScale,
  formatTickValue,
  formatDisplayValue,
} from "../utils/units.js";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#00C49F",
  "#0088FE",
];

const NO_VALUE_LABEL = "(no value)";

export interface MetricBarChartProps {
  rows: AggregatedMetricRow[];
  isLoading?: boolean;
  error?: Error;
  orientation?: "horizontal" | "vertical";
  yAxisLabel?: string;
  unit?: string;
  maxBars?: number;
  logScale?: boolean;
  formatValue?: (value: number, unit?: string) => string;
  height?: number;
}

interface BarDatum {
  label: string;
  value: number;
  /** Pre-clamp value preserved so tooltips display the true number even
   *  when `logScale: true` forces `value` up to `Math.max(1, value)`. */
  originalValue: number;
}

function coerceGroupLabel(groups: AggregatedMetricRow["groups"]): string {
  const parts = Object.values(groups).map((v) => {
    if (v === "" || v === null || v === undefined) return NO_VALUE_LABEL;
    return String(v);
  });
  if (parts.length === 0) return NO_VALUE_LABEL;
  return parts.join(" / ");
}

export function MetricBarChart({
  rows,
  isLoading = false,
  error,
  orientation = "vertical",
  yAxisLabel,
  unit,
  maxBars = 20,
  logScale = false,
  formatValue,
  height = 400,
}: MetricBarChartProps) {
  const warnedRef = useRef(false);

  const data: BarDatum[] = useMemo(() => {
    let mapped = rows.map<BarDatum>((row) => ({
      label: coerceGroupLabel(row.groups),
      value: row.value,
      originalValue: row.value,
    }));

    if (logScale) {
      const before = mapped.length;
      mapped = mapped.filter((d) => d.value > 0);
      if (mapped.length < before && !warnedRef.current) {
        warnedRef.current = true;

        console.warn(
          `MetricBarChart: dropped ${before - mapped.length} row(s) with value <= 0 because logScale=true.`
        );
      }
    }

    mapped.sort((a, b) => b.value - a.value);
    return mapped.slice(0, maxBars);
  }, [rows, maxBars, logScale]);

  const maxValue = useMemo(
    () => data.reduce((m, d) => Math.max(m, d.value), 0),
    [data]
  );

  const scale = useMemo(
    () => (unit ? resolveUnitScale(unit, maxValue) : null),
    [unit, maxValue]
  );

  const defaultFormatValue = useMemo(
    () =>
      (v: number, u?: string): string => {
        if (scale) return formatDisplayValue(v, scale);
        if (u) {
          const s = resolveUnitScale(u, Math.abs(v));
          return formatDisplayValue(v, s);
        }
        if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
        if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
        if (Number.isInteger(v)) return v.toString();
        return v.toFixed(2);
      },
    [scale]
  );

  const fmt = formatValue ?? defaultFormatValue;

  if (isLoading) return <BarChartLoadingSkeleton height={height} />;

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-red-800"
        style={{ height }}
        data-testid="metric-bar-chart-error"
      >
        <div className="text-center p-4">
          <p className="text-red-400 font-medium">Error loading bar chart</p>
          <p className="text-red-400 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-gray-800"
        style={{ height }}
        data-testid="metric-bar-chart-empty"
      >
        <p className="text-gray-500">(no data)</p>
      </div>
    );
  }

  const tickFormatter = (v: number) =>
    scale ? formatTickValue(v, scale) : fmt(v, unit);
  const logDomain: [number, "auto"] = [1, "auto"];

  // Clamp values for log scale (recharts/d3 log can't render <= 0)
  const renderData = logScale
    ? data.map((d) => ({ ...d, value: Math.max(1, d.value) }))
    : data;

  const isHorizontal = orientation === "horizontal";

  return (
    <div
      className="bg-background rounded-lg p-4"
      style={{ height }}
      data-testid="metric-bar-chart"
      data-bar-labels={JSON.stringify(renderData.map((d) => d.label))}
      data-bar-orientation={orientation}
      data-bar-layout={isHorizontal ? "vertical" : "horizontal"}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={renderData}
          layout={isHorizontal ? "vertical" : "horizontal"}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
                tickFormatter={tickFormatter}
                scale={logScale ? "log" : "auto"}
                domain={logScale ? logDomain : undefined}
                allowDataOverflow={logScale}
                label={
                  yAxisLabel
                    ? {
                        value: yAxisLabel,
                        position: "insideBottom",
                        fill: "#9CA3AF",
                      }
                    : undefined
                }
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                width={120}
                interval={0}
              />
            </>
          ) : (
            <>
              <XAxis
                type="category"
                dataKey="label"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={70}
              />
              <YAxis
                type="number"
                stroke="#9CA3AF"
                tick={{ fill: "#9CA3AF", fontSize: 12 }}
                tickFormatter={tickFormatter}
                scale={logScale ? "log" : "auto"}
                domain={logScale ? logDomain : undefined}
                allowDataOverflow={logScale}
                label={
                  yAxisLabel
                    ? {
                        value: yAxisLabel,
                        angle: -90,
                        position: "insideLeft",
                        fill: "#9CA3AF",
                      }
                    : undefined
                }
              />
            </>
          )}
          <Tooltip
            content={(props: {
              active?: boolean;
              payload?: TooltipPayload;
            }) => {
              if (!props.active || !props.payload?.length) return null;
              const datum = props.payload[0]?.payload as BarDatum | undefined;
              if (!datum) return null;
              return (
                <div className="bg-background border border-gray-700 rounded-lg p-3 shadow-lg">
                  <p className="text-gray-300 text-sm font-medium mb-1">
                    {datum.label}
                  </p>
                  <p className="text-white text-sm">
                    {fmt(datum.originalValue ?? datum.value, unit)}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {renderData.map((_, i) => (
              <Cell
                key={`cell-${i}`}
                fill={
                  renderData.length > 1 ? COLORS[i % COLORS.length] : COLORS[0]
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarChartLoadingSkeleton({ height = 400 }: { height?: number }) {
  return (
    <div
      className="bg-background rounded-lg p-4 animate-pulse border border-gray-800"
      style={{ height }}
      data-testid="metric-bar-chart-loading"
    >
      <div className="h-full flex flex-col">
        <div className="flex flex-1 gap-2">
          <div className="flex flex-col justify-between w-12">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 w-8 bg-gray-700 rounded" />
            ))}
          </div>
          <div className="flex-1 flex items-end justify-around gap-2 pb-8">
            {[40, 70, 55, 90, 30, 60].map((h, i) => (
              <div
                key={i}
                className="w-8 bg-gray-700 rounded-t"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
