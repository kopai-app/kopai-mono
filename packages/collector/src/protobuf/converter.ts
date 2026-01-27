import { fromBinary, toBinary, create } from "@bufbuild/protobuf";
import type { otlp, otlpMetrics } from "@kopai/core";
import {
  ExportTraceServiceRequestSchema,
  ExportTraceServiceResponseSchema,
} from "../gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import {
  ExportMetricsServiceRequestSchema,
  ExportMetricsServiceResponseSchema,
} from "../gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import {
  ExportLogsServiceRequestSchema,
  ExportLogsServiceResponseSchema,
} from "../gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import type {
  ResourceSpans,
  Span,
  Span_Event,
  Span_Link,
  Status,
  ScopeSpans,
} from "../gen/opentelemetry/proto/trace/v1/trace_pb.js";
import type {
  ResourceMetrics,
  ScopeMetrics,
  Metric,
  NumberDataPoint,
  HistogramDataPoint,
  ExponentialHistogramDataPoint,
  SummaryDataPoint,
  Exemplar,
} from "../gen/opentelemetry/proto/metrics/v1/metrics_pb.js";
import type {
  ResourceLogs,
  ScopeLogs,
  LogRecord,
} from "../gen/opentelemetry/proto/logs/v1/logs_pb.js";
import type { Resource } from "../gen/opentelemetry/proto/resource/v1/resource_pb.js";
import type {
  AnyValue,
  KeyValue,
  InstrumentationScope,
} from "../gen/opentelemetry/proto/common/v1/common_pb.js";

// Utility functions for converting between protobuf binary types and JSON types

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bigintToString(value: bigint): string {
  return value.toString();
}

function stringToBigint(value: string | undefined): bigint {
  return value ? BigInt(value) : 0n;
}

// Convert AnyValue from protobuf to JSON format
function convertAnyValue(
  value: AnyValue | undefined
): otlp.AnyValue | undefined {
  if (!value || value.value.case === undefined) {
    return undefined;
  }

  switch (value.value.case) {
    case "stringValue":
      return { stringValue: value.value.value };
    case "boolValue":
      return { boolValue: value.value.value };
    case "intValue":
      return { intValue: bigintToString(value.value.value) };
    case "doubleValue":
      return { doubleValue: value.value.value };
    case "bytesValue":
      return { bytesValue: bytesToHex(value.value.value) };
    case "arrayValue":
      return {
        arrayValue: {
          values: value.value.value.values
            .map(convertAnyValue)
            .filter(Boolean) as otlp.AnyValue[],
        },
      };
    case "kvlistValue":
      return {
        kvlistValue: {
          values: value.value.value.values.map(convertKeyValue),
        },
      };
    default:
      return undefined;
  }
}

// Convert KeyValue from protobuf to JSON format
function convertKeyValue(kv: KeyValue): otlp.KeyValue {
  return {
    key: kv.key,
    value: convertAnyValue(kv.value),
  };
}

// Convert InstrumentationScope from protobuf to JSON format
function convertInstrumentationScope(
  scope: InstrumentationScope | undefined
): otlp.InstrumentationScope | undefined {
  if (!scope) return undefined;
  return {
    name: scope.name || undefined,
    version: scope.version || undefined,
    attributes:
      scope.attributes.length > 0
        ? scope.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: scope.droppedAttributesCount || undefined,
  };
}

// Convert Resource from protobuf to JSON format
function convertResource(
  resource: Resource | undefined
): otlp.Resource | undefined {
  if (!resource) return undefined;
  return {
    attributes:
      resource.attributes.length > 0
        ? resource.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: resource.droppedAttributesCount || undefined,
  };
}

// === TRACES CONVERSION ===

function convertStatus(status: Status | undefined): otlp.Status | undefined {
  if (!status) return undefined;
  return {
    code: status.code as number,
    message: status.message || undefined,
  };
}

function convertSpanEvent(event: Span_Event): otlp.Span_Event {
  return {
    timeUnixNano: bigintToString(event.timeUnixNano),
    name: event.name || undefined,
    attributes:
      event.attributes.length > 0
        ? event.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: event.droppedAttributesCount || undefined,
  };
}

