import type { denormalizedSignals } from "@kopai/core";
import { dateTime64ToNanos } from "./timestamp.js";
import { coerceAttributes, coerceAttributesArray } from "./attributes.js";

/** ClickHouse JSON row shape for the otel_traces table. */
interface ClickHouseTracesRow {
  TraceId: string;
  SpanId: string;
  Timestamp: string;
  ParentSpanId: string;
  TraceState: string;
  SpanName: string | undefined;
  SpanKind: string;
  ServiceName: string | undefined;
  ResourceAttributes: Record<string, string>;
  ScopeName: string | undefined;
  ScopeVersion: string;
  SpanAttributes: Record<string, string>;
  Duration: unknown;
  StatusCode: string;
  StatusMessage: string;
  "Events.Timestamp": string[] | undefined;
  "Events.Name": string[] | undefined;
  "Events.Attributes": Record<string, string>[] | undefined;
  "Links.TraceId": string[] | undefined;
  "Links.SpanId": string[] | undefined;
  "Links.TraceState": string[] | undefined;
  "Links.Attributes": Record<string, string>[] | undefined;
}

export function mapTracesRow(raw: unknown): denormalizedSignals.OtelTracesRow {
  const row = raw as ClickHouseTracesRow;

  return {
    TraceId: row.TraceId,
    SpanId: row.SpanId,
    Timestamp: dateTime64ToNanos(row.Timestamp),
    ParentSpanId: emptyToUndefined(row.ParentSpanId),
    TraceState: emptyToUndefined(row.TraceState),
    SpanName: row.SpanName,
    SpanKind: emptyToUndefined(row.SpanKind),
    ServiceName: row.ServiceName,
    ResourceAttributes: coerceAttributes(row.ResourceAttributes),
    ScopeName: row.ScopeName,
    ScopeVersion: emptyToUndefined(row.ScopeVersion),
    SpanAttributes: coerceAttributes(row.SpanAttributes),
    Duration: row.Duration != null ? String(row.Duration) : undefined,
    StatusCode: emptyToUndefined(row.StatusCode),
    StatusMessage: emptyToUndefined(row.StatusMessage),
    "Events.Timestamp": emptyArrayToUndefined(
      row["Events.Timestamp"]?.map(dateTime64ToNanos)
    ),
    "Events.Name": emptyArrayToUndefined(row["Events.Name"]),
    "Events.Attributes": emptyArrayToUndefined(
      coerceAttributesArray(row["Events.Attributes"])
    ),
    "Links.TraceId": emptyArrayToUndefined(row["Links.TraceId"]),
    "Links.SpanId": emptyArrayToUndefined(row["Links.SpanId"]),
    "Links.TraceState": emptyArrayToUndefined(row["Links.TraceState"]),
    "Links.Attributes": emptyArrayToUndefined(
      coerceAttributesArray(row["Links.Attributes"])
    ),
  };
}

/** ClickHouse JSON row shape for the otel_logs table. */
interface ClickHouseLogsRow {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  TraceFlags: unknown;
  SeverityText: string;
  SeverityNumber: unknown;
  Body: string | undefined;
  LogAttributes: Record<string, string>;
  ResourceAttributes: Record<string, string>;
  ResourceSchemaUrl: string;
  ServiceName: string | undefined;
  ScopeName: string;
  ScopeVersion: string;
  ScopeAttributes: Record<string, string>;
  ScopeSchemaUrl: string;
}

export function mapLogsRow(raw: unknown): denormalizedSignals.OtelLogsRow {
  const row = raw as ClickHouseLogsRow;

  return {
    Timestamp: dateTime64ToNanos(row.Timestamp),
    TraceId: emptyToUndefined(row.TraceId),
    SpanId: emptyToUndefined(row.SpanId),
    TraceFlags: toNumber(row.TraceFlags),
    SeverityText: emptyToUndefined(row.SeverityText),
    SeverityNumber: toNumber(row.SeverityNumber),
    Body: row.Body,
    LogAttributes: coerceAttributes(row.LogAttributes),
    ResourceAttributes: coerceAttributes(row.ResourceAttributes),
    ResourceSchemaUrl: emptyToUndefined(row.ResourceSchemaUrl),
    ServiceName: row.ServiceName,
    ScopeName: emptyToUndefined(row.ScopeName),
    ScopeVersion: emptyToUndefined(row.ScopeVersion),
    ScopeAttributes: coerceAttributes(row.ScopeAttributes),
    ScopeSchemaUrl: emptyToUndefined(row.ScopeSchemaUrl),
  };
}

type MetricType =
  | "Gauge"
  | "Sum"
  | "Histogram"
  | "ExponentialHistogram"
  | "Summary";

/**
 * ClickHouse JSON row shape for otel_metrics_* tables.
 * Union of all possible fields across metric types; type-specific fields are optional.
 */
