import { DatabaseSync, type StatementSync } from "node:sqlite";

import type {
  MetricsData,
  TelemetryDatasource,
  MetricsPartialSuccess,
} from "@kopai/core";
import type { OtelMetricsGauge as DenormalizedOtelMetricsGauge } from "./db-types.js";

export class NodeSqliteTelemetryDatasource implements TelemetryDatasource {
  private insertGaugeMetricsStatement: StatementSync;
  constructor(private sqliteConnection: DatabaseSync) {
    this.insertGaugeMetricsStatement = this.sqliteConnection.prepare(
      //TODO: define
      "INSERT INTO data (key, value) VALUES (?, ?)"
    );
  }

  async writeMetrics(metricsData: MetricsData): Promise<MetricsPartialSuccess> {
    this.insertGaugeMetricsStatement.run(1, "hello");

    const otelMetricGauges = [];

    for (const metric of metricsData.resourceMetrics ?? []) {
      const metricResource = metric.resource;
      for (const scopeMetric of metric.scopeMetrics ?? []) {
        const scope = scopeMetric.scope;
        for (const metric of scopeMetric.metrics ?? []) {
          if ("gauge" in metric && typeof metric.gauge !== "undefined") {
            otelMetricGauges.push(
              toOtelMetricsGauge(metricResource, scope, metric)
            );
          }
        }
      }
    }

    // TODO: execute insertGaugeMetricsStatement on all otelMetricGauges

    return {
      rejectedDataPoints: "",
    };
  }
}

function toOtelMetricsGauge(): DenormalizedOtelMetricsGauge {
  // TODO: implement
  return {};
}
