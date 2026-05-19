/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useKopaiData } from "./use-kopai-data.js";
import {
  KopaiSDKProvider,
  queryClient,
  type KopaiClient,
} from "../providers/kopai-provider.js";
import type { DataSource } from "../lib/component-catalog.js";

const createMockClient = () => ({
  searchTracesPage: vi.fn(),
  searchLogsPage: vi.fn(),
  searchMetricsPage: vi.fn(),
  searchAggregatedMetrics: vi.fn(),
  getTrace: vi.fn(),
  discoverMetrics: vi.fn(),
  getDashboard: vi.fn(),
  getServices: vi.fn(),
  getOperations: vi.fn(),
  searchTraceSummariesPage: vi.fn(),
  queryTracesRaw: vi.fn(),
  queryTracesAggregate: vi.fn(),
  queryLogsRaw: vi.fn(),
  queryLogsAggregate: vi.fn(),
  queryMetricsRaw: vi.fn(),
  queryMetricsAggregate: vi.fn(),
});

type MockClient = ReturnType<typeof createMockClient>;

function wrapper(client: KopaiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KopaiSDKProvider, { client, children });
  };
}

describe("useKopaiData", () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    queryClient.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("returns null data when no dataSource", () => {
      const { result } = renderHook(() => useKopaiData(undefined), {
        wrapper: wrapper(mockClient),
      });

      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe("searchTracesPage", () => {
    it("fetches traces and updates state", async () => {
      const mockData = { data: [{ traceId: "123" }], nextCursor: null };
      mockClient.searchTracesPage.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "searchTracesPage",
        params: { serviceName: "test-service" },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(result.current.error).toBeNull();
      expect(mockClient.searchTracesPage).toHaveBeenCalledWith(
        { serviceName: "test-service" },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("handles errors", async () => {
      const error = new Error("Network error");
      mockClient.searchTracesPage.mockRejectedValue(error);

      const dataSource: DataSource = {
        method: "searchTracesPage",
        params: {},
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toEqual(error);
      expect(result.current.data).toBeNull();
    });
  });

  describe("searchLogsPage", () => {
    it("fetches logs", async () => {
      const mockData = { data: [{ body: "log entry" }], nextCursor: null };
      mockClient.searchLogsPage.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "searchLogsPage",
        params: { serviceName: "test-service" },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.searchLogsPage).toHaveBeenCalled();
    });
  });

  describe("searchMetricsPage", () => {
    it("fetches metrics", async () => {
      const mockData = { data: [{ metricName: "cpu" }], nextCursor: null };
      mockClient.searchMetricsPage.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "searchMetricsPage",
        params: { metricType: "Gauge" },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.searchMetricsPage).toHaveBeenCalled();
    });

    it("calls searchAggregatedMetrics for searchAggregatedMetrics method", async () => {
      const mockData = {
        data: [{ groups: { signal: "/v1/traces" }, value: 1024 }],
        nextCursor: null,
      };
      mockClient.searchAggregatedMetrics.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "searchAggregatedMetrics",
        params: {
          metricType: "Sum",
          metricName: "kopai.ingestion.bytes",
          aggregate: "sum",
          groupBy: ["signal"],
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.searchAggregatedMetrics).toHaveBeenCalledWith(
        {
          metricType: "Sum",
          metricName: "kopai.ingestion.bytes",
          aggregate: "sum",
          groupBy: ["signal"],
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(mockClient.searchMetricsPage).not.toHaveBeenCalled();
    });
  });

  describe("getTrace", () => {
    it("fetches single trace", async () => {
      const mockData = [{ traceId: "abc", spanId: "123" }];
      mockClient.getTrace.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "getTrace",
        params: { traceId: "abc" },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.getTrace).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe("discoverMetrics", () => {
    it("discovers metrics", async () => {
      const mockData = { metrics: [{ name: "cpu_usage", type: "Gauge" }] };
      mockClient.discoverMetrics.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "discoverMetrics",
        params: {},
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.discoverMetrics).toHaveBeenCalled();
    });
  });

  describe("refetch", () => {
    it("refetches same query on refetch()", async () => {
      const mockData1 = { data: [{ id: "1" }], nextCursor: "cursor1" };
      const mockData2 = { data: [{ id: "2" }], nextCursor: null };
      mockClient.searchTracesPage
        .mockResolvedValueOnce(mockData1)
        .mockResolvedValueOnce(mockData2);

      const dataSource: DataSource = {
        method: "searchTracesPage",
        params: { limit: 10 },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData1);
      });

      act(() => {
        result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(mockData2);
      });

      expect(mockClient.searchTracesPage).toHaveBeenCalledTimes(2);
    });
  });

  describe("dataSource change", () => {
    it("triggers new fetch when dataSource changes", async () => {
      const tracesData = { data: [{ traceId: "t1" }] };
      const logsData = { data: [{ body: "log1" }] };
      mockClient.searchTracesPage.mockResolvedValue(tracesData);
      mockClient.searchLogsPage.mockResolvedValue(logsData);

      const { result, rerender } = renderHook(
        ({ ds }: { ds: DataSource }) => useKopaiData(ds),
        {
          wrapper: wrapper(mockClient),
          initialProps: {
            ds: { method: "searchTracesPage", params: {} } as DataSource,
          },
        }
      );

      await waitFor(() => {
        expect(result.current.data).toEqual(tracesData);
      });

      rerender({
        ds: { method: "searchLogsPage", params: {} } as DataSource,
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(logsData);
      });

      expect(mockClient.searchTracesPage).toHaveBeenCalledTimes(1);
      expect(mockClient.searchLogsPage).toHaveBeenCalledTimes(1);
    });
  });

  describe("KopaiQuery methods", () => {
    const relativeTime = {
      type: "relative" as const,
      lookback: "2h",
    };

    it("calls queryTracesRaw with TraceRawQuery params", async () => {
      const mockData = {
        data: [{ traceId: "t1" }],
        nextCursor: null,
      };
      mockClient.queryTracesRaw.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryTracesRaw",
        params: {
          signal: "traces",
          mode: "raw",
          dimensions: ["SpanId", "Duration"],
          timeDimension: relativeTime,
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryTracesRaw).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("calls queryTracesAggregate with TraceAggregateQuery params", async () => {
      const mockData = { data: [{ n: 42 }] };
      mockClient.queryTracesAggregate.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryTracesAggregate",
        params: {
          signal: "traces",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "n" }],
          timeDimension: relativeTime,
          output: { type: "summary" },
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryTracesAggregate).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("calls queryLogsRaw with LogRawQuery params", async () => {
      const mockData = {
        data: [{ body: "log1" }],
        nextCursor: null,
      };
      mockClient.queryLogsRaw.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryLogsRaw",
        params: {
          signal: "logs",
          mode: "raw",
          dimensions: ["Timestamp", "Body"],
          timeDimension: relativeTime,
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryLogsRaw).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("calls queryLogsAggregate with LogAggregateQuery params", async () => {
      const mockData = { data: [{ n: 7 }] };
      mockClient.queryLogsAggregate.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryLogsAggregate",
        params: {
          signal: "logs",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "n" }],
          timeDimension: relativeTime,
          output: { type: "summary" },
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryLogsAggregate).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("calls queryMetricsRaw with MetricRawQuery params", async () => {
      const mockData = {
        data: [{ metricName: "cpu" }],
        nextCursor: null,
      };
      mockClient.queryMetricsRaw.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryMetricsRaw",
        params: {
          signal: "metrics",
          mode: "raw",
          dimensions: ["MetricName", "Value"],
          timeDimension: relativeTime,
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryMetricsRaw).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("calls queryMetricsAggregate with MetricAggregateQuery params", async () => {
      const mockData = {
        data: [{ bucket_start: "2024-01-01T00:00:00.000Z", n: 1 }],
      };
      mockClient.queryMetricsAggregate.mockResolvedValue(mockData);

      const dataSource: DataSource = {
        method: "queryMetricsAggregate",
        params: {
          signal: "metrics",
          mode: "aggregate",
          measures: [{ op: "COUNT", as: "n" }],
          timeDimension: relativeTime,
          output: { type: "timeSeries", granularity: "5m" },
        },
      };

      const { result } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
      expect(mockClient.queryMetricsAggregate).toHaveBeenCalledWith(
        dataSource.params,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe("cleanup", () => {
    it("cancels in-flight request on unmount", async () => {
      let abortSignal: AbortSignal | undefined;
      mockClient.searchTracesPage.mockImplementation(
        async (_: unknown, opts?: { signal?: AbortSignal }) => {
          abortSignal = opts?.signal;
          return new Promise(() => {});
        }
      );

      const dataSource: DataSource = {
        method: "searchTracesPage",
        params: {},
      };

      const { unmount } = renderHook(() => useKopaiData(dataSource), {
        wrapper: wrapper(mockClient),
      });

      await waitFor(() => {
        expect(abortSignal).toBeDefined();
      });

      unmount();

      expect(abortSignal?.aborted).toBe(true);
    });
  });
});
