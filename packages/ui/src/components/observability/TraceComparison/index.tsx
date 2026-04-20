import { useMemo } from "react";
import type { denormalizedSignals } from "@kopai/core";
import type { DataSource } from "@kopai/ui-core";
import { useKopaiData } from "@kopai/ui-core";
import { TraceTimeline } from "../TraceTimeline/index.js";
import { formatDuration } from "../utils/time.js";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

export interface TraceComparisonProps {
  traceIdA: string;
  traceIdB: string;
  onBack: () => void;
}

interface DiffRow {
  serviceName: string;
  spanName: string;
  countA: number;
  countB: number;
  avgDurationA: number;
  avgDurationB: number;
  deltaMs: number;
}

function computeTraceStats(rows: OtelTracesRow[]) {
  if (rows.length === 0) return { durationMs: 0, spanCount: 0 };
  let minTs = Infinity;
  let maxEnd = -Infinity;
  for (const row of rows) {
    const startMs = parseInt(row.Timestamp, 10) / 1e6;
    const durNs = row.Duration ? parseInt(row.Duration, 10) : 0;
    const endMs = startMs + durNs / 1e6;
    minTs = Math.min(minTs, startMs);
    maxEnd = Math.max(maxEnd, endMs);
  }
  return { durationMs: maxEnd - minTs, spanCount: rows.length };
}

function collectSignatures(
  rows: OtelTracesRow[]
): Map<string, { count: number; totalDurationMs: number }> {
  const map = new Map<string, { count: number; totalDurationMs: number }>();
  for (const row of rows) {
    const key = `${row.ServiceName ?? "unknown"}::${row.SpanName ?? ""}`;
    const durNs = row.Duration ? parseInt(row.Duration, 10) : 0;
    const durMs = durNs / 1e6;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.totalDurationMs += durMs;
    } else {
      map.set(key, { count: 1, totalDurationMs: durMs });
    }
  }
  return map;
}

function computeDiff(
  rowsA: OtelTracesRow[],
  rowsB: OtelTracesRow[]
): DiffRow[] {
  const sigA = collectSignatures(rowsA);
  const sigB = collectSignatures(rowsB);
  const allKeys = new Set([...sigA.keys(), ...sigB.keys()]);
  const result: DiffRow[] = [];

  for (const key of allKeys) {
    const [serviceName = "unknown", spanName = ""] = key.split("::");
    const a = sigA.get(key);
    const b = sigB.get(key);
    const countA = a?.count ?? 0;
    const countB = b?.count ?? 0;
    const avgA = a ? a.totalDurationMs / a.count : 0;
    const avgB = b ? b.totalDurationMs / b.count : 0;
    result.push({
      serviceName,
      spanName,
      countA,
      countB,
      avgDurationA: avgA,
      avgDurationB: avgB,
      deltaMs: avgB - avgA,
    });
  }

  // Sort: spans only in A first, then only in B, then shared (by absolute delta desc)
  return result.sort((a, b) => {
    const aShared = a.countA > 0 && a.countB > 0;
    const bShared = b.countA > 0 && b.countB > 0;
    if (aShared !== bShared) return aShared ? 1 : -1;
    return Math.abs(b.deltaMs) - Math.abs(a.deltaMs);
  });
}

function formatDelta(ms: number): string {
  const sign = ms > 0 ? "+" : "";
  return `${sign}${formatDuration(ms)}`;
}

