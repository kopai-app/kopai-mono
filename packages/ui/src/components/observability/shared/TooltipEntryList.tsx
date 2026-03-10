import type { TooltipPayload } from "recharts";

export function TooltipEntryList({
  payload,
  displayLabelMap,
  formatValue,
}: {
  payload: TooltipPayload;
  displayLabelMap: Map<string, string>;
  formatValue: (v: number) => string;
}) {
  return payload.map((entry, i) => {
    const dataKey = entry.dataKey;
    const value = entry.value;
    if (typeof dataKey !== "string" || typeof value !== "number") return null;
    return (
      <p key={i} className="text-sm" style={{ color: entry.color }}>
        <span className="font-medium">
          {displayLabelMap.get(dataKey) ?? dataKey}:
        </span>{" "}
        {formatValue(value)}
      </p>
    );
  });
}
