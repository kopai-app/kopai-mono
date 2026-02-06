/**
 * MetricHistogram - Accepts OtelMetricsRow[] and renders histogram bar charts.
 */

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#00C49F",
  "#0088FE",
];

export interface MetricHistogramProps {
  rows: OtelMetricsRow[];
  isLoading?: boolean;
  error?: Error;
  height?: number;
  yAxisLabel?: string;
  showLegend?: boolean;
  formatBucketLabel?: (
    bound: number,
    index: number,
    bounds: number[]
  ) => string;
  formatValue?: (value: number) => string;
  labelStyle?: "rotated" | "staggered" | "abbreviated";
}

interface BucketData {
  bucket: string;
  lowerBound: number;
  upperBound: number;
  [seriesKey: string]: number | string;
}

const defaultFormatBucketLabel = (
  bound: number,
  index: number,
  bounds: number[]
): string => {
  if (index === 0) return `≤${bound}`;
  if (index === bounds.length) return `>${bounds[bounds.length - 1]}`;
  return `${bounds[index - 1]}-${bound}`;
};

const defaultFormatValue = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
};

function buildHistogramData(
  rows: OtelMetricsRow[],
  formatLabel = defaultFormatBucketLabel
): { buckets: BucketData[]; seriesKeys: string[] } {
  const buckets: BucketData[] = [];
  const seriesKeysSet = new Set<string>();

  for (const row of rows) {
    if (row.MetricType !== "Histogram") continue;
    const name = row.MetricName ?? "count";
    const key = row.Attributes ? JSON.stringify(row.Attributes) : "__default__";
    const seriesName = key === "__default__" ? name : key;
    seriesKeysSet.add(seriesName);

    const bounds = row.ExplicitBounds ?? [];
    const counts = row.BucketCounts ?? [];

    for (let i = 0; i < counts.length; i++) {
      const count = counts[i] ?? 0;
      const upperBound = i < bounds.length ? bounds[i]! : Infinity;
      const bucketLabel = formatLabel(upperBound, i, bounds);

      let bucket = buckets.find((b) => b.bucket === bucketLabel);
      if (!bucket) {
        bucket = {
          bucket: bucketLabel,
          lowerBound: i === 0 ? 0 : (bounds[i - 1] ?? 0),
          upperBound: bounds[i] ?? Infinity,
        };
        buckets.push(bucket);
      }
      bucket[seriesName] = ((bucket[seriesName] as number) ?? 0) + count;
    }
  }

  buckets.sort((a, b) => a.lowerBound - b.lowerBound);
  return { buckets, seriesKeys: Array.from(seriesKeysSet) };
}

export function MetricHistogram({
  rows,
  isLoading = false,
  error,
  height = 400,
  yAxisLabel,
  showLegend = true,
  formatBucketLabel,
  formatValue = defaultFormatValue,
  labelStyle = "staggered",
}: MetricHistogramProps) {
  const bucketLabelFormatter = formatBucketLabel ?? defaultFormatBucketLabel;
  const unit = useMemo(() => {
    for (const r of rows)
      if (r.MetricType === "Histogram" && r.MetricUnit) return r.MetricUnit;
    return "";
  }, [rows]);

  const { buckets, seriesKeys } = useMemo(() => {
    if (rows.length === 0) return { buckets: [], seriesKeys: [] };
    return buildHistogramData(rows, bucketLabelFormatter);
  }, [rows, bucketLabelFormatter]);

  if (isLoading) return <HistogramLoadingSkeleton height={height} />;

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900 rounded-lg border border-red-800"
        style={{ height }}
      >
        <div className="text-center p-4">
          <p className="text-red-400 font-medium">Error loading histogram</p>
          <p className="text-gray-500 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0 || buckets.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900 rounded-lg border border-gray-800"
        style={{ height }}
      >
        <p className="text-gray-500">No histogram data available</p>
      </div>
    );
  }

  return (
    <div
      className="bg-gray-900 rounded-lg p-4"
      style={{ height }}
      data-testid="metric-histogram"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={buckets}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="bucket"
            stroke="#9CA3AF"
            tick={
              labelStyle === "staggered"
                ? (props: {
                    x?: number;
                    y?: number;
                    payload?: { value: string; index: number };
                  }) => {
                    if (!props.payload) return <g />;
                    const yOffset = props.payload.index % 2 === 0 ? 0 : 12;
                    return (
                      <g transform={`translate(${props.x},${props.y})`}>
                        <text
                          x={0}
                          y={yOffset}
                          dy={12}
                          textAnchor="middle"
                          fill="#9CA3AF"
                          fontSize={11}
                        >
                          {props.payload.value}
                        </text>
                      </g>
                    );
                  }
                : { fill: "#9CA3AF", fontSize: 11 }
            }
            angle={labelStyle === "rotated" ? -45 : 0}
            textAnchor={labelStyle === "rotated" ? "end" : "middle"}
            height={labelStyle === "staggered" ? 50 : 60}
            interval={0}
          />
          <YAxis
            tickFormatter={formatValue}
            stroke="#9CA3AF"
            tick={{ fill: "#9CA3AF", fontSize: 12 }}
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
          <Tooltip
            content={<HistogramTooltip formatValue={formatValue} unit={unit} />}
          />
          {showLegend && seriesKeys.length > 1 && <Legend />}
          {seriesKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={COLORS[i % COLORS.length]}
              radius={[4, 4, 0, 0]}
            >
              {buckets.map((_, bi) => (
                <Cell key={`cell-${bi}`} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HistogramTooltip({
  active,
  payload,
  formatValue,
  unit,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload: BucketData;
  }>;
  formatValue: (val: number) => string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 shadow-lg">
      <p className="text-gray-300 text-sm font-medium mb-2">
        Bucket: {bucket.bucket}
        {unit ? ` ${unit}` : ""}
      </p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm" style={{ color: entry.color }}>
          <span className="font-medium">{entry.dataKey}:</span>{" "}
          {formatValue(entry.value)} requests
        </p>
      ))}
    </div>
  );
}

function HistogramLoadingSkeleton({ height = 400 }: { height?: number }) {
  return (
    <div
      className="bg-gray-900 rounded-lg p-4 animate-pulse"
      style={{ height }}
      data-testid="metric-histogram-loading"
    >
      <div className="h-full flex flex-col">
        <div className="flex flex-1 gap-2">
          <div className="flex flex-col justify-between w-12">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 w-8 bg-gray-700 rounded" />
            ))}
          </div>
          <div className="flex-1 flex items-end justify-around gap-2 pb-8">
            {[30, 50, 80, 65, 45, 25, 15, 8].map((h, i) => (
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
