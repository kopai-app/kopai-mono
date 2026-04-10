import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { TraceDetail } from "../index.js";
import { TraceSearch } from "../TraceSearch/index.js";
import type { TraceSummary } from "../TraceSearch/index.js";
import { useKopaiSDK } from "../../../providers/kopai-provider.js";
import { NoDataSource } from "./NoDataSource.js";
import type { dataFilterSchemas } from "@kopai/core";
import type { OtelTracesRow, SearchResult } from "@kopai/sdk";

type TraceSummaryRow = dataFilterSchemas.TraceSummaryRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.TraceDetail
>;

type SummariesDataProps = Props & {
  hasData: true;
  response: SearchResult<TraceSummaryRow> | null;
};

function isTraceSummariesSource(
  props: Props & { hasData: true }
): props is SummariesDataProps {
  return props.element.dataSource?.method === "searchTraceSummariesPage";
}

function TraceSummariesView({
  data,
  loading,
  error,
}: {
  data: SearchResult<TraceSummaryRow> | null;
  loading: boolean;
  error: Error | null;
}) {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const client = useKopaiSDK();

  const traces = useMemo<TraceSummary[]>(() => {
    const rows = data?.data;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      traceId: row.traceId,
      rootSpanName: row.rootSpanName,
      serviceName: row.rootServiceName,
      durationMs: parseInt(row.durationNs, 10) / 1e6,
      statusCode: row.errorCount > 0 ? "ERROR" : "OK",
      timestampMs: parseInt(row.startTimeNs, 10) / 1e6,
      spanCount: row.spanCount,
      services: row.services,
      errorCount: row.errorCount,
    }));
  }, [data]);

  const {
    data: traceRows,
    isFetching: traceLoading,
    error: traceError,
  } = useQuery<OtelTracesRow[], Error>({
    queryKey: ["kopai", "getTrace", selectedTraceId],
    queryFn: ({ signal }) => client.getTrace(selectedTraceId!, { signal }),
    enabled: !!selectedTraceId,
  });

  const handleBack = useCallback(() => setSelectedTraceId(null), []);

  if (selectedTraceId) {
    return (
      <TraceDetail
        traceId={selectedTraceId}
        rows={traceRows ?? []}
        isLoading={traceLoading}
        error={traceError ?? undefined}
        onBack={handleBack}
      />
    );
  }

  return (
    <TraceSearch
      services={[]}
      service=""
      traces={traces}
      isLoading={loading}
      error={error ?? undefined}
      onSelectTrace={setSelectedTraceId}
    />
  );
}

export function OtelTraceDetail(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  if (isTraceSummariesSource(props)) {
    return (
      <TraceSummariesView
        data={props.response}
        loading={props.loading}
        error={props.error}
      />
    );
  }

  const rows = props.response?.data ?? [];
  const traceId = rows[0]?.TraceId ?? "";

  return (
    <TraceDetail
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      traceId={traceId}
      onBack={() => {}}
    />
  );
}