export function TraceComparison({
  traceIdA,
  traceIdB,
  onBack,
}: TraceComparisonProps) {
  const dsA = useMemo<DataSource>(
    () => ({ method: "getTrace", params: { traceId: traceIdA } }),
    [traceIdA]
  );
  const dsB = useMemo<DataSource>(
    () => ({ method: "getTrace", params: { traceId: traceIdB } }),
    [traceIdB]
  );

  const {
    data: rowsA,
    loading: loadingA,
    error: errorA,
  } = useKopaiData<OtelTracesRow[]>(dsA);
  const {
    data: rowsB,
    loading: loadingB,
    error: errorB,
  } = useKopaiData<OtelTracesRow[]>(dsB);

  const statsA = useMemo(() => computeTraceStats(rowsA ?? []), [rowsA]);
  const statsB = useMemo(() => computeTraceStats(rowsB ?? []), [rowsB]);
  const diff = useMemo(
    () => computeDiff(rowsA ?? [], rowsB ?? []),
    [rowsA, rowsB]
  );

  const durationDelta = statsB.durationMs - statsA.durationMs;
  const spanDelta = statsB.spanCount - statsA.spanCount;
  const isLoading = loadingA || loadingB;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between bg-background border border-border rounded-lg p-4">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back
          </button>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground mr-1">A:</span>
              <span className="font-mono text-xs text-foreground">
                {traceIdA.slice(0, 16)}...
              </span>
            </div>
            <div>
              <span className="text-muted-foreground mr-1">B:</span>
              <span className="font-mono text-xs text-foreground">
                {traceIdB.slice(0, 16)}...
              </span>
            </div>
          </div>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground mr-1">
                Duration delta:
              </span>
              <span
                className={
                  durationDelta > 0
                    ? "text-red-400"
                    : durationDelta < 0
                      ? "text-green-400"
                      : "text-foreground"
                }
              >
                {formatDelta(durationDelta)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground mr-1">
                Span count delta:
              </span>
              <span
                className={
                  spanDelta > 0
                    ? "text-red-400"
                    : spanDelta < 0
                      ? "text-green-400"
                      : "text-foreground"
                }
              >
                {spanDelta > 0 ? `+${spanDelta}` : String(spanDelta)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Side-by-side timelines */}
      <div className="grid grid-cols-2 gap-4" style={{ height: "50vh" }}>
        <div className="border border-border rounded-lg overflow-hidden">
          <TraceTimeline
            rows={rowsA ?? []}
            isLoading={loadingA}
            error={errorA ?? undefined}
          />
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          <TraceTimeline
            rows={rowsB ?? []}
            isLoading={loadingB}
            error={errorB ?? undefined}
          />
        </div>
      </div>

      {/* Structural Diff Table */}
      {!isLoading && diff.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-background">
            <h3 className="text-sm font-medium text-foreground">
              Structural Diff
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">
                    Service
                  </th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">
                    Span
                  </th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">
                    Count A
                  </th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">
                    Count B
                  </th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">
                    Avg Dur A
                  </th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">
                    Avg Dur B
                  </th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">
                    Delta
                  </th>
                </tr>
              </thead>
              <tbody>
                {diff.map((row) => {
                  const onlyA = row.countA > 0 && row.countB === 0;
                  const onlyB = row.countA === 0 && row.countB > 0;
                  const rowBg = onlyA
                    ? "bg-red-500/5"
                    : onlyB
                      ? "bg-green-500/5"
                      : "";

                  return (
                    <tr
                      key={`${row.serviceName}::${row.spanName}`}
                      className={`border-b border-border/50 ${rowBg}`}
                    >
                      <td className="px-4 py-1.5 text-foreground">
                        {row.serviceName}
                      </td>
                      <td className="px-4 py-1.5 font-mono text-xs text-foreground">
                        {row.spanName}
                      </td>
                      <td className="px-4 py-1.5 text-right text-foreground">
                        {row.countA || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-foreground">
                        {row.countB || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-foreground">
                        {row.countA > 0 ? (
                          formatDuration(row.avgDurationA)
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-foreground">
                        {row.countB > 0 ? (
                          formatDuration(row.avgDurationB)
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        {row.countA > 0 && row.countB > 0 ? (
                          <span
                            className={
                              row.deltaMs > 0
                                ? "text-red-400"
                                : row.deltaMs < 0
                                  ? "text-green-400"
                                  : "text-foreground"
                            }
                          >
                            {formatDelta(row.deltaMs)}
                          </span>
                        ) : (
                          <span
                            className={
                              onlyA ? "text-red-400" : "text-green-400"
                            }
                          >
                            {onlyA ? "removed" : "added"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