function convertSpanLink(link: Span_Link): otlp.Span_Link {
  return {
    traceId: bytesToHex(link.traceId),
    spanId: bytesToHex(link.spanId),
    traceState: link.traceState || undefined,
    attributes:
      link.attributes.length > 0
        ? link.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: link.droppedAttributesCount || undefined,
    flags: link.flags || undefined,
  };
}

function convertSpan(span: Span): otlp.Span {
  return {
    traceId: bytesToHex(span.traceId),
    spanId: bytesToHex(span.spanId),
    traceState: span.traceState || undefined,
    parentSpanId:
      span.parentSpanId.length > 0 ? bytesToHex(span.parentSpanId) : undefined,
    flags: span.flags || undefined,
    name: span.name || undefined,
    kind: span.kind as number,
    startTimeUnixNano: bigintToString(span.startTimeUnixNano),
    endTimeUnixNano: bigintToString(span.endTimeUnixNano),
    attributes:
      span.attributes.length > 0
        ? span.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: span.droppedAttributesCount || undefined,
    events:
      span.events.length > 0 ? span.events.map(convertSpanEvent) : undefined,
    droppedEventsCount: span.droppedEventsCount || undefined,
    links: span.links.length > 0 ? span.links.map(convertSpanLink) : undefined,
    droppedLinksCount: span.droppedLinksCount || undefined,
    status: convertStatus(span.status),
  };
}

function convertScopeSpans(scopeSpans: ScopeSpans): otlp.ScopeSpans {
  return {
    scope: convertInstrumentationScope(scopeSpans.scope),
    spans:
      scopeSpans.spans.length > 0
        ? scopeSpans.spans.map(convertSpan)
        : undefined,
    schemaUrl: scopeSpans.schemaUrl || undefined,
  };
}

function convertResourceSpans(rs: ResourceSpans): otlp.ResourceSpans {
  return {
    resource: convertResource(rs.resource),
    scopeSpans:
      rs.scopeSpans.length > 0
        ? rs.scopeSpans.map(convertScopeSpans)
        : undefined,
    schemaUrl: rs.schemaUrl || undefined,
  };
}

// === METRICS CONVERSION ===

function convertExemplar(exemplar: Exemplar): otlpMetrics.Exemplar {
  return {
    filteredAttributes:
      exemplar.filteredAttributes.length > 0
        ? exemplar.filteredAttributes.map(convertKeyValue)
        : undefined,
    timeUnixNano: bigintToString(exemplar.timeUnixNano),
    asDouble:
      exemplar.value.case === "asDouble" ? exemplar.value.value : undefined,
    asInt:
      exemplar.value.case === "asInt"
        ? bigintToString(exemplar.value.value)
        : undefined,
    spanId:
      exemplar.spanId.length > 0 ? bytesToHex(exemplar.spanId) : undefined,
    traceId:
      exemplar.traceId.length > 0 ? bytesToHex(exemplar.traceId) : undefined,
  };
}

function convertNumberDataPoint(
  dp: NumberDataPoint
): otlpMetrics.NumberDataPoint {
  return {
    attributes:
      dp.attributes.length > 0 ? dp.attributes.map(convertKeyValue) : undefined,
    startTimeUnixNano: bigintToString(dp.startTimeUnixNano),
    timeUnixNano: bigintToString(dp.timeUnixNano),
    asDouble: dp.value.case === "asDouble" ? dp.value.value : undefined,
    asInt:
      dp.value.case === "asInt" ? bigintToString(dp.value.value) : undefined,
    exemplars:
      dp.exemplars.length > 0 ? dp.exemplars.map(convertExemplar) : undefined,
    flags: dp.flags || undefined,
  };
}

function convertHistogramDataPoint(
  dp: HistogramDataPoint
): otlpMetrics.HistogramDataPoint {
  return {
    attributes:
      dp.attributes.length > 0 ? dp.attributes.map(convertKeyValue) : undefined,
    startTimeUnixNano: bigintToString(dp.startTimeUnixNano),
    timeUnixNano: bigintToString(dp.timeUnixNano),
    count: bigintToString(dp.count),
    sum: dp.sum,
    bucketCounts: dp.bucketCounts.map((v) => Number(v)),
    explicitBounds:
      dp.explicitBounds.length > 0 ? [...dp.explicitBounds] : undefined,
    exemplars:
      dp.exemplars.length > 0 ? dp.exemplars.map(convertExemplar) : undefined,
    flags: dp.flags || undefined,
    min: dp.min,
    max: dp.max,
  };
}

