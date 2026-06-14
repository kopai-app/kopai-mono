/**
 * MetricDonutChart - Accepts AggregatedMetricRow[] and renders a donut chart
 * showing proportional breakdown across groups. Used by the Claude Code
 * dashboard for token distribution (cacheRead vs cacheCreation vs output vs
 * input). Aggregates overflow into an "Other" bucket beyond maxSlices.
 */

import { useMemo, type ReactNode } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { denormalizedSignals } from "@kopai/core";
import { formatDisplayValue, resolveUnitScale } from "../utils/units.js";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

// Mirror MetricHistogram palette
const COLORS = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#00C49F",
  "#0088FE",
];

const NO_VALUE_LABEL = "(no value)";
const OTHER_LABEL = "Other";

export interface MetricDonutChartProps {
  rows: AggregatedMetricRow[];
  isLoading?: boolean;
  error?: Error;
  unit?: string;
  showLegend?: boolean;
  showLabels?: boolean;
  maxSlices?: number;
  formatValue?: (value: number, unit?: string) => string;
  height?: number;
}

interface Slice {
  label: string;
  value: number;
  percent: number;
}

function coerceLabel(groups: Record<string, unknown>): string {
  const values = Object.values(groups);
  if (values.length === 0) return NO_VALUE_LABEL;
  const stringified = values
    .map((v) => (v === null || v === undefined ? "" : String(v)))
    .map((s) => (s.length === 0 ? NO_VALUE_LABEL : s));
  return stringified.join(" / ");
}

function buildSlices(rows: AggregatedMetricRow[], maxSlices: number): Slice[] {
  if (rows.length === 0) return [];

  const labeled = rows.map((row) => ({
    label: coerceLabel(row.groups),
    value: row.value,
  }));

  const sorted = [...labeled].sort((a, b) => b.value - a.value);

  const total = sorted.reduce((acc, s) => acc + s.value, 0);

  let displayed: { label: string; value: number }[];
  if (sorted.length > maxSlices) {
    const top = sorted.slice(0, maxSlices - 1);
    const rest = sorted.slice(maxSlices - 1);
    const otherValue = rest.reduce((acc, s) => acc + s.value, 0);
    displayed = [...top, { label: OTHER_LABEL, value: otherValue }];
  } else {
    displayed = sorted;
  }

  return displayed.map((s) => ({
    label: s.label,
    value: s.value,
    percent: total > 0 ? (s.value / total) * 100 : 0,
  }));
}

function defaultFormatValue(value: number, unit?: string): string {
  const scale = resolveUnitScale(unit ?? "", Math.abs(value));
  return formatDisplayValue(value, scale);
}

interface TooltipContentArgs {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: number | string;
    payload?: Slice;
  }>;
  total: number;
  formatValue: (value: number, unit?: string) => string;
  unit?: string;
}

function renderTooltipContent({
  active,
  payload,
  total,
  formatValue,
  unit,
}: TooltipContentArgs): ReactNode {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const slice = entry?.payload;
  if (!slice) return null;
  const pct = total > 0 ? (slice.value / total) * 100 : 0;
  return (
    <div className="bg-background border border-gray-700 rounded-lg p-3 shadow-lg">
      <p className="text-gray-300 text-sm font-medium mb-1">{slice.label}</p>
      <p className="text-sm text-gray-200">
        <span className="font-medium">Value:</span>{" "}
        {formatValue(slice.value, unit)}
      </p>
      <p className="text-sm text-gray-400">
        <span className="font-medium">Share:</span> {pct.toFixed(1)}%
      </p>
    </div>
  );
}

export function MetricDonutChart({
  rows,
  isLoading = false,
  error,
  unit,
  showLegend = true,
  showLabels = true,
  maxSlices = 6,
  formatValue = defaultFormatValue,
  height = 400,
}: MetricDonutChartProps) {
  const slices = useMemo(() => buildSlices(rows, maxSlices), [rows, maxSlices]);
  const total = useMemo(
    () => slices.reduce((acc, s) => acc + s.value, 0),
    [slices]
  );

  if (isLoading) {
    return (
      <div
        className="bg-background rounded-lg p-4 animate-pulse flex items-center justify-center"
        style={{ height }}
        data-testid="metric-donut-chart-loading"
      >
        <div className="relative">
          <div className="w-48 h-48 rounded-full bg-gray-700" />
          <div className="absolute inset-0 m-auto w-24 h-24 rounded-full bg-background" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-red-800"
        style={{ height }}
        data-testid="metric-donut-chart-error"
      >
        <div className="text-center p-4">
          <p className="text-red-400 font-medium">Error loading donut chart</p>
          <p className="text-gray-500 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (rows.length === 0 || slices.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-background rounded-lg border border-gray-800"
        style={{ height }}
        data-testid="metric-donut-chart-empty"
      >
        <p className="text-gray-500">(no data)</p>
      </div>
    );
  }

  return (
    <div
      className="bg-background rounded-lg p-4"
      style={{ height }}
      data-testid="metric-donut-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius="40%"
            outerRadius="72%"
            paddingAngle={1}
            isAnimationActive={false}
            label={
              showLabels
                ? (entry: { label?: string; percent?: number }) => {
                    const label = entry.label ?? "";
                    const pct =
                      typeof entry.percent === "number" ? entry.percent : 0;
                    // Recharts passes percent as 0-1 in some versions; we
                    // computed it ourselves on the slice (0-100). Use slice.
                    return `${label} ${pct.toFixed(1)}%`;
                  }
                : false
            }
            labelLine={showLabels}
          >
            {slices.map((_, i) => (
              <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={(props) =>
              renderTooltipContent({
                active: props.active,
                payload:
                  props.payload as unknown as TooltipContentArgs["payload"],
                total,
                formatValue,
                unit,
              })
            }
          />
          {showLegend && (
            <Legend
              formatter={(value: string) => value}
              wrapperStyle={{ color: "#9CA3AF" }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export const __testing__ = {
  buildSlices,
  renderTooltipContent,
  coerceLabel,
};
