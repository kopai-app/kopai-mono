import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricHistogram } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricHistogram
>;

export function OtelMetricHistogram(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — only forward rows that are actually metric rows.
  const rows = narrowRows(props.response, hasMetricRowShape) ?? [];

  return (
    <MetricHistogram
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      height={props.element.props.height ?? 400}
      yAxisLabel={props.element.props.yAxisLabel ?? undefined}
      unit={props.element.props.unit ?? undefined}
    />
  );
}