function convertExponentialHistogramDataPoint(
  dp: ExponentialHistogramDataPoint
): otlpMetrics.ExponentialHistogramDataPoint {
  return {
    attributes:
      dp.attributes.length > 0 ? dp.attributes.map(convertKeyValue) : undefined,
    startTimeUnixNano: bigintToString(dp.startTimeUnixNano),
    timeUnixNano: bigintToString(dp.timeUnixNano),
    count: bigintToString(dp.count),
    sum: dp.sum,
    scale: dp.scale,
    zeroCount: bigintToString(dp.zeroCount),
    positive: dp.positive
      ? {
          offset: dp.positive.offset,
          bucketCounts: dp.positive.bucketCounts.map((v) => Number(v)),
        }
      : undefined,
    negative: dp.negative
      ? {
          offset: dp.negative.offset,
          bucketCounts: dp.negative.bucketCounts.map((v) => Number(v)),
        }
      : undefined,
    flags: dp.flags || undefined,
    exemplars:
      dp.exemplars.length > 0 ? dp.exemplars.map(convertExemplar) : undefined,
    min: dp.min,
    max: dp.max,
    zeroThreshold: dp.zeroThreshold,
  };
}

function convertSummaryDataPoint(
  dp: SummaryDataPoint
): otlpMetrics.SummaryDataPoint {
  return {
    attributes:
      dp.attributes.length > 0 ? dp.attributes.map(convertKeyValue) : undefined,
    startTimeUnixNano: bigintToString(dp.startTimeUnixNano),
    timeUnixNano: bigintToString(dp.timeUnixNano),
    count: bigintToString(dp.count),
    sum: dp.sum,
    quantileValues:
      dp.quantileValues.length > 0
        ? dp.quantileValues.map((qv) => ({
            quantile: qv.quantile,
            value: qv.value,
          }))
        : undefined,
    flags: dp.flags || undefined,
  };
}

function convertMetric(metric: Metric): otlpMetrics.Metric {
  const base: otlpMetrics.Metric = {
    name: metric.name || undefined,
    description: metric.description || undefined,
    unit: metric.unit || undefined,
    metadata:
      metric.metadata.length > 0
        ? metric.metadata.map(convertKeyValue)
        : undefined,
  };

  switch (metric.data.case) {
    case "gauge":
      return {
        ...base,
        gauge: {
          dataPoints: metric.data.value.dataPoints.map(convertNumberDataPoint),
        },
      };
    case "sum":
      return {
        ...base,
        sum: {
          dataPoints: metric.data.value.dataPoints.map(convertNumberDataPoint),
          aggregationTemporality: metric.data.value
            .aggregationTemporality as number,
          isMonotonic: metric.data.value.isMonotonic,
        },
      };
    case "histogram":
      return {
        ...base,
        histogram: {
          dataPoints: metric.data.value.dataPoints.map(
            convertHistogramDataPoint
          ),
          aggregationTemporality: metric.data.value
            .aggregationTemporality as number,
        },
      };
    case "exponentialHistogram":
      return {
        ...base,
        exponentialHistogram: {
          dataPoints: metric.data.value.dataPoints.map(
            convertExponentialHistogramDataPoint
          ),
          aggregationTemporality: metric.data.value
            .aggregationTemporality as number,
        },
      };
    case "summary":
      return {
        ...base,
        summary: {
          dataPoints: metric.data.value.dataPoints.map(convertSummaryDataPoint),
        },
      };
    default:
      return base;
  }
}

function convertScopeMetrics(sm: ScopeMetrics): otlpMetrics.ScopeMetrics {
  return {
    scope: convertInstrumentationScope(sm.scope),
    metrics: sm.metrics.length > 0 ? sm.metrics.map(convertMetric) : undefined,
    schemaUrl: sm.schemaUrl || undefined,
  };
}

