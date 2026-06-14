import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricLeaderboard } from "../MetricLeaderboard/index.js";
import { formatOtelValue } from "../utils/units.js";
import { NoDataSource } from "./NoDataSource.js";
import type { denormalizedSignals } from "@kopai/core";

// Both AggregatedMetricRow and AggregatedLogRow share the same {groups, value}
// shape, so the renderer can consume either via a common type.
type AggregatedRow = denormalizedSignals.AggregatedMetricRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricLeaderboard
>;

type AggregatedDataProps = Props & {
  hasData: true;
  response: { data: AggregatedRow[]; nextCursor: null } | null;
};

function isAggregatedRequest(
  props: Props & { hasData: true }
): props is AggregatedDataProps {
  const method = props.element.dataSource?.method;
  return (
    method === "searchAggregatedMetrics" || method === "searchLogsAggregate"
  );
}

export function OtelMetricLeaderboard(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  const rows: AggregatedRow[] = isAggregatedRequest(props)
    ? (props.response?.data ?? [])
    : [];

  return (
    <MetricLeaderboard
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      maxRows={props.element.props.maxRows ?? undefined}
      unit={props.element.props.unit ?? undefined}
      showBar={props.element.props.showBar ?? undefined}
      label={props.element.props.label ?? undefined}
      formatValue={(v, u) => formatOtelValue(v, u ?? "")}
    />
  );
}
