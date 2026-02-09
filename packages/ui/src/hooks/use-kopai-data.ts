import { useQuery } from "@tanstack/react-query";
import type { DataSource } from "../lib/component-catalog.js";
import { useKopaiSDK } from "../providers/kopai-provider.js";

export interface UseKopaiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

function fetchForDataSource(
  client: ReturnType<typeof useKopaiSDK>,
  dataSource: DataSource,
  signal: AbortSignal
): Promise<unknown> {
  switch (dataSource.method) {
    case "searchTracesPage":
      return client.searchTracesPage(
        dataSource.params as Parameters<typeof client.searchTracesPage>[0],
        { signal }
      );
    case "searchLogsPage":
      return client.searchLogsPage(
        dataSource.params as Parameters<typeof client.searchLogsPage>[0],
        { signal }
      );
    case "searchMetricsPage":
      return client.searchMetricsPage(
        dataSource.params as Parameters<typeof client.searchMetricsPage>[0],
        { signal }
      );
    case "getTrace":
      return client.getTrace(dataSource.params.traceId, { signal });
    case "discoverMetrics":
      return client.discoverMetrics({ signal });
    default: {
      const exhaustiveCheck: never = dataSource;
      throw new Error(
        `Unknown method: ${(exhaustiveCheck as DataSource).method}`
      );
    }
  }
}

export function useKopaiData<T = unknown>(
  dataSource: DataSource | undefined
): UseKopaiDataResult<T> {
  const client = useKopaiSDK();

  const { data, isFetching, error, refetch } = useQuery<unknown, Error>({
    queryKey: ["kopai", dataSource?.method, dataSource?.params],
    queryFn: ({ signal }) => fetchForDataSource(client, dataSource!, signal),
    enabled: !!dataSource,
  });

  return {
    data: (data as T) ?? null,
    loading: isFetching,
    error: error ?? null,
    refetch,
  };
}