function convertResourceMetrics(
  rm: ResourceMetrics
): otlpMetrics.ResourceMetrics {
  return {
    resource: convertResource(rm.resource),
    scopeMetrics:
      rm.scopeMetrics.length > 0
        ? rm.scopeMetrics.map(convertScopeMetrics)
        : undefined,
    schemaUrl: rm.schemaUrl || undefined,
  };
}

// === LOGS CONVERSION ===

function convertLogRecord(log: LogRecord): otlp.LogRecord {
  return {
    timeUnixNano: bigintToString(log.timeUnixNano),
    observedTimeUnixNano: bigintToString(log.observedTimeUnixNano),
    severityNumber: log.severityNumber as number,
    severityText: log.severityText || undefined,
    body: convertAnyValue(log.body),
    attributes:
      log.attributes.length > 0
        ? log.attributes.map(convertKeyValue)
        : undefined,
    droppedAttributesCount: log.droppedAttributesCount || undefined,
    flags: log.flags || undefined,
    traceId: log.traceId.length > 0 ? bytesToHex(log.traceId) : undefined,
    spanId: log.spanId.length > 0 ? bytesToHex(log.spanId) : undefined,
  };
}

function convertScopeLogs(sl: ScopeLogs): otlp.ScopeLogs {
  return {
    scope: convertInstrumentationScope(sl.scope),
    logRecords:
      sl.logRecords.length > 0
        ? sl.logRecords.map(convertLogRecord)
        : undefined,
    schemaUrl: sl.schemaUrl || undefined,
  };
}

function convertResourceLogs(rl: ResourceLogs): otlp.ResourceLogs {
  return {
    resource: convertResource(rl.resource),
    scopeLogs:
      rl.scopeLogs.length > 0 ? rl.scopeLogs.map(convertScopeLogs) : undefined,
    schemaUrl: rl.schemaUrl || undefined,
  };
}

// === MAIN DECODE FUNCTIONS ===

export function decodeTracesRequest(buffer: Uint8Array): otlp.TracesData {
  const request = fromBinary(ExportTraceServiceRequestSchema, buffer);
  return {
    resourceSpans: request.resourceSpans.map(convertResourceSpans),
  };
}

export function decodeMetricsRequest(
  buffer: Uint8Array
): otlpMetrics.MetricsData {
  const request = fromBinary(ExportMetricsServiceRequestSchema, buffer);
  return {
    resourceMetrics: request.resourceMetrics.map(convertResourceMetrics),
  };
}

export function decodeLogsRequest(buffer: Uint8Array): otlp.LogsData {
  const request = fromBinary(ExportLogsServiceRequestSchema, buffer);
  return {
    resourceLogs: request.resourceLogs.map(convertResourceLogs),
  };
}

// === RESPONSE ENCODING ===

export function encodeTracesResponse(response: {
  rejectedSpans?: string;
  errorMessage?: string;
}): Uint8Array {
  const msg = create(ExportTraceServiceResponseSchema, {
    partialSuccess: {
      rejectedSpans: stringToBigint(response.rejectedSpans),
      errorMessage: response.errorMessage ?? "",
    },
  });
  return toBinary(ExportTraceServiceResponseSchema, msg);
}

export function encodeMetricsResponse(response: {
  rejectedDataPoints?: string;
  errorMessage?: string;
}): Uint8Array {
  const msg = create(ExportMetricsServiceResponseSchema, {
    partialSuccess: {
      rejectedDataPoints: stringToBigint(response.rejectedDataPoints),
      errorMessage: response.errorMessage ?? "",
    },
  });
  return toBinary(ExportMetricsServiceResponseSchema, msg);
}

export function encodeLogsResponse(response: {
  rejectedLogRecords?: string;
  errorMessage?: string;
}): Uint8Array {
  const msg = create(ExportLogsServiceResponseSchema, {
    partialSuccess: {
      rejectedLogRecords: stringToBigint(response.rejectedLogRecords),
      errorMessage: response.errorMessage ?? "",
    },
  });
  return toBinary(ExportLogsServiceResponseSchema, msg);
}

export {
  ExportTraceServiceRequestSchema,
  ExportMetricsServiceRequestSchema,
  ExportLogsServiceRequestSchema,
};
