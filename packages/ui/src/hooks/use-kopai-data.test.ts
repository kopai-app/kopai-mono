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
  getTrace: vi.fn(),
  discoverMetrics: vi.fn(),
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
