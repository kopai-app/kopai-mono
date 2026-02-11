/**
 * LogFilter – collapsible filter panel for LogsDataFilter params.
 * Follows the same visual pattern as TraceSearch filters.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { dataFilterSchemas, denormalizedSignals } from "@kopai/core";

type LogsDataFilter = dataFilterSchemas.LogsDataFilter;
type OtelLogsRow = denormalizedSignals.OtelLogsRow;
type FilterValue = Partial<LogsDataFilter>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOOKBACK_OPTIONS = [
  { label: "Last 5 Minutes", ms: 5 * 60_000 },
  { label: "Last 15 Minutes", ms: 15 * 60_000 },
  { label: "Last 30 Minutes", ms: 30 * 60_000 },
  { label: "Last 1 Hour", ms: 60 * 60_000 },
  { label: "Last 2 Hours", ms: 2 * 60 * 60_000 },
  { label: "Last 6 Hours", ms: 6 * 60 * 60_000 },
  { label: "Last 12 Hours", ms: 12 * 60 * 60_000 },
  { label: "Last 24 Hours", ms: 24 * 60 * 60_000 },
] as const;

const DEBOUNCE_MS = 500;

type TimeMode = "lookback" | "absolute";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ms epoch to nanosecond string */
function msToNs(ms: number): string {
  return String(BigInt(Math.floor(ms)) * 1_000_000n);
}

/** Parse comma-separated "key=value" pairs into a record, or undefined if all invalid */
function parseKeyValues(input: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let hasAny = false;
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!key) continue;
    result[key] = val;
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

