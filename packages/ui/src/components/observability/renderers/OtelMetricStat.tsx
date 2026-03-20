import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricStat } from "../index.js";
import { formatOtelValue } from "../utils/units.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricStat
>;

interface AggregatedRow {
  groups: Record<string, unknown>;
  value: number;
}

function isAggregatedResponse(
  data: unknown
): data is { data: AggregatedRow[] } {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.data) || obj.data.length === 0) return false;
  const first = obj.data[0] as Record<string, unknown> | undefined;
  return first !== undefined && "groups" in first && "value" in first;
}

export function OtelMetricStat(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  if (isAggregatedResponse(props.data)) {
    const firstRow = props.data.data[0] as AggregatedRow | undefined;
    return (
      <MetricStat
        rows={[]}
        value={firstRow?.value}
        isLoading={props.loading}
        error={props.error ?? undefined}
        label={props.element.props.label ?? undefined}
        showSparkline={false}
        formatValue={formatOtelValue}
      />
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
