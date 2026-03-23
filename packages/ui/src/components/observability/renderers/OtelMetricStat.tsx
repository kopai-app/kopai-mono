import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricStat } from "../index.js";
import { formatOtelValue } from "../utils/units.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;
type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricStat
>;

const EMPTY_ROWS: never[] = [];
const GROUPED_AGGREGATE_ERROR = new Error(
  "MetricStat cannot display grouped aggregates. Remove groupBy or use MetricTable."
);

function isAggregatedRequest(props: Props & { hasData: true }): boolean {
  const ds = props.element.dataSource;
  if (!ds || ds.method !== "searchMetricsPage" || !ds.params) return false;
  return !!ds.params.aggregate;
}

export function OtelMetricStat(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  if (isAggregatedRequest(props)) {
    const response = props.data as { data: AggregatedMetricRow[] } | null;
    const rows = response?.data ?? [];

    if (rows.length > 1) {
      return (
        <MetricStat
          rows={EMPTY_ROWS}
          error={GROUPED_AGGREGATE_ERROR}
          label={props.element.props.label ?? undefined}
          formatValue={formatOtelValue}
        />
      );
    }

    return (
      <MetricStat
        rows={EMPTY_ROWS}
        value={rows[0]?.value}
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
