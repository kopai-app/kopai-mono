import { useMemo } from "react";
import { observabilityCatalog } from "../../../lib/observability-catalog.js";
import type { RendererComponentProps } from "../../../lib/renderer.js";
import type { MetricsDiscoveryResult } from "@kopai/sdk";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.MetricDiscovery
>;

const TYPE_ORDER: Record<string, number> = {
  Gauge: 0,
  Sum: 1,
  Histogram: 2,
  ExponentialHistogram: 3,
  Summary: 4,
};

export function OtelMetricDiscovery(props: Props) {
  const data = props.hasData
    ? (props.data as MetricsDiscoveryResult | null)
    : null;
  const loading = props.hasData ? props.loading : false;
  const error = props.hasData ? props.error : null;

  const sorted = useMemo(() => {
    if (!data?.metrics) return [];
    return [...data.metrics].sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
    );
  }, [data]);

  if (loading && !sorted.length) {
    return <p className="text-muted-foreground py-4">Loading metrics…</p>;
  }
  if (error) {
    return <p className="text-red-400 py-4">Error: {error.message}</p>;
  }
  if (!sorted.length) {
    return <p className="text-muted-foreground py-4">No metrics discovered.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left text-foreground border-collapse">
        <thead className="text-xs uppercase text-muted-foreground border-b border-border">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr
              key={`${m.name}-${m.type}`}
              className="border-b border-border/50 hover:bg-muted/40"
            >
              <td className="px-3 py-2 font-mono whitespace-nowrap">
                {m.name}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{m.type}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {m.unit || "–"}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {m.description || "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
