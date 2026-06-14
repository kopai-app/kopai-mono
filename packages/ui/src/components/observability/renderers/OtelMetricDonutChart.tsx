import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricDonutChart } from "../MetricDonutChart/index.js";
import { formatOtelValue } from "../utils/units.js";
import { NoDataSource } from "./NoDataSource.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricDonutChart
>;

type AggregatedDataProps = Props & {
  hasData: true;
  response: { data: AggregatedMetricRow[]; nextCursor: null } | null;
};

function isAggregatedRequest(
  props: Props & { hasData: true }
): props is AggregatedDataProps {
  return props.element.dataSource?.method === "searchAggregatedMetrics";
}

export function OtelMetricDonutChart(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  const rows: AggregatedMetricRow[] = isAggregatedRequest(props)
    ? (props.response?.data ?? [])
    : [];

  return (
    <MetricDonutChart
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      unit={props.element.props.unit ?? undefined}
      showLegend={props.element.props.showLegend ?? undefined}
      showLabels={props.element.props.showLabels ?? undefined}
      maxSlices={props.element.props.maxSlices ?? undefined}
      formatValue={(v, u) => formatOtelValue(v, u ?? "")}
    />
  );
}
