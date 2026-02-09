import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { denormalizedSignals, dataFilterSchemas } from "@kopai/core";
import { useKopaiSDK } from "../providers/kopai-provider.js";
import { LogBuffer } from "../lib/log-buffer.js";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;
type LogsDataFilter = dataFilterSchemas.LogsDataFilter;

export interface UseLiveLogsOptions {
  params: LogsDataFilter;
  pollIntervalMs?: number;
  maxLogs?: number;
  enabled?: boolean;
}

export interface UseLiveLogsResult {
  logs: OtelLogsRow[];
  isLive: boolean;
  totalReceived: number;
  loading: boolean;
  error: Error | null;
  setLive: (live: boolean) => void;
}

export function useLiveLogs({
  params,
  pollIntervalMs = 3_000,
  maxLogs = 1_000,
  enabled = true,
}: UseLiveLogsOptions): UseLiveLogsResult {
  const client = useKopaiSDK();
  const bufferRef = useRef(new LogBuffer(maxLogs));
  const [version, setVersion] = useState(0);
  const [isLive, setIsLiveState] = useState(true);
  const totalReceivedRef = useRef(0);
  const hasFetchedOnce = useRef(false);

  // Reset buffer when params change so stale data from a previous filter
  // doesn't persist while the new query is in flight.
  const paramsKey = JSON.stringify(params);
  const prevParamsKey = useRef(paramsKey);
  useEffect(() => {
    if (prevParamsKey.current !== paramsKey) {
      prevParamsKey.current = paramsKey;
      bufferRef.current.clear();
      hasFetchedOnce.current = false;
      totalReceivedRef.current = 0;
      setVersion((v) => v + 1);
    }
  }, [paramsKey]);

  const { isFetching, error, refetch } = useQuery<
    { data: OtelLogsRow[]; nextCursor: string | null },
    Error
  >({
    queryKey: ["live-logs", params],
    queryFn: async ({ signal }) => {
      const fetchParams: LogsDataFilter = { ...params };

      // After first fetch, only get newer logs
      if (hasFetchedOnce.current) {
        const newest = bufferRef.current.getNewestTimestamp();
        if (newest) {
          // Add 1ns to avoid re-fetching the same row
          fetchParams.timestampMin = String(BigInt(newest) + 1n);
        }
      }

      const result = await client.searchLogsPage(fetchParams, { signal });
      hasFetchedOnce.current = true;

      if (result.data.length > 0) {
        totalReceivedRef.current += result.data.length;
        bufferRef.current.merge(result.data);
        setVersion((v) => v + 1);
      }

      return result;
    },
    enabled: enabled,
    refetchInterval: isLive ? pollIntervalMs : false,
  });

  const setLive = useCallback(
    (live: boolean) => {
      setIsLiveState(live);
      if (live) {
        // Immediate refetch on resume
        refetch();
      }
    },
    [refetch]
  );

  // Read buffer (version forces re-render)
  void version;
  const logs = bufferRef.current.getAll();

  return {
    logs,
    isLive,
    totalReceived: totalReceivedRef.current,
    loading: isFetching,
    error: error ?? null,
    setLive,
  };
}
