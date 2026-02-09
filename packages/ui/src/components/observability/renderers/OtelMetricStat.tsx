import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricStat } from "../index.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricStat
>;

function formatOtelValue(value: number, unit: string): string {
  // OTel unit "1" = dimensionless ratio → show as percentage
  if (unit === "1") return `${(value * 100).toFixed(1)}%`;
  // OTel curly-brace units like "{request}" → strip braces
  const cleanUnit = unit.replace(/^\{|\}$/g, "");
  let formatted: string;
  if (Math.abs(value) >= 1e6) formatted = `${(value / 1e6).toFixed(1)}M`;
  else if (Math.abs(value) >= 1e3) formatted = `${(value / 1e3).toFixed(1)}K`;
  else if (Number.isInteger(value)) formatted = value.toString();
  else formatted = value.toFixed(2);
  return cleanUnit ? `${formatted} ${cleanUnit}` : formatted;
}

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
