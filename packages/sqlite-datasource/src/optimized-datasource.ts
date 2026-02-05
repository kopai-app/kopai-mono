import { DatabaseSync } from "node:sqlite";
import {
  type datasource,
  type dataFilterSchemas,
  type denormalizedSignals,
} from "@kopai/core";
import { DbDatasource } from "./db-datasource.js";

/** In-memory state for a single discovered metric */
type DiscoveryMetricState = {
  name: string;
  type: datasource.MetricType;
  unit?: string;
  description?: string;
  attributes: Map<string, Set<string>>;
  resourceAttributes: Map<string, Set<string>>;
};

const MAX_ATTR_VALUES = 100;

export class OptimizedDatasource implements datasource.TelemetryDatasource {
  private discoveryState = new Map<string, DiscoveryMetricState>();

  constructor(private dbDatasource: DbDatasource) {
    // Start with empty discovery state - populated on writes
  }

  async writeMetrics(
    metricsData: datasource.MetricsData
  ): Promise<datasource.MetricsPartialSuccess> {
    const result = await this.dbDatasource.writeMetrics(metricsData);

    // Update in-memory discovery state
    for (const resourceMetric of metricsData.resourceMetrics ?? []) {
      const { resource } = resourceMetric;
      const resourceAttrs = this.extractResourceAttributes(resource);

      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        for (const metric of scopeMetric.metrics ?? []) {
          const metricType = this.getMetricType(metric);
          if (!metricType) continue;

          const metricKey = `${metric.name}:${metricType}`;
          let state = this.discoveryState.get(metricKey);
          if (!state) {
            state = {
              name: metric.name ?? "",
              type: metricType,
              unit: metric.unit || undefined,
              description: metric.description || undefined,
              attributes: new Map(),
              resourceAttributes: new Map(),
            };
            this.discoveryState.set(metricKey, state);
          }

          // Update resource attributes
          for (const [key, value] of Object.entries(resourceAttrs)) {
            if (!state.resourceAttributes.has(key)) {
              state.resourceAttributes.set(key, new Set());
            }
            state.resourceAttributes.get(key)!.add(String(value));
          }

          // Update metric attributes from data points
          const dataPoints = this.getDataPoints(metric);
          for (const dp of dataPoints) {
            const attrs = this.extractAttributes(dp.attributes);
            for (const [key, value] of Object.entries(attrs)) {
              if (!state.attributes.has(key)) {
                state.attributes.set(key, new Set());
              }
              state.attributes.get(key)!.add(String(value));
            }
          }
        }
      }
    }

