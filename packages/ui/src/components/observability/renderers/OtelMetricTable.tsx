import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricTable } from "../index.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTable
>;

export function OtelMetricTable(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  return (
    <MetricTable
      rows={props.response?.data ?? []}
      isLoading={props.loading}
      error={props.error ?? undefined}
      maxRows={props.element.props.maxRows ?? 100}
    />
  );
}
