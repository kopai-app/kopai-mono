import { useMemo } from "react";
import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { TraceDetail } from "../index.js";
import { TraceSearch } from "../TraceSearch/index.js";
import type { TraceSummary } from "../TraceSearch/index.js";
import type { denormalizedSignals, dataFilterSchemas } from "@kopai/core";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;
type TraceSummaryRow = dataFilterSchemas.TraceSummaryRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.TraceDetail
>;

function isTraceSummariesSource(props: Props & { hasData: true }): boolean {
  return props.element.dataSource?.method === "searchTraceSummariesPage";
}

function TraceSummariesView({
  data,
  loading,
  error,
}: {
  data: unknown;
  loading: boolean;
  error: Error | null;
}) {
  const response = data as { data?: TraceSummaryRow[] } | null;

  const traces = useMemo<TraceSummary[]>(() => {
    if (!response?.data) return [];
    return response.data.map((row) => ({
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
  }, [response]);

  return (
    <TraceSearch
      services={[]}
      service=""
      traces={traces}
      isLoading={loading}
      error={error ?? undefined}
      onSelectTrace={() => {}}
    />
  );
}

export function OtelTraceDetail(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  if (isTraceSummariesSource(props)) {
    return (
      <TraceSummariesView
        data={props.data}
        loading={props.loading}
        error={props.error}
      />
    );
  }

  const response = props.data as { data?: OtelTracesRow[] } | null;
  const rows = response?.data ?? [];
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
