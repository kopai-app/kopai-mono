/**
 * MetricTimeSeries - Accepts OtelMetricsRow[] and renders line charts.
 */

import { useMemo, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush,
  ReferenceLine,
} from "recharts";
import type { denormalizedSignals } from "@kopai/core";
import type {
  ParsedMetricGroup,
  MetricSeries,
  RechartsDataPoint,
} from "../types.js";
import { downsampleLTTB, type LTTBPoint } from "../utils/lttb.js";
import { formatSeriesLabel } from "../utils/attributes.js";
import {
  resolveUnitScale,
  formatTickValue,
  formatDisplayValue,
} from "../utils/units.js";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#00C49F",
  "#0088FE",
  "#FFBB28",
  "#FF8042",
  "#a4de6c",
  "#d0ed57",
];

export interface ThresholdLine {
  value: number;
  color: string;
  label?: string;
  style?: "solid" | "dashed" | "dotted";
}

export interface MetricTimeSeriesProps {
  rows: OtelMetricsRow[];
  isLoading?: boolean;
  error?: Error;
  maxDataPoints?: number;
  showBrush?: boolean;
  height?: number;
  unit?: string;
  yAxisLabel?: string;
  formatTime?: (timestamp: number) => string;
  formatValue?: (value: number) => string;
  onBrushChange?: (startTime: number, endTime: number) => void;
  legendMaxLength?: number;
  thresholdLines?: ThresholdLine[];
}

const defaultFormatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

function getStrokeDashArray(
  style?: "solid" | "dashed" | "dotted"
): string | undefined {
  if (style === "solid") return undefined;
  if (style === "dotted") return "2 2";
  return "5 5";
}

/** Build metrics from denormalized rows */
function buildMetrics(rows: OtelMetricsRow[]): ParsedMetricGroup[] {
  const metricMap = new Map<string, Map<string, MetricSeries>>();
  const metricMeta = new Map<
    string,
    { description: string; unit: string; type: string; serviceName: string }
  >();

  for (const row of rows) {
    const name = row.MetricName ?? "unknown";
    const type = row.MetricType;

    // Extract scalar value depending on metric type
    let value: number | undefined;
    if (type === "Gauge" || type === "Sum") {
      value = "Value" in row ? row.Value : undefined;
    } else if (
      type === "Histogram" ||
      type === "ExponentialHistogram" ||
      type === "Summary"
    ) {
      // Use mean (Sum/Count) for distribution metrics
      const sum = "Sum" in row ? (row as { Sum?: number }).Sum : undefined;
      const count =
        "Count" in row ? (row as { Count?: number }).Count : undefined;
      if (sum != null && count != null && count > 0) {
        value = sum / count;
      } else if (count != null) {
        value = count;
      }
    }

    if (value === undefined) continue;

    if (!metricMap.has(name)) metricMap.set(name, new Map());
    if (!metricMeta.has(name))
      metricMeta.set(name, {
        description: row.MetricDescription ?? "",
        unit: row.MetricUnit ?? "",
        type,
        serviceName: row.ServiceName ?? "unknown",
      });

    const seriesKey = row.Attributes
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(row.Attributes).sort(([a], [b]) =>
              a.localeCompare(b)
            )
          )
        )
      : "__default__";
    const seriesMap = metricMap.get(name)!;

    if (!seriesMap.has(seriesKey)) {
      const labels: Record<string, string> = {};
      if (row.Attributes) {
        for (const [k, v] of Object.entries(row.Attributes))
          labels[k] = String(v);
      }
      seriesMap.set(seriesKey, {
        key: seriesKey === "__default__" ? name : seriesKey,
        labels,
        dataPoints: [],
      });
    }

    const timestamp = parseInt(row.TimeUnix, 10) / 1e6;
    seriesMap.get(seriesKey)!.dataPoints.push({ timestamp, value });
  }

  const results: ParsedMetricGroup[] = [];
  for (const [name, seriesMap] of metricMap) {
    const meta = metricMeta.get(name)!;
    const series = Array.from(seriesMap.values());
    for (const s of series)
      s.dataPoints.sort((a, b) => a.timestamp - b.timestamp);
    results.push({
      name,
      description: meta.description,
      unit: meta.unit,
      type: meta.type as ParsedMetricGroup["type"],
      series,
      serviceName: meta.serviceName,
    });
  }
  return results;
}

