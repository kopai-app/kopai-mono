/**
 * MetricStat - Accepts OtelMetricsRow[] and renders stat cards with optional sparklines.
 */

import { useMemo } from "react";
import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";
import type { denormalizedSignals } from "@kopai/core";
import type { MetricDataPoint } from "../types.js";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

export interface ThresholdConfig {
  value: number;
  color: "green" | "yellow" | "red" | string;
}

export interface MetricStatProps {
  rows: OtelMetricsRow[];
  isLoading?: boolean;
  error?: Error;
  label?: string;
  formatValue?: (value: number, unit: string) => string;
  showTimestamp?: boolean;
  trend?: "up" | "down" | "neutral";
  trendValue?: number;
  className?: string;
  showSparkline?: boolean;
  sparklinePoints?: number;
  sparklineHeight?: number;
  thresholds?: ThresholdConfig[];
  colorBackground?: boolean;
  colorValue?: boolean;
}

const THRESHOLD_COLORS: Record<
  string,
  { bg: string; border: string; text: string; stroke: string; fill: string }
> = {
  green: {
    bg: "bg-green-900/20",
    border: "border-green-700",
    text: "text-green-400",
    stroke: "#4ade80",
    fill: "#22c55e",
  },
  yellow: {
    bg: "bg-yellow-900/20",
    border: "border-yellow-700",
    text: "text-yellow-400",
    stroke: "#facc15",
    fill: "#eab308",
  },
  red: {
    bg: "bg-red-900/20",
    border: "border-red-700",
    text: "text-red-400",
    stroke: "#f87171",
    fill: "#ef4444",
  },
  gray: {
    bg: "bg-background",
    border: "border-gray-800",
    text: "text-gray-400",
    stroke: "#9ca3af",
    fill: "#6b7280",
  },
};

function getColorConfig(color: string) {
  return (
    THRESHOLD_COLORS[color] ?? {
      bg: "bg-background",
      border: "border-gray-800",
      text: "text-gray-400",
      stroke: color,
      fill: color,
    }
  );
}

function getThresholdColor(
  value: number,
  thresholds: ThresholdConfig[]
): string {
  const sorted = [...thresholds].sort((a, b) => a.value - b.value);
  for (const t of sorted) if (value < t.value) return t.color;
  return sorted[sorted.length - 1]?.color ?? "gray";
}

const defaultFormatValue = (value: number, unit: string): string => {
  let formatted: string;
  if (Math.abs(value) >= 1e6) formatted = `${(value / 1e6).toFixed(1)}M`;
  else if (Math.abs(value) >= 1e3) formatted = `${(value / 1e3).toFixed(1)}K`;
  else if (Number.isInteger(value)) formatted = value.toString();
  else formatted = value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
};

function buildStatData(rows: OtelMetricsRow[]): {
  latestValue: number | null;
  unit: string;
  timestamp: number;
  dataPoints: MetricDataPoint[];
  metricName: string;
} {
  let latestTimestamp = 0;
  let latestValue: number | null = null;
  let unit = "";
  let metricName = "Metric";
  const dataPoints: MetricDataPoint[] = [];

  for (const row of rows) {
    if (
      row.MetricType === "Histogram" ||
      row.MetricType === "ExponentialHistogram" ||
      row.MetricType === "Summary"
    )
      continue;
    const timestamp = parseInt(row.TimeUnix, 10) / 1e6;
    const value = "Value" in row ? row.Value : 0;
    if (!unit && row.MetricUnit) unit = row.MetricUnit;
    if (!metricName || metricName === "Metric")
      metricName = row.MetricName ?? "Metric";
    dataPoints.push({ timestamp, value });
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestValue = value;
    }
  }

  dataPoints.sort((a, b) => a.timestamp - b.timestamp);
  return {
    latestValue,
    unit,
    timestamp: latestTimestamp,
    dataPoints,
    metricName,
  };
}

export function MetricStat({
  rows,
  isLoading = false,
  error,
  label,
  formatValue = defaultFormatValue,
  showTimestamp = false,
  trend,
  trendValue,
  className = "",
  showSparkline = false,
  sparklinePoints = 20,
  sparklineHeight = 40,
  thresholds,
  colorBackground,
  colorValue = false,
}: MetricStatProps) {
  const { latestValue, unit, timestamp, dataPoints, metricName } = useMemo(
    () => buildStatData(rows),
    [rows]
  );

  const sparklineData = useMemo(() => {
    if (!showSparkline || dataPoints.length === 0) return [];
    return dataPoints
      .slice(-sparklinePoints)
      .map((dp) => ({ value: dp.value }));
  }, [dataPoints, showSparkline, sparklinePoints]);

  const thresholdColor = useMemo(() => {
    if (!thresholds || latestValue === null) return "gray";
    return getThresholdColor(latestValue, thresholds);
  }, [thresholds, latestValue]);

  const colorConfig = getColorConfig(thresholdColor);
  const shouldColorBackground = colorBackground ?? thresholds !== undefined;
  const displayLabel = label ?? metricName;
  const bgClass = shouldColorBackground ? colorConfig.bg : "bg-background";
  const borderClass = shouldColorBackground
    ? `border ${colorConfig.border}`
    : "";
  const valueClass = colorValue ? colorConfig.text : "text-white";

  if (isLoading) {
    return (
      <div
        className={`bg-background rounded-lg p-4 animate-pulse ${className}`}
        data-testid="metric-stat-loading"
      >
        <div className="h-4 w-24 bg-gray-700 rounded mb-2" />
        <div className="h-10 w-32 bg-gray-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-red-800 ${className}`}
        data-testid="metric-stat-error"
      >
        <p className="text-red-400 text-sm">{error.message}</p>
      </div>
    );
  }

  if (latestValue === null) {
    return (
      <div
        className={`bg-background rounded-lg p-4 border border-gray-800 ${className}`}
        data-testid="metric-stat-empty"
      >
        <p className="text-gray-500 text-sm">{displayLabel}</p>
        <p className="text-gray-600 text-2xl font-semibold">--</p>
      </div>
    );
  }

  return (
    <div
      className={`${bgClass} ${borderClass} rounded-lg p-4 ${className}`}
      data-testid="metric-stat"
    >
      <div className="flex items-center justify-between mb-1">
        <p className="text-gray-400 text-sm font-medium">{displayLabel}</p>
        {trend && <TrendIndicator direction={trend} value={trendValue} />}
      </div>
      <p className={`${valueClass} text-3xl font-bold`}>
        {formatValue(latestValue, unit)}
      </p>
      {showTimestamp && (
        <p className="text-gray-500 text-xs mt-1">
          {new Date(timestamp).toLocaleTimeString()}
        </p>
      )}
      {showSparkline && sparklineData.length > 0 && (
        <div className="mt-2" style={{ height: sparklineHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={sparklineData}
              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
            >
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke={colorConfig.stroke}
                fill={colorConfig.fill}
                fillOpacity={0.3}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TrendIndicator({
  direction,
  value,
}: {
  direction: "up" | "down" | "neutral";
  value?: number;
}) {
  const colorClass =
    direction === "up"
      ? "text-green-400"
      : direction === "down"
        ? "text-red-400"
        : "text-gray-400";
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  return (
    <span className={`text-sm font-medium ${colorClass}`}>
      {arrow}
      {value !== undefined && ` ${Math.abs(value).toFixed(1)}%`}
    </span>
  );
}
