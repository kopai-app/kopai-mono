import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { LogTimeline } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowRows, hasLogRowShape } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.LogTimeline
>;

export function OtelLogTimeline(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  const height = props.element.props.height ?? 600;
  // `query` is polymorphic — only forward rows that are actually log rows.
  const rows = narrowRows(props.response, hasLogRowShape) ?? [];

  return (
    <div style={{ height }} className="flex flex-col min-h-0">
      <LogTimeline
        rows={rows}
        isLoading={props.loading}
        error={props.error ?? undefined}
      />
    </div>
  );
}
