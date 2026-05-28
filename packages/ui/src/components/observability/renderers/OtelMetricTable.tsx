import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { MetricTable } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowRows, hasMetricRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricTable
>;

export function OtelMetricTable(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — only forward rows that are actually metric rows.
  const rows = narrowRows(props.response, hasMetricRowShape) ?? [];

  return (
    <MetricTable
      rows={rows}
      isLoading={props.loading}
      error={props.error ?? undefined}
      maxRows={props.element.props.maxRows ?? 100}
    />
  );
}
