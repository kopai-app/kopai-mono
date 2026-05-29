import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricTable } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowQueryRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTable
>;

export function OtelMetricTable(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — forward only raw metric rows, and surface an
  // explicit error (rather than an empty table) when the query returned an
  // incompatible shape, e.g. aggregate-mode rows this renderer can't draw.
  const { rows, error } = narrowQueryRows(
    props.response,
    hasMetricRowShape,
    "metric"
  );

  return (
    <MetricTable
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? error}
      maxRows={props.element.props.maxRows ?? 100}
    />
  );
}
