import { useMemo, useState } from "react";
import type { ParsedTrace, SpanNode } from "../types.js";
import { formatDuration } from "../utils/time.js";
import { flattenAllSpans } from "../utils/flatten-tree.js";

interface StatisticsViewProps {
  trace: ParsedTrace;
}

interface SpanStats {
  key: string;
  serviceName: string;
  spanName: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  selfTimeTotal: number;
  selfTimeAvg: number;
  selfTimeMin: number;
  selfTimeMax: number;
}

type SortField =
  | "name"
  | "count"
  | "total"
  | "avg"
  | "min"
  | "max"
  | "selfTotal"
  | "selfAvg"
  | "selfMin"
  | "selfMax";

function computeSelfTime(span: SpanNode): number {
  const childrenTotal = span.children.reduce(
    (sum, child) => sum + child.durationMs,
    0
  );
  return Math.max(0, span.durationMs - childrenTotal);
}

function computeStats(trace: ParsedTrace): SpanStats[] {
  const allFlattened = flattenAllSpans(trace.rootSpans);
  const groups = new Map<string, { spans: SpanNode[]; selfTimes: number[] }>();

  for (const { span } of allFlattened) {
    const key = `${span.serviceName}:${span.name}`;
    let group = groups.get(key);
    if (!group) {
      group = { spans: [], selfTimes: [] };
      groups.set(key, group);
    }
    group.spans.push(span);
    group.selfTimes.push(computeSelfTime(span));
  }

  const stats: SpanStats[] = [];
  for (const [key, { spans, selfTimes }] of groups) {
    const durations = spans.map((s) => s.durationMs);
    const count = spans.length;
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const selfTimeTotal = selfTimes.reduce((a, b) => a + b, 0);

    stats.push({
      key,
      serviceName: spans[0]!.serviceName,
      spanName: spans[0]!.name,
      count,
      totalDuration,
      avgDuration: totalDuration / count,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      selfTimeTotal,
      selfTimeAvg: selfTimeTotal / count,
      selfTimeMin: Math.min(...selfTimes),
      selfTimeMax: Math.max(...selfTimes),
    });
  }

  return stats;
}

function getSortValue(stat: SpanStats, field: SortField): number | string {
  switch (field) {
    case "name":
      return stat.key.toLowerCase();
    case "count":
      return stat.count;
    case "total":
      return stat.totalDuration;
    case "avg":
      return stat.avgDuration;
    case "min":
      return stat.minDuration;
    case "max":
      return stat.maxDuration;
    case "selfTotal":
      return stat.selfTimeTotal;
    case "selfAvg":
      return stat.selfTimeAvg;
    case "selfMin":
      return stat.selfTimeMin;
    case "selfMax":
      return stat.selfTimeMax;
  }
}

const COLUMNS: { label: string; field: SortField }[] = [
  { label: "Name", field: "name" },
  { label: "Count", field: "count" },
  { label: "Total", field: "total" },
  { label: "Avg", field: "avg" },
  { label: "Min", field: "min" },
  { label: "Max", field: "max" },
  { label: "ST Total", field: "selfTotal" },
  { label: "ST Avg", field: "selfAvg" },
  { label: "ST Min", field: "selfMin" },
  { label: "ST Max", field: "selfMax" },
];

export function StatisticsView({ trace }: StatisticsViewProps) {
  const [sortField, setSortField] = useState<SortField>("total");
  const [sortAsc, setSortAsc] = useState(false);

  const stats = useMemo(() => computeStats(trace), [trace]);

  const sorted = useMemo(() => {
    const copy = [...stats];
    copy.sort((a, b) => {
      const aVal = getSortValue(a, sortField);
      const bVal = getSortValue(b, sortField);
      let cmp: number;
      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = 0;
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [stats, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((p) => !p);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto p-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((col) => (
              <th
                key={col.field}
                className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                onClick={() => handleSort(col.field)}
              >
                {col.label}{" "}
                {sortField === col.field ? (sortAsc ? "▲" : "▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((stat, i) => (
            <tr
              key={stat.key}
              className={`border-b border-border/50 ${i % 2 === 0 ? "bg-background" : "bg-muted/30"}`}
            >
              <td className="px-3 py-1.5 text-foreground font-mono text-xs whitespace-nowrap">
                <span className="text-muted-foreground">
                  {stat.serviceName}
                </span>
                <span className="text-muted-foreground/50">:</span>{" "}
                {stat.spanName}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {stat.count}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.totalDuration)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.avgDuration)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.minDuration)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.maxDuration)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.selfTimeTotal)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.selfTimeAvg)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.selfTimeMin)}
              </td>
              <td className="px-3 py-1.5 text-foreground tabular-nums">
                {formatDuration(stat.selfTimeMax)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
