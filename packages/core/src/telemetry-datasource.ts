import type { tracesDataFilterSchema } from "./data-filters-zod.js";
import { otelTracesSchema } from "./denormalized-signals-zod.js";
import type { MetricsData, TracesData, LogsData } from "./otlp-generated.js";
export type { MetricsData } from "./otlp-metrics-generated.js";
export type { TracesData, LogsData } from "./otlp-generated.js";
import z from "zod";

/*
 * example:
 *
 * {
 * "rejectedDataPoints": "42",
 * "errorMessage": "quota exceeded for tenant abc123"
 * }
 */
export interface MetricsPartialSuccess {
  // The number of rejected data points.
  rejectedDataPoints?: string;

  // Developer-facing message explaining why/how to fix
  errorMessage?: string;
}

export interface WriteMetricsDatasource {
  writeMetrics(metricsData: MetricsData): Promise<MetricsPartialSuccess>;
}

export interface TracesPartialSuccess {
  rejectedSpans?: string;
  errorMessage?: string;
}

export interface WriteTracesDatasource {
  writeTraces(tracesData: TracesData): Promise<TracesPartialSuccess>;
}

export interface ReadTracesDatasource {
  getTraces(
    filter: z.infer<typeof tracesDataFilterSchema>
  ): Promise<z.infer<typeof otelTracesSchema>[]>;
}

export interface LogsPartialSuccess {
  rejectedLogRecords?: string;
  errorMessage?: string;
}

export interface WriteLogsDatasource {
  writeLogs(logsData: LogsData): Promise<LogsPartialSuccess>;
}

export type TelemetryDatasource = WriteMetricsDatasource &
  WriteTracesDatasource &
  WriteLogsDatasource;
