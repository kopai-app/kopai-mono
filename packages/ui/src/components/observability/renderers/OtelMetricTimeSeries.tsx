import {
  observabilityCatalog,
  type RendererComponentProps,
} from "@kopai/ui-core";
import { MetricTimeSeries } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTimeSeries
>;

export function OtelMetricTimeSeries(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — only forward rows that are actually metric rows.
  const rows = narrowRows(props.response, hasMetricRowShape) ?? [];

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