    return result;
  }

  async writeTraces(
    tracesData: datasource.TracesData
  ): Promise<datasource.TracesPartialSuccess> {
    return this.dbDatasource.writeTraces(tracesData);
  }

  async writeLogs(
    logsData: datasource.LogsData
  ): Promise<datasource.LogsPartialSuccess> {
    return this.dbDatasource.writeLogs(logsData);
  }

  async getTraces(filter: dataFilterSchemas.TracesDataFilter): Promise<{
    data: denormalizedSignals.OtelTracesRow[];
    nextCursor: string | null;
  }> {
    return this.dbDatasource.getTraces(filter);
  }

  async getMetrics(filter: dataFilterSchemas.MetricsDataFilter): Promise<{
    data: denormalizedSignals.OtelMetricsRow[];
    nextCursor: string | null;
  }> {
    return this.dbDatasource.getMetrics(filter);
  }

  async getLogs(filter: dataFilterSchemas.LogsDataFilter): Promise<{
    data: denormalizedSignals.OtelLogsRow[];
    nextCursor: string | null;
  }> {
    return this.dbDatasource.getLogs(filter);
  }

  async discoverMetrics(): Promise<datasource.MetricsDiscoveryResult> {
    // Return from in-memory state (O(1))
    const metrics: datasource.DiscoveredMetric[] = [];

    for (const state of this.discoveryState.values()) {
      // Process attributes with truncation
      let attrsTruncated = false;
      const attributes: Record<string, string[]> = {};
      for (const [key, valueSet] of state.attributes) {
        const values = Array.from(valueSet);
        if (values.length > MAX_ATTR_VALUES) {
          attrsTruncated = true;
          attributes[key] = values.slice(0, MAX_ATTR_VALUES);
        } else {
          attributes[key] = values;
        }
      }

      // Process resource attributes with truncation
      let resAttrsTruncated = false;
      const resourceAttributes: Record<string, string[]> = {};
      for (const [key, valueSet] of state.resourceAttributes) {
        const values = Array.from(valueSet);
        if (values.length > MAX_ATTR_VALUES) {
          resAttrsTruncated = true;
          resourceAttributes[key] = values.slice(0, MAX_ATTR_VALUES);
        } else {
          resourceAttributes[key] = values;
        }
      }

      metrics.push({
        name: state.name,
        type: state.type,
        unit: state.unit,
        description: state.description,
        attributes: {
          values: attributes,
          ...(attrsTruncated && { _truncated: true }),
        },
        resourceAttributes: {
          values: resourceAttributes,
          ...(resAttrsTruncated && { _truncated: true }),
        },
      });
    }

    return { metrics };
  }

  private getMetricType(metric: {
    gauge?: unknown;
    sum?: unknown;
    histogram?: unknown;
    exponentialHistogram?: unknown;
    summary?: unknown;
  }): datasource.MetricType | null {
    if (metric.gauge) return "Gauge";
    if (metric.sum) return "Sum";
    if (metric.histogram) return "Histogram";
    if (metric.exponentialHistogram) return "ExponentialHistogram";
    if (metric.summary) return "Summary";
    return null;
  }

  private getDataPoints(metric: {
    gauge?: {
      dataPoints?: { attributes?: { key?: string; value?: unknown }[] }[];
    };
    sum?: {
      dataPoints?: { attributes?: { key?: string; value?: unknown }[] }[];
    };
    histogram?: {
      dataPoints?: { attributes?: { key?: string; value?: unknown }[] }[];
    };
    exponentialHistogram?: {
      dataPoints?: { attributes?: { key?: string; value?: unknown }[] }[];
    };
    summary?: {
      dataPoints?: { attributes?: { key?: string; value?: unknown }[] }[];
    };
  }): { attributes?: { key?: string; value?: unknown }[] }[] {
    if (metric.gauge) return metric.gauge.dataPoints ?? [];
    if (metric.sum) return metric.sum.dataPoints ?? [];
    if (metric.histogram) return metric.histogram.dataPoints ?? [];
    if (metric.exponentialHistogram)
      return metric.exponentialHistogram.dataPoints ?? [];
    if (metric.summary) return metric.summary.dataPoints ?? [];
    return [];
  }

  private extractResourceAttributes(
    resource: { attributes?: { key?: string; value?: unknown }[] } | undefined
  ): Record<string, unknown> {
    if (!resource?.attributes) return {};
    const result: Record<string, unknown> = {};
    for (const attr of resource.attributes) {
      if (attr.key) {
        result[attr.key] = this.extractAnyValue(attr.value);
      }
    }
    return result;
  }

  private extractAttributes(
    attributes: { key?: string; value?: unknown }[] | undefined
  ): Record<string, unknown> {
    if (!attributes) return {};
    const result: Record<string, unknown> = {};
    for (const attr of attributes) {
      if (attr.key) {
        result[attr.key] = this.extractAnyValue(attr.value);
      }
    }
    return result;
  }

  private extractAnyValue(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    const v = value as Record<string, unknown>;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.boolValue !== undefined) return v.boolValue;
    if (v.intValue !== undefined) return v.intValue;
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.bytesValue !== undefined) return v.bytesValue;
    return value;
  }
}

export function createOptimizedDatasource(
  sqliteConnection: DatabaseSync
): OptimizedDatasource {
  const dbDs = new DbDatasource(sqliteConnection);
  return new OptimizedDatasource(dbDs);
}
