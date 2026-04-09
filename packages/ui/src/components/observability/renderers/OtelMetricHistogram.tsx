import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricHistogram } from "../index.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricHistogram
>;

export function OtelMetricHistogram(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  return (
    <MetricHistogram
      rows={props.response?.data ?? []}
      isLoading={props.loading}
      error={props.error ?? undefined}
      height={props.element.props.height ?? 400}
      yAxisLabel={props.element.props.yAxisLabel ?? undefined}
      unit={props.element.props.unit ?? undefined}
    />
  );
}
