import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { TraceDetail } from "../index.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.TraceDetail
>;

export function OtelTraceDetail(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  const response = props.data as { data?: OtelTracesRow[] } | null;

  return (
    <TraceDetail
      rows={response?.data ?? []}
      isLoading={props.loading}
      error={props.error ?? undefined}
      service=""
      traceId=""
      onBack={() => {}}
    />
  );
}
