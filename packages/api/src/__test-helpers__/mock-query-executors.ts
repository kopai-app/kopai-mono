import { vi } from "vitest";
import type { datasource } from "@kopai/core";

/**
 * Default stubs for the three `execute{Traces,Logs,Metrics}Query` datasource
 * methods. Returns empty, non-aggregated results — tests override per-call
 * with `.mockResolvedValueOnce(...)` when they need a different shape.
 */
export function mockQueryExecutors(): {
  executeTracesQuery: ReturnType<
    typeof vi.fn<datasource.ReadTracesDatasource["executeTracesQuery"]>
  >;
  executeLogsQuery: ReturnType<
    typeof vi.fn<datasource.ReadLogsDatasource["executeLogsQuery"]>
  >;
  executeMetricsQuery: ReturnType<
    typeof vi.fn<datasource.ReadMetricsDatasource["executeMetricsQuery"]>
  >;
} {
  const empty = { rows: [], cursor: null, isAgg: false };
  return {
    executeTracesQuery: vi
      .fn<datasource.ReadTracesDatasource["executeTracesQuery"]>()
      .mockResolvedValue(empty),
    executeLogsQuery: vi
      .fn<datasource.ReadLogsDatasource["executeLogsQuery"]>()
      .mockResolvedValue(empty),
    executeMetricsQuery: vi
      .fn<datasource.ReadMetricsDatasource["executeMetricsQuery"]>()
      .mockResolvedValue(empty),
  };
}
