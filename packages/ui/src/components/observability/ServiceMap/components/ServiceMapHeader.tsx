/**
 * Service Map header (R2-1, R2-4, Q11, Q16, PR §5.4): what the map is built
 * from, how much of the 60-minute window it covers, the scan state, the live
 * delay, the diagnostics counters, the incomplete warning, and the last error
 * with a Retry button. The graph below is always kept.
 */
import { DELAY_MS, EDGE_CAP, NODE_CAP } from "../engine/config.js";
import { formatCoverage } from "../engine/engine.js";
import type { ServiceMapSnapshot, StopReason } from "../engine/types.js";

const n = (v: number) => v.toLocaleString("en-US");

const STOP_TEXT: Record<StopReason, string | null> = {
  coverage: null,
  budget: "stopped: request budget reached",
  "no-more-data": "stopped: no older spans",
  error: "stopped: error",
};

/**
 * The scan-state part of the summary line in two pieces: why the scan
 * stopped (if it did and the run is past the scan) and what it does now.
 */
export function scanStatusParts(s: ServiceMapSnapshot): {
  stop: string | null;
  now: string | null;
} {
  const { state, stopReason, behindMs } = s.scan;
  const stop = stopReason ? STOP_TEXT[stopReason] : null;
  switch (state) {
    case "idle":
    case "seeding":
      return { stop: null, now: "Looking for spans…" };
    case "scanning":
      return { stop: null, now: "scanning older…" };
    case "probing":
      return { stop, now: "checking unconnected services…" };
    case "live": {
      const live =
        behindMs > 0
          ? `Live · behind by ${n(Math.max(1, Math.round(behindMs / 1000)))} s`
          : `Live · ${Math.round(DELAY_MS / 1000)} s delay`;
      return { stop, now: live };
    }
    case "paused":
      return { stop: null, now: "paused while the tab is hidden" };
    case "error":
      return { stop: null, now: null };
  }
}

/** The scan-state part of the summary line, or null when there is none. */
export function scanStatusText(s: ServiceMapSnapshot): string | null {
  const { stop, now } = scanStatusParts(s);
  return joinParts([stop, now]) || null;
}

/** "312 calls could not be attributed · 18 duplicate spans skipped · …" */
export function diagnosticsText(s: ServiceMapSnapshot): string {
  const d = s.diagnostics;
  return [
    `${n(d.lateUnpaired + d.clientNoPeer)} calls could not be attributed`,
    `${n(d.dupes)} duplicate spans skipped`,
    `${n(d.dropped)} dropped (cap)`,
    `${n(d.badTimestamp)} bad timestamps`,
  ].join(" · ");
}

/** Q16 / PD-5 / seed truncation: why the map may be missing parts. */
export function incompleteText(s: ServiceMapSnapshot): string[] {
  const d = s.diagnostics;
  const out: string[] = [];
  if (d.nodeCapHit)
    out.push(`Map incomplete: more than ${n(NODE_CAP)} services`);
  if (d.edgesDropped > 0)
    out.push(`Map incomplete: more than ${n(EDGE_CAP)} connections`);
  if (d.seedTruncated)
    out.push(
      "Map incomplete: the overview query hit its row limit, some databases and APIs may be missing"
    );
  return out;
}

/** "past 60 min · built from 42,180 spans · covers 6 of 60 min" */
function detailsText(s: ServiceMapSnapshot): string {
  const minutes = Math.round(s.coverage.windowMs / 60_000);
  return joinParts([
    `past ${minutes} min`,
    `built from ${n(s.spansInWindow)} spans`,
    formatCoverage(s),
  ]);
}

/** "Service map · past 60 min · built from 42,180 spans · covers 6 of 60 min · scanning older…" */
export function summaryText(s: ServiceMapSnapshot): string {
  return joinParts(["Service map", detailsText(s), scanStatusText(s)]);
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter((p): p is string => !!p).join(" · ");
}

export interface ServiceMapHeaderProps {
  snapshot: ServiceMapSnapshot | null;
  onRetry?: () => void;
  /** A one-line hint (e.g. no calls between services yet). */
  hint?: string | null;
}

