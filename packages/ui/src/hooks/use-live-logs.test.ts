/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useLiveLogs } from "./use-live-logs.js";
import {
  KopaiSDKProvider,
  queryClient,
  type KopaiClient,
} from "../providers/kopai-provider.js";

const BASE_NS = 1700000000000000000n;
const ts = (offsetMs: number) =>
  (BASE_NS + BigInt(offsetMs) * 1000000n).toString();

const createMockClient = () => ({
  searchTracesPage: vi.fn(),
  searchLogsPage: vi.fn(),
  searchMetricsPage: vi.fn(),
  getTrace: vi.fn(),
  discoverMetrics: vi.fn(),
});

function wrapper(client: KopaiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KopaiSDKProvider, { client, children });
  };
}

describe("useLiveLogs", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    queryClient.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns logs on initial load", async () => {
    const batch = [
      {
        Timestamp: ts(100),
        Body: "log1",
        ServiceName: "svc",
        SeverityNumber: 9,
      },
      {
        Timestamp: ts(200),
        Body: "log2",
        ServiceName: "svc",
        SeverityNumber: 9,
      },
    ];

    mockClient.searchLogsPage.mockResolvedValue({
      data: batch,
      nextCursor: null,
    });

    const { result } = renderHook(
      () =>
        useLiveLogs({
          params: { limit: 200 },
          pollIntervalMs: 60_000, // long interval so no refetch during test
        }),
      { wrapper: wrapper(mockClient) }
    );

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(2);
    });

    expect(result.current.totalReceived).toBe(2);
    expect(result.current.isLive).toBe(true);
    expect(result.current.error).toBeNull();

    // First call should not have timestampMin
    const firstCall = mockClient.searchLogsPage.mock.calls[0]![0];
    expect(firstCall.timestampMin).toBeUndefined();
  });

  it("uses timestampMin on manual refetch after first load", async () => {
    mockClient.searchLogsPage
      .mockResolvedValueOnce({
        data: [
          {
            Timestamp: ts(100),
            Body: "log1",
            ServiceName: "svc",
            SeverityNumber: 9,
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            Timestamp: ts(300),
            Body: "log3",
            ServiceName: "svc",
            SeverityNumber: 9,
          },
        ],
        nextCursor: null,
      });

    const { result } = renderHook(
      () =>
        useLiveLogs({
          params: { limit: 200 },
          pollIntervalMs: 600_000,
        }),
      { wrapper: wrapper(mockClient) }
    );

    // Wait for first fetch
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1);
    });

    // Pause then resume to trigger refetch
    act(() => {
      result.current.setLive(false);
    });
    act(() => {
      result.current.setLive(true);
    });

    await waitFor(
      () => {
        expect(
          mockClient.searchLogsPage.mock.calls.length
        ).toBeGreaterThanOrEqual(2);
      },
      { timeout: 3000 }
    );

    // The refetch call(s) after first should have timestampMin
    const calls = mockClient.searchLogsPage.mock.calls;
    const expectedMin = String(BigInt(ts(100)) + 1n);
    const callsWithTimestampMin = calls.filter(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).timestampMin !== undefined
    );
    expect(callsWithTimestampMin.length).toBeGreaterThan(0);
    expect(callsWithTimestampMin[0]![0].timestampMin).toBe(expectedMin);
  });

  it("setLive(false) sets isLive to false", async () => {
    mockClient.searchLogsPage.mockResolvedValue({ data: [], nextCursor: null });

    const { result } = renderHook(
      () =>
        useLiveLogs({
          params: { limit: 200 },
          pollIntervalMs: 600_000,
        }),
      { wrapper: wrapper(mockClient) }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isLive).toBe(true);

    act(() => {
      result.current.setLive(false);
    });

    expect(result.current.isLive).toBe(false);
  });

  it("starts as live by default", async () => {
    mockClient.searchLogsPage.mockResolvedValue({ data: [], nextCursor: null });

    const { result } = renderHook(
      () =>
        useLiveLogs({
          params: { limit: 200 },
        }),
      { wrapper: wrapper(mockClient) }
    );

    expect(result.current.isLive).toBe(true);
  });
});
