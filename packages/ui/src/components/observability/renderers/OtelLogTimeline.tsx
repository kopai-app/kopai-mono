import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { LogTimeline } from "../index.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.LogTimeline
>;

export function OtelLogTimeline(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  const response = props.data as { data?: OtelLogsRow[] } | null;

  return (
    <LogTimeline
      rows={response?.data ?? []}
      isLoading={props.loading}
      error={props.error ?? undefined}
    />
  );
}
