import { DatabaseSync } from "node:sqlite";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Insertable,
} from "kysely";

import { otlp, type datasource, type otlpMetrics } from "@kopai/core";

import type {
  DB,
  OtelMetricsGauge,
  OtelMetricsSum,
  OtelMetricsHistogram,
  OtelMetricsExponentialHistogram,
  OtelMetricsSummary,
} from "./db-types.js";

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

export class NodeSqliteTelemetryDatasource
  implements datasource.TelemetryDatasource
{
  constructor(private sqliteConnection: DatabaseSync) {}

  async writeMetrics(
    metricsData: datasource.MetricsData
  ): Promise<datasource.MetricsPartialSuccess> {
    const gaugeRows: Insertable<OtelMetricsGauge>[] = [];
    const sumRows: Insertable<OtelMetricsSum>[] = [];
    const histogramRows: Insertable<OtelMetricsHistogram>[] = [];
    const expHistogramRows: Insertable<OtelMetricsExponentialHistogram>[] = [];
    const summaryRows: Insertable<OtelMetricsSummary>[] = [];

    for (const resourceMetric of metricsData.resourceMetrics ?? []) {
      const { resource, schemaUrl: resourceSchemaUrl } = resourceMetric;

      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        const { scope, schemaUrl: scopeSchemaUrl } = scopeMetric;

        for (const metric of scopeMetric.metrics ?? []) {
          if (metric.gauge) {
            for (const dataPoint of metric.gauge.dataPoints ?? []) {
              gaugeRows.push(
                toGaugeRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint
                )
              );
            }
          }
          if (metric.sum) {
            for (const dataPoint of metric.sum.dataPoints ?? []) {
              sumRows.push(
                toSumRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.sum.aggregationTemporality,
                  metric.sum.isMonotonic
                )
              );
            }
          }
          if (metric.histogram) {
            for (const dataPoint of metric.histogram.dataPoints ?? []) {
              histogramRows.push(
                toHistogramRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.histogram.aggregationTemporality
                )
              );
            }
          }
          if (metric.exponentialHistogram) {
            for (const dataPoint of metric.exponentialHistogram.dataPoints ??
              []) {
              expHistogramRows.push(
                toExpHistogramRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint,
                  metric.exponentialHistogram.aggregationTemporality
                )
              );
            }
          }
          if (metric.summary) {
            for (const dataPoint of metric.summary.dataPoints ?? []) {
              summaryRows.push(
                toSummaryRow(
                  resource,
                  resourceSchemaUrl,
                  scope,
                  scopeSchemaUrl,
                  metric,
                  dataPoint
                )
              );
            }
          }
        }
      }
    }

    this.insertRows("otel_metrics_gauge", gaugeRows);
    this.insertRows("otel_metrics_sum", sumRows);
    this.insertRows("otel_metrics_histogram", histogramRows);
    this.insertRows("otel_metrics_exponential_histogram", expHistogramRows);
    this.insertRows("otel_metrics_summary", summaryRows);

    return { rejectedDataPoints: "" };
  }

  private insertRows<T extends keyof DB>(
    table: T,
    rows: Insertable<DB[T]>[]
  ): void {
    for (const row of rows) {
      const { sql, parameters } = queryBuilder
        .insertInto(table)
        .values(row as never)
        .compile();
      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | null)[]));
    }
  }
}

function toGaugeRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.NumberDataPoint
): Insertable<OtelMetricsGauge> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToUnix(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToUnix(dataPoint.timeUnixNano),
    Value: dataPoint.asDouble ?? Number(dataPoint.asInt ?? 0),
    Flags: dataPoint.flags ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      nanosToUnix(e.timeUnixNano)
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
  };
}

function toSumRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.NumberDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined,
  isMonotonic: boolean | undefined
): Insertable<OtelMetricsSum> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToUnix(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToUnix(dataPoint.timeUnixNano),
    Value: dataPoint.asDouble ?? Number(dataPoint.asInt ?? 0),
    Flags: dataPoint.flags ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      nanosToUnix(e.timeUnixNano)
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
    IsMonotonic: isMonotonic ? 1 : 0,
  };
}

function toHistogramRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.HistogramDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined
): Insertable<OtelMetricsHistogram> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToUnix(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToUnix(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    BucketCounts: JSON.stringify(dataPoint.bucketCounts ?? []),
    ExplicitBounds: JSON.stringify(dataPoint.explicitBounds ?? []),
    Min: dataPoint.min ?? null,
    Max: dataPoint.max ?? null,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      nanosToUnix(e.timeUnixNano)
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
  };
}

function toExpHistogramRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.ExponentialHistogramDataPoint,
  aggregationTemporality: otlp.AggregationTemporality | undefined
): Insertable<OtelMetricsExponentialHistogram> {
  const exemplars = dataPoint.exemplars ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToUnix(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToUnix(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    Scale: dataPoint.scale ?? 0,
    ZeroCount: dataPoint.zeroCount ?? 0,
    PositiveOffset: dataPoint.positive?.offset ?? 0,
    PositiveBucketCounts: JSON.stringify(
      dataPoint.positive?.bucketCounts ?? []
    ),
    NegativeOffset: dataPoint.negative?.offset ?? 0,
    NegativeBucketCounts: JSON.stringify(
      dataPoint.negative?.bucketCounts ?? []
    ),
    Min: dataPoint.min ?? null,
    Max: dataPoint.max ?? null,
    ZeroThreshold: dataPoint.zeroThreshold ?? 0,
    "Exemplars.FilteredAttributes": exemplarsArrayToJson(exemplars, (e) =>
      keyValueArrayToObject(e.filteredAttributes)
    ),
    "Exemplars.TimeUnix": exemplarsArrayToJson(exemplars, (e) =>
      nanosToUnix(e.timeUnixNano)
    ),
    "Exemplars.Value": exemplarsArrayToJson(
      exemplars,
      (e) => e.asDouble ?? Number(e.asInt ?? 0)
    ),
    "Exemplars.SpanId": exemplarsArrayToJson(exemplars, (e) => e.spanId ?? ""),
    "Exemplars.TraceId": exemplarsArrayToJson(exemplars, (e) =>
      e.traceId ? bufferToHex(e.traceId) : ""
    ),
    AggTemporality: aggTemporalityToString(aggregationTemporality),
  };
}

function toSummaryRow(
  resource: otlp.Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: otlp.InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: otlpMetrics.Metric,
  dataPoint: otlpMetrics.SummaryDataPoint
): Insertable<OtelMetricsSummary> {
  const quantileValues = dataPoint.quantileValues ?? [];
  return {
    ResourceAttributes: keyValueArrayToJson(resource?.attributes),
    ResourceSchemaUrl: resourceSchemaUrl ?? "",
    ScopeName: scope?.name ?? "",
    ScopeVersion: scope?.version ?? "",
    ScopeAttributes: keyValueArrayToJson(scope?.attributes),
    ScopeDroppedAttrCount: scope?.droppedAttributesCount ?? 0,
    ScopeSchemaUrl: scopeSchemaUrl ?? "",
    ServiceName: extractServiceName(resource),
    MetricName: metric.name ?? "",
    MetricDescription: metric.description ?? "",
    MetricUnit: metric.unit ?? "",
    Attributes: keyValueArrayToJson(dataPoint.attributes),
    StartTimeUnix: nanosToUnix(dataPoint.startTimeUnixNano),
    TimeUnix: nanosToUnix(dataPoint.timeUnixNano),
    Count: Number(dataPoint.count ?? 0),
    Sum: dataPoint.sum ?? 0,
    "ValueAtQuantiles.Quantile": JSON.stringify(
      quantileValues.map(
        (q: otlpMetrics.SummaryDataPoint_ValueAtQuantile) => q.quantile ?? 0
      )
    ),
    "ValueAtQuantiles.Value": JSON.stringify(
      quantileValues.map(
        (q: otlpMetrics.SummaryDataPoint_ValueAtQuantile) => q.value ?? 0
      )
    ),
  };
}

function aggTemporalityToString(
  agg: otlp.AggregationTemporality | undefined
): string {
  if (agg === undefined) return "";
  return otlp.AggregationTemporality[agg] ?? "";
}

function anyValueToSimple(value: otlp.AnyValue | undefined): unknown {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue !== undefined) {
    return value.arrayValue.values?.map((v) => anyValueToSimple(v)) ?? [];
  }
  if (value.kvlistValue !== undefined) {
    const obj: Record<string, unknown> = {};
    for (const kv of value.kvlistValue.values ?? []) {
      if (kv.key) obj[kv.key] = anyValueToSimple(kv.value);
    }
    return obj;
  }
  return null;
}

function keyValueArrayToObject(
  attrs: otlp.KeyValue[] | undefined
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (!attrs) return obj;
  for (const kv of attrs) {
    if (kv.key) obj[kv.key] = anyValueToSimple(kv.value);
  }
  return obj;
}

function keyValueArrayToJson(attrs: otlp.KeyValue[] | undefined): string {
  if (!attrs || attrs.length === 0) return "{}";
  return JSON.stringify(keyValueArrayToObject(attrs));
}

function extractServiceName(resource: otlp.Resource | undefined): string {
  if (!resource?.attributes) return "";
  for (const kv of resource.attributes) {
    if (kv.key === "service.name" && kv.value?.stringValue) {
      return kv.value.stringValue;
    }
  }
  return "";
}

function nanosToUnix(nanos: string | undefined): number {
  if (!nanos) return 0;
  return Number(BigInt(nanos) / 1_000_000n);
}

function exemplarsArrayToJson<T>(
  exemplars: otlpMetrics.Exemplar[],
  extractor: (e: otlpMetrics.Exemplar) => T
): string {
  if (exemplars.length === 0) return "[]";
  return JSON.stringify(exemplars.map(extractor));
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
