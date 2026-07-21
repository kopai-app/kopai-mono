import {
  observabilityCatalog,
  type RendererComponentProps,
} from "@kopai/ui-core";
import { MetricTimeSeries } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowQueryRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTimeSeries
>;

export function OtelMetricTimeSeries(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — forward only raw metric rows, and surface an
  // explicit error (rather than an empty chart) when the query returned an
  // incompatible shape, e.g. aggregate-mode rows this renderer can't draw.
  const { rows, error } = narrowQueryRows(
    props.response,
    hasMetricRowShape,
    "metric"
  );

  return (
    <MetricTimeSeries
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? error}
      height={props.element.props.height ?? 400}
      showBrush={props.element.props.showBrush ?? true}
      yAxisLabel={props.element.props.yAxisLabel ?? undefined}
      unit={props.element.props.unit ?? undefined}
    />
  );
}
