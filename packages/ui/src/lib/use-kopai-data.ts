import { useState, useEffect, useCallback, useRef } from "react";
import type { DataSource } from "./component-catalog.js";
import { useKopaiSDK } from "./kopai-provider.js";

export interface UseKopaiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: (newParams?: Record<string, unknown>) => void;
}

export function useKopaiData<T = unknown>(
  dataSource: DataSource | undefined
): UseKopaiDataResult<T> {
  const client = useKopaiSDK();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const paramsOverrideRef = useRef<Record<string, unknown> | undefined>(
    undefined
  );

  const fetchData = useCallback(
    async (signal: AbortSignal, params: Record<string, unknown>) => {
      if (!dataSource) return;

      setLoading(true);
      setError(null);

      try {
        let result: unknown;

        switch (dataSource.method) {
          case "searchTracesPage":
            result = await client.searchTracesPage(
              { ...dataSource.params, ...params } as Parameters<
                typeof client.searchTracesPage
              >[0],
              { signal }
            );
            break;
          case "searchLogsPage":
            result = await client.searchLogsPage(
              { ...dataSource.params, ...params } as Parameters<
                typeof client.searchLogsPage
              >[0],
              { signal }
            );
            break;
          case "searchMetricsPage":
            result = await client.searchMetricsPage(
              { ...dataSource.params, ...params } as Parameters<
                typeof client.searchMetricsPage
              >[0],
              { signal }
            );
            break;
          case "getTrace":
            result = await client.getTrace(
              (params.traceId as string) ?? dataSource.params.traceId,
              { signal }
            );
            break;
          case "discoverMetrics":
            result = await client.discoverMetrics({ signal });
            break;
          default: {
            const exhaustiveCheck: never = dataSource;
            throw new Error(
              `Unknown method: ${(exhaustiveCheck as DataSource).method}`
            );
          }
        }

        if (!signal.aborted) {
          setData(result as T);
        }
      } catch (err) {
        if (!signal.aborted) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [client, dataSource]
  );

  useEffect(() => {
    if (!dataSource) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cancel previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    fetchData(controller.signal, paramsOverrideRef.current ?? {});

    return () => {
      controller.abort();
    };
  }, [dataSource, fetchData]);

  const refetch = useCallback(
    (newParams?: Record<string, unknown>) => {
      paramsOverrideRef.current = newParams;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      fetchData(controller.signal, newParams ?? {});
    },
    [fetchData]
  );

  return { data, loading, error, refetch };
}
