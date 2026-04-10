import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { MetricStat } from "../index.js";
import { formatOtelValue } from "../utils/units.js";
import { NoDataSource } from "./NoDataSource.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricStat
>;

type AggregatedDataProps = Props & {
  hasData: true;
  response: { data: AggregatedMetricRow[]; nextCursor: null } | null;
};

const EMPTY_ROWS: never[] = [];
const GROUPED_AGGREGATE_ERROR = new Error(
  "MetricStat cannot display grouped aggregates. Remove groupBy or use MetricTable."
);

function isAggregatedRequest(
  props: Props & { hasData: true }
): props is AggregatedDataProps {
  return props.element.dataSource?.method === "searchAggregatedMetrics";
}

export function OtelMetricStat(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  if (isAggregatedRequest(props)) {
    const rows = props.response?.data ?? [];

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

  const rows = props.response?.data ?? [];

  return (
    <MetricStat
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      label={props.element.props.label ?? undefined}
      showSparkline={props.element.props.showSparkline ?? false}
      formatValue={formatOtelValue}
    />
  );
}
