/**
 * Internal types for observability components.
 * Components accept denormalized rows (OtelTracesRow, OtelLogsRow, OtelMetricsRow)
 * from @kopai/core and transform to these internal types in useMemo.
 */

// ── Trace types ──

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  kind: string;
  status: string; // "UNSET" | "OK" | "ERROR"
  statusMessage?: string;
  serviceName: string;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  events: SpanEvent[];
  links: SpanLink[];
  children: SpanNode[];
}

export interface SpanEvent {
  timeUnixMs: number;
  name: string;
  attributes: Record<string, unknown>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes: Record<string, unknown>;
}

export interface ParsedTrace {
  traceId: string;
  rootSpans: SpanNode[];
  minTimeMs: number;
  maxTimeMs: number;
  totalSpanCount: number;
}

// ── Log types ──

export interface LogEntry {
  logId: string;
  timeUnixMs: number;
  body: string;
  severityText: string;
  severityNumber: number;
  serviceName: string;
  traceId?: string;
  spanId?: string;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  scopeName?: string;
}

// ── Metric types ──

export type MetricType =
  | "Gauge"
  | "Sum"
  | "Histogram"
  | "ExponentialHistogram"
  | "Summary";

export interface MetricSeries {
  key: string;
  labels: Record<string, string>;
  dataPoints: MetricDataPoint[];
}

export interface MetricDataPoint {
  timestamp: number;
  value: number;
  // Histogram-specific
  count?: number;
  sum?: number;
  bucketCounts?: number[];
  explicitBounds?: number[];
  min?: number;
  max?: number;
}

export interface ParsedMetricGroup {
  name: string;
  description: string;
  unit: string;
  type: MetricType;
  series: MetricSeries[];
  serviceName: string;
}

// ── RawDataTable types ──

export interface RawTableData {
  columns: string[];
  types: string[];
  rows: unknown[][];
}

// ── Recharts types ──

export interface RechartsDataPoint {
  timestamp: number;
  [seriesKey: string]: number;
}
