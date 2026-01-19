interface MetricsData {} // this should come from a Zod schema

/*
 * example:
 *
 * {
 * "rejectedDataPoints": "42",
 * "errorMessage": "quota exceeded for tenant abc123"
 * }
 */
interface PartialSuccess {
  // The number of rejected data points.
  rejectedDataPoints?: string;

  // Developer-facing message explaining why/how to fix
  errorMessage?: string;
}

// TODO: implementations: console.log, sequelize, clickhouse
export interface WriteMetricsDatasource {
  writeMetrics(metricsData: MetricsData): Promise<PartialSuccess>;
}