/**
 * Fixed height, two single-line rows: text that grows truncates with "…"
 * instead of wrapping, so the canvas below never moves. The second row shows
 * the most important of: error, incomplete warning, hint, diagnostics.
 */
const HEADER =
  "sm-header flex h-11 shrink-0 flex-col justify-center gap-1 text-sm";
const ROW =
  "flex h-5 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap";
const CLIP = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
/** A summary piece that starts with " · ": `pre` keeps that leading space. */
const PIECE = "min-w-0 overflow-hidden text-ellipsis whitespace-pre";

function LiveDot({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${live ? "bg-emerald-500" : "bg-transparent"}`}
      aria-hidden="true"
    />
  );
}

export function ServiceMapHeader({
  snapshot,
  onRetry,
  hint,
}: ServiceMapHeaderProps) {
  if (!snapshot) {
    return (
      <header className={HEADER}>
        <p className={`${ROW} text-foreground`}>
          <LiveDot live={false} />
          <span className={CLIP}>
            <span className="font-semibold">Service map</span>
            <span className="text-muted-foreground"> · Looking for spans…</span>
          </span>
        </p>
        <p className={ROW} aria-hidden="true" />
      </header>
    );
  }
  const incomplete = incompleteText(snapshot);
  const showError = snapshot.scan.state === "error" || snapshot.error !== null;
  const live = snapshot.scan.state === "live";
  const summary = summaryText(snapshot);
  const status = scanStatusParts(snapshot);

  let second;
  if (showError) {
    second = (
      <div
        role="alert"
        className={`${ROW} text-xs text-red-300`}
        title={snapshot.error ?? undefined}
      >
        <span className="shrink-0">Couldn't load more spans</span>
        {snapshot.error && (
          <span className={`${CLIP} text-red-300/70`}>({snapshot.error})</span>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded border border-red-400/50 px-2 leading-4 font-medium text-red-200 hover:bg-red-500/20"
        >
          Retry
        </button>
      </div>
    );
  } else if (incomplete.length > 0) {
    second = (
      <p
        role="status"
        className={`${ROW} text-xs font-medium text-amber-400`}
        title={incomplete.join("\n")}
      >
        {incomplete.map((t, i) => (
          <span
            key={t}
            className={i === incomplete.length - 1 ? CLIP : "shrink-0"}
            data-testid="sm-incomplete"
          >
            {t}
          </span>
        ))}
      </p>
    );
  } else if (hint) {
    second = (
      <p
        role="note"
        className={`${ROW} sm-hint text-xs text-muted-foreground`}
        title={hint}
      >
        <span className={CLIP}>{hint}</span>
      </p>
    );
  } else {
    second = (
      <p
        className={`${ROW} text-xs text-muted-foreground tabular-nums`}
        title="Calls whose parent span never arrived or that name no peer; adjacent duplicate rows; join-buffer evictions; spans with an impossible timestamp"
      >
        <span className={CLIP} data-testid="sm-diagnostics">
          {diagnosticsText(snapshot)}
        </span>
      </p>
    );
  }

  return (
    <header className={HEADER}>
      <p
        className={`${ROW} text-muted-foreground tabular-nums`}
        title={summary}
      >
        <LiveDot live={live} />
        {/* On a narrow window the details (then the stop reason) truncate
            first: what the scan does now ("Live · 30 s delay") stays. */}
        <span data-testid="sm-summary" className="flex min-w-0">
          <span className="shrink-0 font-semibold text-foreground">
            Service map
          </span>
          <span className={PIECE}>
            {` · ${joinParts([detailsText(snapshot), status.stop])}`}
          </span>
          {status.now && (
            <span data-testid="sm-scan-state" className={`${PIECE} shrink-0`}>
              {` · ${status.now}`}
            </span>
          )}
        </span>
        {/* Only the scan state and stop reason are announced: the visible row
            also holds span counts and coverage, which change on every
            snapshot. */}
        <span
          className="sr-only"
          aria-live="polite"
          data-testid="sm-live-status"
        >
          {joinParts([status.now, status.stop])}
        </span>
      </p>
      {second}
    </header>
  );
}