interface ClickHouseMetricsRow {
  // Common fields
  TimeUnix: string;
  StartTimeUnix: string;
  Attributes: Record<string, string>;
  MetricName: string | undefined;
  MetricDescription: string;
  MetricUnit: string;
  ResourceAttributes: Record<string, string>;
  ResourceSchemaUrl: string;
  ScopeAttributes: Record<string, string>;
  ScopeDroppedAttrCount: unknown;
  ScopeName: string;
  ScopeSchemaUrl: string;
  ScopeVersion: string;
  ServiceName: string | undefined;
  // Exemplar arrays (absent on Summary)
  "Exemplars.FilteredAttributes"?: Record<string, string>[];
  "Exemplars.SpanId"?: string[];
  "Exemplars.TimeUnix"?: string[];
  "Exemplars.TraceId"?: string[];
  "Exemplars.Value"?: number[];
  // Gauge / Sum
  Value?: number;
  Flags?: unknown;
  // Sum
  AggTemporality?: string;
  IsMonotonic?: unknown;
  // Histogram / ExponentialHistogram
  Count?: unknown;
  Sum?: number;
  Min?: number | null;
  Max?: number | null;
  BucketCounts?: unknown[];
  ExplicitBounds?: number[];
  // ExponentialHistogram
  Scale?: unknown;
  ZeroCount?: unknown;
  ZeroThreshold?: number;
  PositiveOffset?: unknown;
  PositiveBucketCounts?: unknown[];
  NegativeOffset?: unknown;
  NegativeBucketCounts?: unknown[];
  // Summary
  "ValueAtQuantiles.Quantile"?: number[];
  "ValueAtQuantiles.Value"?: number[];
}

export function mapMetricsRow(
  raw: unknown,
  metricType: MetricType
): denormalizedSignals.OtelMetricsRow {
  const row = raw as ClickHouseMetricsRow;

  const base = {
    TimeUnix: dateTime64ToNanos(row.TimeUnix),
    StartTimeUnix: dateTime64ToNanos(row.StartTimeUnix),
    Attributes: coerceAttributes(row.Attributes),
    MetricName: row.MetricName,
    MetricDescription: emptyToUndefined(row.MetricDescription),
    MetricUnit: emptyToUndefined(row.MetricUnit),
    ResourceAttributes: coerceAttributes(row.ResourceAttributes),
    ResourceSchemaUrl: emptyToUndefined(row.ResourceSchemaUrl),
    ScopeAttributes: coerceAttributes(row.ScopeAttributes),
    ScopeDroppedAttrCount: toNumber(row.ScopeDroppedAttrCount),
    ScopeName: emptyToUndefined(row.ScopeName),
    ScopeSchemaUrl: emptyToUndefined(row.ScopeSchemaUrl),
    ScopeVersion: emptyToUndefined(row.ScopeVersion),
    ServiceName: row.ServiceName,
    "Exemplars.FilteredAttributes": emptyArrayToUndefined(
      coerceAttributesArray(row["Exemplars.FilteredAttributes"])
    ),
    "Exemplars.SpanId": emptyArrayToUndefined(row["Exemplars.SpanId"]),
    "Exemplars.TimeUnix": emptyArrayToUndefined(
      row["Exemplars.TimeUnix"]?.map(dateTime64ToNanos)
    ),
    "Exemplars.TraceId": emptyArrayToUndefined(row["Exemplars.TraceId"]),
    "Exemplars.Value": emptyArrayToUndefined(row["Exemplars.Value"]),
  };

  if (metricType === "Gauge") {
    return {
      ...base,
      MetricType: "Gauge" as const,
      Value: row.Value as number,
      Flags: toNumber(row.Flags),
    };
  }

  if (metricType === "Sum") {
    return {
      ...base,
      MetricType: "Sum" as const,
      Value: row.Value as number,
      Flags: toNumber(row.Flags),
      AggTemporality: emptyToUndefined(row.AggTemporality),
      IsMonotonic: toNumber(row.IsMonotonic),
    };
  }

  if (metricType === "Histogram") {
    return {
      ...base,
      MetricType: "Histogram" as const,
      Count: toNumber(row.Count),
      Sum: row.Sum,
      Min: row.Min,
      Max: row.Max,
      BucketCounts: toNumberArray(row.BucketCounts),
      ExplicitBounds: row.ExplicitBounds,
      AggTemporality: emptyToUndefined(row.AggTemporality),
    };
  }

  if (metricType === "ExponentialHistogram") {
    return {
      ...base,
      MetricType: "ExponentialHistogram" as const,
      Count: toNumber(row.Count),
      Sum: row.Sum,
      Min: row.Min,
      Max: row.Max,
      Scale: toNumber(row.Scale),
      ZeroCount: toNumber(row.ZeroCount),
      ZeroThreshold: row.ZeroThreshold,
      PositiveOffset: toNumber(row.PositiveOffset),
      PositiveBucketCounts: toNumberArray(row.PositiveBucketCounts),
      NegativeOffset: toNumber(row.NegativeOffset),
      NegativeBucketCounts: toNumberArray(row.NegativeBucketCounts),
      AggTemporality: emptyToUndefined(row.AggTemporality),
    };
  }

  // Summary
  return {
    ...base,
    MetricType: "Summary" as const,
    Count: toNumber(row.Count),
    Sum: row.Sum,
    "ValueAtQuantiles.Quantile": row["ValueAtQuantiles.Quantile"],
    "ValueAtQuantiles.Value": row["ValueAtQuantiles.Value"],
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (!value || value === "") return undefined;
  return value;
}

function emptyArrayToUndefined<T>(arr: T[] | undefined): T[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr;
}

/** @internal */
export function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value === "") return undefined;
    const n = Number(value);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

/** @internal Convert Array(UInt64) which may come as string[] to number[] */
export function toNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const nums = value
    .map((v) => toNumber(v))
    .filter((n): n is number => n !== undefined);
  return nums.length > 0 ? nums : undefined;
}
