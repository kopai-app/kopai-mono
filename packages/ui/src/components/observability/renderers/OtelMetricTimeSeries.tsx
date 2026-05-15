import {
  observabilityCatalog,
  type RendererComponentProps,
} from "@kopai/ui-core";
import type { denormalizedSignals } from "@kopai/core";
import { MetricTimeSeries } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;
type TimeseriesMetricRow = denormalizedSignals.TimeseriesMetricRow;

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTimeSeries
>;

type TimeseriesDataProps = Props & {
  hasData: true;
  response: { data: TimeseriesMetricRow[]; nextCursor: null } | null;
};

function isTimeseriesRequest(
  props: Props & { hasData: true }
): props is TimeseriesDataProps {
  return props.element.dataSource?.method === "searchMetricsTimeSeries";
}

/**
 * Convert TimeseriesMetricRow[] (one row per (group, bucket)) into the
 * OtelMetricsRow[] shape the MetricTimeSeries component already understands.
 *
 * Each timeseries row becomes a synthetic Sum metric data point where:
 * - Attributes = the row's `groups` (drives series-key derivation in buildMetrics)
 * - TimeUnix = the bucket start (drives the X axis)
 * - Value = the aggregated value
 */
function synthesiseRows(rows: TimeseriesMetricRow[]): OtelMetricsRow[] {
  return rows.map(
    (row) =>
      ({
        MetricType: "Sum",
        TimeUnix: row.timeBucketNs,
        StartTimeUnix: row.timeBucketNs,
        Attributes: row.groups,
        Value: row.value,
      }) satisfies OtelMetricsRow
  );
}

export function OtelMetricTimeSeries(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  const rows: OtelMetricsRow[] = isTimeseriesRequest(props)
    ? synthesiseRows(props.response?.data ?? [])
    : (props.response?.data ?? []);

  return (
    <MetricTimeSeries
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      height={props.element.props.height ?? 400}
      showBrush={props.element.props.showBrush ?? true}
      yAxisLabel={props.element.props.yAxisLabel ?? undefined}
      unit={props.element.props.unit ?? undefined}
    />
  );
}
