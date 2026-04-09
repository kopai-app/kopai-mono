import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import { LogTimeline } from "../index.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.LogTimeline
>;

export function OtelLogTimeline(props: Props) {
  if (!props.hasData) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>No data source</div>
    );
  }

  const height = props.element.props.height ?? 600;

  return (
    <div style={{ height }} className="flex flex-col min-h-0">
      <LogTimeline
        rows={props.data?.data ?? []}
        isLoading={props.loading}
        error={props.error ?? undefined}
      />
    </div>
  );
}
