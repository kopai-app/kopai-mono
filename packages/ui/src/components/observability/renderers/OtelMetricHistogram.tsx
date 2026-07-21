import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricHistogram } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowQueryRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricHistogram
>;

export function OtelMetricHistogram(props: Props) {
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
    <MetricHistogram
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? error}
      height={props.element.props.height ?? 400}
      yAxisLabel={props.element.props.yAxisLabel ?? undefined}
      unit={props.element.props.unit ?? undefined}
    />
  );
}
