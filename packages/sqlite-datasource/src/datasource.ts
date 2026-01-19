import { DatabaseSync } from "node:sqlite";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Insertable,
} from "kysely";

import type {
  MetricsData,
  TelemetryDatasource,
  MetricsPartialSuccess,
  Resource,
  InstrumentationScope,
  KeyValue,
  AnyValue,
  Metric,
  NumberDataPoint,
  Exemplar,
} from "@kopai/core";

import type { DB, OtelMetricsGauge } from "./db-types.js";

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

export class NodeSqliteTelemetryDatasource implements TelemetryDatasource {
  constructor(private sqliteConnection: DatabaseSync) {}

  async writeMetrics(metricsData: MetricsData): Promise<MetricsPartialSuccess> {
    const gaugeRows: Insertable<OtelMetricsGauge>[] = [];

    for (const resourceMetric of metricsData.resourceMetrics ?? []) {
      const resource = resourceMetric.resource;
      const resourceSchemaUrl = resourceMetric.schemaUrl;
      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        const scope = scopeMetric.scope;
        const scopeSchemaUrl = scopeMetric.schemaUrl;
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
        }
      }
    }

    for (const row of gaugeRows) {
      const { sql, parameters } = queryBuilder
        .insertInto("otel_metrics_gauge")
        .values(row)
        .compile();
      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | null)[]));
    }

    return { rejectedDataPoints: "" };
  }
}

function toGaugeRow(
  resource: Resource | undefined,
  resourceSchemaUrl: string | undefined,
  scope: InstrumentationScope | undefined,
  scopeSchemaUrl: string | undefined,
  metric: Metric,
  dataPoint: NumberDataPoint
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

function anyValueToSimple(value: AnyValue | undefined): unknown {
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
  attrs: KeyValue[] | undefined
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (!attrs) return obj;
  for (const kv of attrs) {
    if (kv.key) obj[kv.key] = anyValueToSimple(kv.value);
  }
  return obj;
}

function keyValueArrayToJson(attrs: KeyValue[] | undefined): string {
  if (!attrs || attrs.length === 0) return "{}";
  return JSON.stringify(keyValueArrayToObject(attrs));
}

function extractServiceName(resource: Resource | undefined): string {
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
  exemplars: Exemplar[],
  extractor: (e: Exemplar) => T
): string {
  if (exemplars.length === 0) return "[]";
  return JSON.stringify(exemplars.map(extractor));
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