function toRechartsData(metrics: ParsedMetricGroup[]): RechartsDataPoint[] {
  const timestampMap = new Map<number, RechartsDataPoint>();
  for (const metric of metrics) {
    for (const series of metric.series) {
      const seriesName =
        series.key === "__default__" ? metric.name : series.key;
      for (const dp of series.dataPoints) {
        if (!timestampMap.has(dp.timestamp))
          timestampMap.set(dp.timestamp, { timestamp: dp.timestamp });
        timestampMap.get(dp.timestamp)![seriesName] = dp.value;
      }
    }
  }
  return Array.from(timestampMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );
}

function getSeriesKeys(metrics: ParsedMetricGroup[]): string[] {
  const keys = new Set<string>();
  for (const m of metrics)
    for (const s of m.series)
      keys.add(s.key === "__default__" ? m.name : s.key);
  return Array.from(keys);
}

function buildDisplayLabelMap(
  metrics: ParsedMetricGroup[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of metrics) {
    for (const s of m.series) {
      const dataKey = s.key === "__default__" ? m.name : s.key;
      const label = formatSeriesLabel(s.labels);
      map.set(dataKey, label || m.name);
    }
  }
  return map;
}

function downsampleRechartsData(
  data: RechartsDataPoint[],
  seriesKeys: string[],
  maxPoints: number
): RechartsDataPoint[] {
  if (data.length <= maxPoints) return data;
  const timestamps = new Set<number>();
  for (const key of seriesKeys) {
    const pts: LTTBPoint[] = [];
    for (const d of data) {
      const v = d[key];
      if (v !== undefined) pts.push({ x: d.timestamp, y: v });
    }
    if (pts.length === 0) continue;
    const ds = downsampleLTTB(pts, Math.ceil(maxPoints / seriesKeys.length));
    for (const p of ds) timestamps.add(p.x);
  }
  return data.filter((d) => timestamps.has(d.timestamp));
}