/** Format a datetime-local string from a nanosecond timestamp */
function nsToDatetimeLocal(ns: string | undefined): string {
  if (!ns) return "";
  const ms = Number(BigInt(ns) / 1_000_000n);
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Build compact summary of active filters */
function buildFilterSummary(
  value: FilterValue,
  selectedServices: string[]
): string {
  const parts: string[] = [];
  if (selectedServices.length === 1) {
    parts.push(`service:${selectedServices[0]}`);
  } else if (selectedServices.length > 1) {
    parts.push(`services:${selectedServices.length}`);
  }
  if (value.severityText) parts.push(`severity:${value.severityText}`);
  if (value.scopeName) parts.push(`scope:${value.scopeName}`);
  if (value.bodyContains) parts.push(`body:"${value.bodyContains}"`);
  if (value.traceId) parts.push(`trace:${value.traceId.slice(0, 8)}…`);
  if (value.spanId) parts.push(`span:${value.spanId.slice(0, 8)}…`);
  if (value.limit != null) parts.push(`limit:${value.limit}`);
  if (value.sortOrder === "ASC") parts.push("sort:oldest");
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Shared input classes
// ---------------------------------------------------------------------------

const INPUT_CLS =
  "w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50";

const LABEL_CLS = "text-xs text-muted-foreground";

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// MultiSelect dropdown
// ---------------------------------------------------------------------------

function MultiSelect({
  options,
  selected,
  onChange,
  testId,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  testId?: string;
}) {
  const [dropOpen, setDropOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((s) => s !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  const label =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setDropOpen((v) => !v)}
        className={`${INPUT_CLS} text-left flex items-center justify-between`}
        data-testid={testId ? `${testId}-trigger` : undefined}
      >
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground text-xs ml-1">
          {dropOpen ? "▲" : "▼"}
        </span>
      </button>
      {dropOpen && (
        <div
          className="absolute z-10 mt-1 w-full bg-background border border-border rounded shadow-lg max-h-48 overflow-y-auto"
          data-testid={testId ? `${testId}-dropdown` : undefined}
        >
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No options
            </div>
          )}
          {options.map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/30 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                className="accent-foreground"
                data-testid={testId ? `${testId}-option-${opt}` : undefined}
              />
              <span className="truncate">{opt}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 border-t border-border"
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LogFilterProps {
  value: FilterValue;
  onChange: (filters: FilterValue) => void;
  rows?: OtelLogsRow[];
  /** Controlled multi-select for services (empty = all). */
  selectedServices?: string[];
  onSelectedServicesChange?: (services: string[]) => void;
}

export function LogFilter({
  value,
  onChange,
  rows = [],
  selectedServices = [],
  onSelectedServicesChange,
}: LogFilterProps) {
  const [open, setOpen] = useState(false);
  const [timeMode, setTimeMode] = useState<TimeMode>("lookback");
  const [lookbackIdx, setLookbackIdx] = useState(-1);

  // -- Derive filterable options from rows (sticky — accumulates over time) --
  const svcRef = useRef(new Set<string>());
  const sevRef = useRef(new Set<string>());
  const scopeRef = useRef(new Set<string>());

  const serviceNames = useMemo(() => {
    for (const r of rows) if (r.ServiceName) svcRef.current.add(r.ServiceName);
    return Array.from(svcRef.current).sort();
  }, [rows]);

  const severityTexts = useMemo(() => {
    for (const r of rows)
      if (r.SeverityText) sevRef.current.add(r.SeverityText);
    return Array.from(sevRef.current).sort();
  }, [rows]);

  const scopeNames = useMemo(() => {
    for (const r of rows) if (r.ScopeName) scopeRef.current.add(r.ScopeName);
    return Array.from(scopeRef.current).sort();
  }, [rows]);

  // -- Debounced text fields ------------------------------------------------
  const [bodyContains, setBodyContains] = useState(value.bodyContains ?? "");
  const [traceId, setTraceId] = useState(value.traceId ?? "");
  const [spanId, setSpanId] = useState(value.spanId ?? "");
  const [logAttrsText, setLogAttrsText] = useState("");
  const [resAttrsText, setResAttrsText] = useState("");
  const [scopeAttrsText, setScopeAttrsText] = useState("");

  const dBodyContains = useDebouncedValue(bodyContains, DEBOUNCE_MS);
  const dTraceId = useDebouncedValue(traceId, DEBOUNCE_MS);
  const dSpanId = useDebouncedValue(spanId, DEBOUNCE_MS);
  const dLogAttrs = useDebouncedValue(logAttrsText, DEBOUNCE_MS);
  const dResAttrs = useDebouncedValue(resAttrsText, DEBOUNCE_MS);
  const dScopeAttrs = useDebouncedValue(scopeAttrsText, DEBOUNCE_MS);

  // Prevent calling onChange on first render
  const isFirstRender = useRef(true);

  // -- Sync debounced text values to parent ---------------------------------
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const next: FilterValue = { ...value };

    if (dBodyContains) next.bodyContains = dBodyContains;
    else delete next.bodyContains;

    if (dTraceId) next.traceId = dTraceId;
    else delete next.traceId;

    if (dSpanId) next.spanId = dSpanId;
    else delete next.spanId;

    const la = parseKeyValues(dLogAttrs);
    if (la) next.logAttributes = la;
    else delete next.logAttributes;

    const ra = parseKeyValues(dResAttrs);
    if (ra) next.resourceAttributes = ra;
    else delete next.resourceAttributes;

    const sa = parseKeyValues(dScopeAttrs);
    if (sa) next.scopeAttributes = sa;
    else delete next.scopeAttributes;

    onChange(next);
  }, [dBodyContains, dTraceId, dSpanId, dLogAttrs, dResAttrs, dScopeAttrs]);

  // -- Immediate change helper (selects / numbers) --------------------------
  const emitImmediate = useCallback(
    (patch: Partial<FilterValue>) => {
      const next: FilterValue = { ...value };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") {
          delete (next as Record<string, unknown>)[k];
        } else {
          (next as Record<string, unknown>)[k] = v;
        }
      }
      // Re-apply current debounced text fields so they don't get lost
      if (dBodyContains) next.bodyContains = dBodyContains;
      if (dTraceId) next.traceId = dTraceId;
      if (dSpanId) next.spanId = dSpanId;
      const la = parseKeyValues(dLogAttrs);
      if (la) next.logAttributes = la;
      const ra = parseKeyValues(dResAttrs);
      if (ra) next.resourceAttributes = ra;
      const sa = parseKeyValues(dScopeAttrs);
      if (sa) next.scopeAttributes = sa;
      onChange(next);
    },
    [
      value,
      onChange,
      dBodyContains,
      dTraceId,
      dSpanId,
      dLogAttrs,
      dResAttrs,
      dScopeAttrs,
    ]
  );

  // Wire up the service handler to use emitImmediate via ref
  const emitRef = useRef(emitImmediate);
  emitRef.current = emitImmediate;
  const handleServicesChangeSynced = useCallback(
    (next: string[]) => {
      onSelectedServicesChange?.(next);
      if (next.length === 1) {
        emitRef.current({ serviceName: next[0] });
      } else {
        emitRef.current({ serviceName: undefined });
      }
    },
    [onSelectedServicesChange]
  );

  // -- Lookback handler -----------------------------------------------------
  const handleLookback = useCallback(
    (idx: number) => {
      setLookbackIdx(idx);
      if (idx < 0) {
        emitImmediate({ timestampMin: undefined, timestampMax: undefined });
      } else {
        const opt = LOOKBACK_OPTIONS[idx];
        if (opt) {
          const tsMin = msToNs(Date.now() - opt.ms);
          emitImmediate({ timestampMin: tsMin, timestampMax: undefined });
        }
      }
    },
    [emitImmediate]
  );

  // -- Absolute time handlers -----------------------------------------------
  const handleAbsoluteMin = useCallback(
    (dtStr: string) => {
      if (!dtStr) {
        emitImmediate({ timestampMin: undefined });
        return;
      }
      const ms = new Date(dtStr).getTime();
      emitImmediate({ timestampMin: msToNs(ms) });
    },
    [emitImmediate]
  );

  const handleAbsoluteMax = useCallback(
    (dtStr: string) => {
      if (!dtStr) {
        emitImmediate({ timestampMax: undefined });
        return;
      }
      const ms = new Date(dtStr).getTime();
      emitImmediate({ timestampMax: msToNs(ms) });
    },
    [emitImmediate]
  );

  // -- Time mode switch -----------------------------------------------------
  const switchTimeMode = useCallback(
    (mode: TimeMode) => {
      setTimeMode(mode);
      setLookbackIdx(-1);
      emitImmediate({ timestampMin: undefined, timestampMax: undefined });
    },
    [emitImmediate]
  );

  // -- Filter summary for collapsed state -----------------------------------
  const summary = buildFilterSummary(value, selectedServices);

  return (
    <div className="border border-border rounded-lg" data-testid="log-filter">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
        data-testid="log-filter-toggle"
      >
        <span className="flex items-center gap-2">
          <span>
            <span className="underline underline-offset-4">F</span>ilters
          </span>
          {!open && summary && (
            <span
              className="text-xs text-muted-foreground truncate max-w-md"
              data-testid="filter-summary"
            >
              {summary}
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Service Name — multi-select */}
            <div className="space-y-1">
              <span className={LABEL_CLS}>Service</span>
              <MultiSelect
                options={serviceNames}
                selected={selectedServices}
                onChange={handleServicesChangeSynced}
                testId="filter-serviceName"
              />
            </div>

            {/* Severity */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Severity</span>
              <select
                value={value.severityText ?? ""}
                onChange={(e) =>
                  emitImmediate({
                    severityText: e.target.value || undefined,
                  })
                }
                className={INPUT_CLS}
                data-testid="filter-severityText"
              >
                <option value="">All</option>
                {severityTexts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            {/* Body Contains */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Body contains</span>
              <input
                type="text"
                placeholder="Search log body... (/)"
                value={bodyContains}
                onChange={(e) => setBodyContains(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-bodyContains"
              />
            </label>

            {/* Sort Order */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Sort</span>
              <select
                value={value.sortOrder ?? "DESC"}
                onChange={(e) =>
                  emitImmediate({
                    sortOrder: e.target.value as "ASC" | "DESC",
                  })
                }
                className={INPUT_CLS}
                data-testid="filter-sortOrder"
              >
                <option value="DESC">Newest first</option>
                <option value="ASC">Oldest first</option>
              </select>
            </label>

            {/* Limit */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Limit</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={value.limit ?? ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  emitImmediate({
                    limit: n >= 1 && n <= 1000 ? n : undefined,
                  });
                }}
                className={INPUT_CLS}
                data-testid="filter-limit"
              />
            </label>

            {/* Trace ID */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Trace ID</span>
              <input
                type="text"
                placeholder="Trace ID"
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-traceId"
              />
            </label>

            {/* Span ID */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Span ID</span>
              <input
                type="text"
                placeholder="Span ID"
                value={spanId}
                onChange={(e) => setSpanId(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-spanId"
              />
            </label>

            {/* Scope Name */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Scope</span>
              <select
                value={value.scopeName ?? ""}
                onChange={(e) =>
                  emitImmediate({
                    scopeName: e.target.value || undefined,
                  })
                }
                className={INPUT_CLS}
                data-testid="filter-scopeName"
              >
                <option value="">All</option>
                {scopeNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            {/* Log Attributes */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Log attributes</span>
              <input
                type="text"
                placeholder="key1=val1, key2=val2"
                value={logAttrsText}
                onChange={(e) => setLogAttrsText(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-logAttributes"
              />
            </label>

            {/* Resource Attributes */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Resource attributes</span>
              <input
                type="text"
                placeholder="key1=val1, key2=val2"
                value={resAttrsText}
                onChange={(e) => setResAttrsText(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-resourceAttributes"
              />
            </label>

            {/* Scope Attributes */}
            <label className="space-y-1">
              <span className={LABEL_CLS}>Scope attributes</span>
              <input
                type="text"
                placeholder="key1=val1, key2=val2"
                value={scopeAttrsText}
                onChange={(e) => setScopeAttrsText(e.target.value)}
                className={INPUT_CLS}
                data-testid="filter-scopeAttributes"
              />
            </label>
          </div>

          {/* Time range */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={LABEL_CLS}>Time range</span>
              <div className="flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  className={`px-2 py-1 ${timeMode === "lookback" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/30"}`}
                  onClick={() => switchTimeMode("lookback")}
                  data-testid="time-mode-lookback"
                >
                  Lookback
                </button>
                <button
                  className={`px-2 py-1 ${timeMode === "absolute" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/30"}`}
                  onClick={() => switchTimeMode("absolute")}
                  data-testid="time-mode-absolute"
                >
                  Absolute
                </button>
              </div>
            </div>

            {timeMode === "lookback" ? (
              <select
                value={lookbackIdx}
                onChange={(e) => handleLookback(Number(e.target.value))}
                className={`${INPUT_CLS} max-w-xs`}
                data-testid="filter-lookback"
              >
                <option value={-1}>All time</option>
                {LOOKBACK_OPTIONS.map((opt, i) => (
                  <option key={i} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <label className="space-y-1 flex-1">
                  <span className={LABEL_CLS}>From</span>
                  <input
                    type="datetime-local"
                    value={nsToDatetimeLocal(value.timestampMin)}
                    onChange={(e) => handleAbsoluteMin(e.target.value)}
                    className={INPUT_CLS}
                    data-testid="filter-timestampMin"
                  />
                </label>
                <label className="space-y-1 flex-1">
                  <span className={LABEL_CLS}>To</span>
                  <input
                    type="datetime-local"
                    value={nsToDatetimeLocal(value.timestampMax)}
                    onChange={(e) => handleAbsoluteMax(e.target.value)}
                    className={INPUT_CLS}
                    data-testid="filter-timestampMax"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
