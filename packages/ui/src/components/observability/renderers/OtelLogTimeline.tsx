import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { LogTimeline } from "../index.js";
import { NoDataSource } from "./NoDataSource.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.LogTimeline
>;

export function OtelLogTimeline(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  const height = props.element.props.height ?? 600;

  return (
    <div style={{ height }} className="flex flex-col min-h-0">
      <LogTimeline
        rows={props.response?.data ?? []}
        isLoading={props.loading}
        error={props.error ?? undefined}
      />
    </div>
  );
}
