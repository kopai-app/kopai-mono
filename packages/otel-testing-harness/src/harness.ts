import fastify from "fastify";
import { collectorRoutes } from "@kopai/collector";
import { initializeDatabase, DbDatasource } from "@kopai/sqlite-datasource";
import type { datasource } from "@kopai/core";
import type { DatabaseSync } from "node:sqlite";

export interface OtelTestingHarnessOptions {
  port?: number;
  host?: string;
}

export interface OtelTestingHarness {
  port: number;
  getTraces: datasource.ReadTracesDatasource["getTraces"];
  getLogs: datasource.ReadLogsDatasource["getLogs"];
  getMetrics: datasource.ReadMetricsDatasource["getMetrics"];
  discoverMetrics: datasource.ReadMetricsDatasource["discoverMetrics"];
  clear(): Promise<void>;
  stop(): Promise<void>;
  datasource: datasource.TelemetryDatasource;
}

const OTEL_TABLES = [
  "otel_logs",
  "otel_traces",
  "otel_traces_trace_id_ts",
  "otel_metrics_gauge",
  "otel_metrics_sum",
  "otel_metrics_histogram",
  "otel_metrics_exponential_histogram",
  "otel_metrics_summary",
] as const;

function isAddressInUseError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error)) return false;
  return error.code === "EADDRINUSE";
}

export async function createOtelTestingHarness(
  opts?: OtelTestingHarnessOptions
): Promise<OtelTestingHarness> {
  const port = opts?.port ?? 4318;
  const host = opts?.host ?? "localhost";

  const database: DatabaseSync = initializeDatabase(":memory:");
  const ds = new DbDatasource(database);

  const server = fastify({ logger: false });
  server.register(collectorRoutes, {
    telemetryDatasource: ds,
  });

  try {
    await server.listen({ port, host });
  } catch (error) {
    database.close();
    if (isAddressInUseError(error)) {
      throw new Error(
        `Port ${port} is already in use. Choose a different port or use port: 0 for a random port.`,
        { cause: error }
      );
    }
    throw error;
  }

  const addr = server.addresses()[0];
  if (!addr) {
    database.close();
    await server.close();
    throw new Error("Failed to get server address");
  }
  const actualPort = addr.port;

  return {
    port: actualPort,
    datasource: ds,
    getTraces: (filter) => ds.getTraces(filter),
    getLogs: (filter) => ds.getLogs(filter),
    getMetrics: (filter) => ds.getMetrics(filter),
    discoverMetrics: (...args: Parameters<typeof ds.discoverMetrics>) =>
      ds.discoverMetrics(...args),
    async clear() {
      for (const table of OTEL_TABLES) {
        database.exec(`DELETE FROM ${table}`);
      }
    },
    async stop() {
      await server.close();
      database.close();
    },
  };
}
