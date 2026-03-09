import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricStat } from "../index.js";
import { formatOtelValue } from "../utils/units.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricStat
>;

export function OtelMetricStat(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  const response = props.data as { data?: OtelMetricsRow[] } | null;

  return (
    <MetricStat
      rows={response?.data ?? []}
      isLoading={props.loading}
      error={props.error ?? undefined}
      label={props.element.props.label ?? undefined}
      showSparkline={props.element.props.showSparkline ?? false}
      formatValue={formatOtelValue}
    />
  );
}