export function MetricTimeSeries({
  rows,
  isLoading = false,
  error,
  maxDataPoints = 500,
  showBrush = true,
  height = 400,
  unit: unitProp,
  yAxisLabel,
  formatTime = defaultFormatTime,
  formatValue,
  onBrushChange,
  legendMaxLength = 30,
  thresholdLines,
}: MetricTimeSeriesProps) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const parsedMetrics = useMemo(() => buildMetrics(rows), [rows]);
  const effectiveUnit = unitProp ?? parsedMetrics[0]?.unit ?? "";
  const chartData = useMemo(
    () => toRechartsData(parsedMetrics),
    [parsedMetrics]
  );
  const seriesKeys = useMemo(
    () => getSeriesKeys(parsedMetrics),
    [parsedMetrics]
  );
  const displayLabelMap = useMemo(
    () => buildDisplayLabelMap(parsedMetrics),
    [parsedMetrics]
  );
  const displayData = useMemo(
    () => downsampleRechartsData(chartData, seriesKeys, maxDataPoints),
    [chartData, seriesKeys, maxDataPoints]
  );

  const { tickFormatter, displayFormatter, resolvedYAxisLabel } =
    useMemo(() => {
      let max = 0;
      for (const dp of displayData) {
        for (const key of seriesKeys) {
          const v = dp[key];
          if (v !== undefined && Math.abs(v) > max) max = Math.abs(v);
        }
      }
      const scale = resolveUnitScale(effectiveUnit, max);
      return {
        tickFormatter:
          formatValue ?? ((v: number) => formatTickValue(v, scale)),
        displayFormatter:
          formatValue ?? ((v: number) => formatDisplayValue(v, scale)),
        resolvedYAxisLabel: yAxisLabel ?? (scale.label || undefined),
      };
    }, [displayData, seriesKeys, effectiveUnit, formatValue, yAxisLabel]);

  const handleLegendClick = useCallback((dataKey: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  }, []);

  const handleBrushChange = useCallback(
    (brushData: { startIndex?: number; endIndex?: number }) => {
      if (!onBrushChange || !displayData.length) return;
      const { startIndex, endIndex } = brushData;
      if (startIndex === undefined || endIndex === undefined) return;
      const sp = displayData[startIndex],
        ep = displayData[endIndex];
      if (sp && ep) onBrushChange(sp.timestamp, ep.timestamp);
    },
    [displayData, onBrushChange]
  );

  if (isLoading) return <MetricLoadingSkeleton height={height} />;

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-red-800"
        style={{ height }}
      >
        <div className="text-center p-4">
          <p className="text-red-400 font-medium">Error loading metrics</p>
          <p className="text-gray-500 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0 || displayData.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-gray-800"
        style={{ height }}
      >
        <p className="text-gray-500">No metric data available</p>
      </div>
    );
  }

  return (
    <div
      className="bg-background rounded-lg p-4"
      style={{ height }}
      data-testid="metric-time-series"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={displayData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            stroke="#9CA3AF"
            tick={{ fill: "#9CA3AF", fontSize: 12 }}
          />
          <YAxis
            tickFormatter={tickFormatter}
            stroke="#9CA3AF"
            tick={{ fill: "#9CA3AF", fontSize: 12 }}
            label={
              resolvedYAxisLabel
                ? {
                    value: resolvedYAxisLabel,
                    angle: -90,
                    position: "insideLeft",
                    fill: "#9CA3AF",
                  }
                : undefined
            }
          />
          <Tooltip
            content={(props) => (
              <CustomTooltip
                {...props}
                formatTime={formatTime}
                formatValue={displayFormatter}
                displayLabelMap={displayLabelMap}
              />
            )}
          />
          <Legend
            onClick={(e) => {
              const dk = e?.dataKey;
              if (typeof dk === "string") handleLegendClick(dk);
            }}
            formatter={(value: string) => {
              const label = displayLabelMap.get(value) ?? value;
              const truncated =
                label.length > legendMaxLength
                  ? label.slice(0, legendMaxLength - 3) + "..."
                  : label;
              const isHidden = hiddenSeries.has(value);
              return (
                <span
                  style={{
                    color: isHidden ? "#6B7280" : "#E5E7EB",
                    textDecoration: isHidden ? "line-through" : "none",
                    cursor: "pointer",
                  }}
                  title={truncated !== label ? label : undefined}
                >
                  {truncated}
                </span>
              );
            }}
          />
          {thresholdLines?.map((t, i) => (
            <ReferenceLine
              key={`t-${i}`}
              y={t.value}
              stroke={t.color}
              strokeDasharray={getStrokeDashArray(t.style)}
              strokeWidth={1.5}
              label={
                t.label
                  ? {
                      value: t.label,
                      position: "right",
                      fill: t.color,
                      fontSize: 11,
                    }
                  : undefined
              }
            />
          ))}
          {seriesKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              hide={hiddenSeries.has(key)}
              connectNulls
            />
          ))}
          {showBrush && displayData.length > 10 && (
            <Brush
              dataKey="timestamp"
              height={30}
              stroke="#6B7280"
              fill="#1F2937"
              tickFormatter={formatTime}
              onChange={handleBrushChange}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
  formatTime,
  formatValue,
  displayLabelMap,
}: {
  active?: boolean;
  payload?: readonly { dataKey: string; value: number; color: string }[];
  label?: string | number;
  formatTime: (ts: number) => string;
  formatValue: (val: number) => string;
  displayLabelMap: Map<string, string>;
}) {
  if (!active || !payload || label == null) return null;
  const ts = typeof label === "number" ? label : Number(label);
  return (
    <div className="bg-background border border-gray-700 rounded-lg p-3 shadow-lg">
      <p className="text-gray-400 text-xs mb-2">{formatTime(ts)}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm" style={{ color: entry.color }}>
          <span className="font-medium">
            {displayLabelMap.get(entry.dataKey) ?? entry.dataKey}:
          </span>{" "}
          {formatValue(entry.value)}
        </p>
      ))}
    </div>
  );
}

function MetricLoadingSkeleton({ height = 400 }: { height?: number }) {
  return (
    <div
      className="bg-background rounded-lg p-4 animate-pulse"
      style={{ height }}
      data-testid="metric-time-series-loading"
    >
      <div className="h-full flex flex-col">
        <div className="flex flex-1 gap-2">
          <div className="flex flex-col justify-between w-12">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 w-8 bg-gray-700 rounded" />
            ))}
          </div>
          <div className="flex-1 relative">
            <div className="absolute inset-0 flex flex-col justify-between">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-px bg-gray-800" />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-between mt-2 px-14">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-3 w-12 bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
