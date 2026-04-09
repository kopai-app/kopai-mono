import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useSyncExternalStore,
  useRef,
} from "react";
import { KopaiSDKProvider, useKopaiSDK } from "../providers/kopai-provider.js";
import { useQuery } from "@tanstack/react-query";
import { KopaiClient } from "@kopai/sdk";
import { useKopaiData } from "../hooks/use-kopai-data.js";
import { useLiveLogs } from "../hooks/use-live-logs.js";
import type { denormalizedSignals, dataFilterSchemas } from "@kopai/core";
import type { DataSource } from "../lib/component-catalog.js";
import { observabilityCatalog } from "../lib/observability-catalog.js";
// Observability components
import {
  LogTimeline,
  LogFilter,
  TabBar,
  TraceSearch,
  TraceDetail,
  TraceComparison,
  KeyboardShortcutsProvider,
  useRegisterShortcuts,
  DynamicDashboard,
} from "../components/observability/index.js";
import type { UITree } from "../components/observability/DynamicDashboard/index.js";
import type {
  TraceSummary,
  TraceSearchFilters,
} from "../components/observability/index.js";

import { SERVICES_SHORTCUTS } from "../components/observability/ServiceList/shortcuts.js";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type Tab = "logs" | "services" | "metrics";

const TABS: { key: Tab; label: string; shortcutKey: string }[] = [
  { key: "services", label: "Traces", shortcutKey: "T" },
  { key: "logs", label: "Logs", shortcutKey: "L" },
  { key: "metrics", label: "Metrics", shortcutKey: "M" },
];

// ---------------------------------------------------------------------------
// URL state helpers
// ---------------------------------------------------------------------------

interface URLState {
  tab: Tab;
  // Services tab search params
  service: string | null;
  operation: string | null;
  tags: string | null;
  lookback: string | null;
  tsMin: string | null;
  tsMax: string | null;
  minDuration: string | null;
  maxDuration: string | null;
  limit: number | null;
  sort: string | null;
  // Trace detail
  trace: string | null;
  span: string | null;
  view: string | null;
  uiFind: string | null;
  // Comparison
  compare: string | null;
  // Minimap (phase 8)
  viewStart: string | null;
  viewEnd: string | null;
  // Existing
  dashboardId: string | null;
}

function readURLState(): URLState {
  const params = new URLSearchParams(window.location.search);
  const service = params.get("service");
  const trace = params.get("trace");
  const span = params.get("span");
  const dashboardId = params.get("dashboardId");
  const rawTab = params.get("tab");
  const tab = service
    ? "services"
    : rawTab === "logs" || rawTab === "metrics"
      ? rawTab
      : "services";
  const rawLimit = params.get("limit");
  const limit = rawLimit ? parseInt(rawLimit, 10) : null;
  return {
    tab,
    service,
    operation: params.get("operation"),
    tags: params.get("tags"),
    lookback: params.get("lookback"),
    tsMin: params.get("tsMin"),
    tsMax: params.get("tsMax"),
    minDuration: params.get("minDuration"),
    maxDuration: params.get("maxDuration"),
    limit: limit !== null && !isNaN(limit) ? limit : null,
    sort: params.get("sort"),
    trace,
    span,
    view: params.get("view"),
    uiFind: params.get("uiFind"),
    compare: params.get("compare"),
    viewStart: params.get("viewStart"),
    viewEnd: params.get("viewEnd"),
    dashboardId,
  };
}

function pushURLState(
  state: {
    tab: Tab;
    service?: string | null;
    operation?: string | null;
    tags?: string | null;
    lookback?: string | null;
    tsMin?: string | null;
    tsMax?: string | null;
    minDuration?: string | null;
    maxDuration?: string | null;
    limit?: number | null;
    sort?: string | null;
    trace?: string | null;
    span?: string | null;
    view?: string | null;
    uiFind?: string | null;
    compare?: string | null;
    viewStart?: string | null;
    viewEnd?: string | null;
    dashboardId?: string | null;
  },
  { replace = false }: { replace?: boolean } = {}
) {
  const params = new URLSearchParams();
  if (state.tab !== "services") params.set("tab", state.tab);

  if (state.tab === "services") {
    if (state.service) params.set("service", state.service);
    if (state.operation) params.set("operation", state.operation);
    if (state.tags) params.set("tags", state.tags);
    if (state.lookback) params.set("lookback", state.lookback);
    if (state.tsMin) params.set("tsMin", state.tsMin);
    if (state.tsMax) params.set("tsMax", state.tsMax);
    if (state.minDuration) params.set("minDuration", state.minDuration);
    if (state.maxDuration) params.set("maxDuration", state.maxDuration);
    if (state.limit != null && state.limit !== 20)
      params.set("limit", String(state.limit));
    if (state.sort) params.set("sort", state.sort);
    if (state.trace) params.set("trace", state.trace);
    if (state.span) params.set("span", state.span);
    if (state.view) params.set("view", state.view);
    if (state.uiFind) params.set("uiFind", state.uiFind);
    if (state.compare) params.set("compare", state.compare);
    if (state.viewStart) params.set("viewStart", state.viewStart);
    if (state.viewEnd) params.set("viewEnd", state.viewEnd);
  }

  // Preserve dashboardId from current URL if not explicitly provided
  const dashboardId =
    state.dashboardId !== undefined
      ? state.dashboardId
      : new URLSearchParams(window.location.search).get("dashboardId");
  if (dashboardId) params.set("dashboardId", dashboardId);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  if (replace) {
    history.replaceState(null, "", url);
  } else {
    history.pushState(null, "", url);
  }
  dispatchEvent(new PopStateEvent("popstate"));
}

function subscribeURL(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

let _cachedSearch = "";
let _cachedState: URLState = {
  tab: "services",
  service: null,
  operation: null,
  tags: null,
  lookback: null,
  tsMin: null,
  tsMax: null,
  minDuration: null,
  maxDuration: null,
  limit: null,
  sort: null,
  trace: null,
  span: null,
  view: null,
  uiFind: null,
  compare: null,
  viewStart: null,
  viewEnd: null,
  dashboardId: null,
};

function getURLSnapshot(): URLState {
  const search = window.location.search;
  if (search !== _cachedSearch) {
    _cachedSearch = search;
    _cachedState = readURLState();
  }
  return _cachedState;
}

function useURLState(): URLState {
  return useSyncExternalStore(subscribeURL, getURLSnapshot);
}

// ---------------------------------------------------------------------------
// Log filter URL helpers
// ---------------------------------------------------------------------------

function parseKeyValuesFromURL(
  raw: string
): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  let hasAny = false;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    result[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    hasAny = true;
  }
  return hasAny ? result : undefined;
}

function serializeKeyValues(rec: Record<string, string> | undefined): string {
  if (!rec) return "";
  return Object.entries(rec)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

interface LogURLState {
  filters: Partial<dataFilterSchemas.LogsDataFilter>;
  selectedServices: string[];
  selectedLogId: string | null;
}

function readLogFilters(): LogURLState {
  const p = new URLSearchParams(window.location.search);
  const filters: Partial<dataFilterSchemas.LogsDataFilter> = {
    limit: 200,
    sortOrder: "DESC",
  };

  const severity = p.get("severity");
  if (severity) filters.severityText = severity;

  const body = p.get("body");
  if (body) filters.bodyContains = body;

  const sort = p.get("sort");
  if (sort === "ASC" || sort === "DESC") filters.sortOrder = sort;

  const limit = p.get("limit");
  if (limit) {
    const n = parseInt(limit, 10);
    if (n >= 1 && n <= 1000) filters.limit = n;
  }

  const traceId = p.get("traceId");
  if (traceId) filters.traceId = traceId;

  const spanId = p.get("spanId");
  if (spanId) filters.spanId = spanId;

  const scope = p.get("scope");
  if (scope) filters.scopeName = scope;

  const tsMin = p.get("tsMin");
  if (tsMin) filters.timestampMin = tsMin;

  const tsMax = p.get("tsMax");
  if (tsMax) filters.timestampMax = tsMax;

  const logAttrs = p.get("logAttrs");
  if (logAttrs) filters.logAttributes = parseKeyValuesFromURL(logAttrs);

  const resAttrs = p.get("resAttrs");
  if (resAttrs) filters.resourceAttributes = parseKeyValuesFromURL(resAttrs);

  const scopeAttrs = p.get("scopeAttrs");
  if (scopeAttrs) filters.scopeAttributes = parseKeyValuesFromURL(scopeAttrs);

  const services = p.get("services");
  const selectedServices = services ? services.split(",").filter(Boolean) : [];

  if (selectedServices.length === 1) filters.serviceName = selectedServices[0];

  const selectedLogId = p.get("log") || null;

  return { filters, selectedServices, selectedLogId };
}

function writeLogFiltersToURL(
  filters: Partial<dataFilterSchemas.LogsDataFilter>,
  selectedServices: string[],
  selectedLogId: string | null
) {
  const p = new URLSearchParams();
  p.set("tab", "logs");

  if (filters.severityText) p.set("severity", filters.severityText);
  if (filters.bodyContains) p.set("body", filters.bodyContains);
  if (selectedServices.length) p.set("services", selectedServices.join(","));
  if (filters.sortOrder && filters.sortOrder !== "DESC")
    p.set("sort", filters.sortOrder);
  if (filters.limit != null && filters.limit !== 200)
    p.set("limit", String(filters.limit));
  if (filters.traceId) p.set("traceId", filters.traceId);
  if (filters.spanId) p.set("spanId", filters.spanId);
  if (filters.scopeName) p.set("scope", filters.scopeName);
  if (filters.timestampMin) p.set("tsMin", filters.timestampMin);
  if (filters.timestampMax) p.set("tsMax", filters.timestampMax);

  const la = serializeKeyValues(filters.logAttributes);
  if (la) p.set("logAttrs", la);
  const ra = serializeKeyValues(filters.resourceAttributes);
  if (ra) p.set("resAttrs", ra);
  const sa = serializeKeyValues(filters.scopeAttributes);
  if (sa) p.set("scopeAttrs", sa);

  if (selectedLogId) p.set("log", selectedLogId);

  const qs = p.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  history.replaceState(null, "", url);
}

// ---------------------------------------------------------------------------
// Duration parser — "100ms" → nanosecond string
// ---------------------------------------------------------------------------

function parseDuration(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(us|ms|s)$/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    us: 1_000,
    ms: 1_000_000,
    s: 1_000_000_000,
  };
  return String(Math.round(value * multipliers[unit]!));
}

// ---------------------------------------------------------------------------
// Logfmt helpers
// ---------------------------------------------------------------------------

function parseLogfmt(str: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([\S]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const key = m[1];
    if (key) result[key] = m[2] ?? m[3] ?? "";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Lookback presets (ms values)
// ---------------------------------------------------------------------------

const LOOKBACK_MS: Record<string, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

// ---------------------------------------------------------------------------
// Logs tab (live-tailing)
// ---------------------------------------------------------------------------

function LogsTab() {
  const [initState] = useState(() => readLogFilters());
  const [filters, setFilters] = useState<
    Partial<dataFilterSchemas.LogsDataFilter>
  >(initState.filters);
  const [selectedServices, setSelectedServices] = useState<string[]>(
    initState.selectedServices
  );
  const [selectedLogId, setSelectedLogId] = useState<string | null>(
    initState.selectedLogId
  );

  // Sync filter state to URL
  useEffect(() => {
    writeLogFiltersToURL(filters, selectedServices, selectedLogId);
  }, [filters, selectedServices, selectedLogId]);

  const { logs, isLive, loading, error, setLive } = useLiveLogs({
    params: filters,
    pollIntervalMs: 3_000,
  });

  // Client-side multi-service filter (API only supports single serviceName)
  const filteredLogs = useMemo(() => {
    if (selectedServices.length <= 1) return logs;
    const set = new Set(selectedServices);
    return logs.filter((r) => set.has(r.ServiceName ?? ""));
  }, [logs, selectedServices]);

  const handleLogClick = useCallback((log: { logId: string }) => {
    setSelectedLogId(log.logId);
  }, []);

  const handleTraceLinkClick = useCallback(
    (traceId: string, spanId: string) => {
      const log = filteredLogs.find((l) => l.TraceId === traceId);
      pushURLState({
        tab: "services",
        service: log?.ServiceName ?? undefined,
        trace: traceId,
        span: spanId,
      });
    },
    [filteredLogs]
  );

  return (
    <div style={{ height: "calc(100vh - 160px)" }} className="flex flex-col">
      <div className="shrink-0 mb-3">
        <LogFilter
          value={filters}
          onChange={setFilters}
          rows={logs}
          selectedServices={selectedServices}
          onSelectedServicesChange={setSelectedServices}
        />
      </div>
      <div className="flex-1 min-h-0">
        <LogTimeline
          rows={filteredLogs}
          isLoading={loading}
          error={error ?? undefined}
          streaming={isLive}
          selectedLogId={selectedLogId ?? undefined}
          onLogClick={handleLogClick}
          onTraceLinkClick={handleTraceLinkClick}
          onAtBottomChange={(atBottom) => setLive(atBottom)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services tab — data-fetching wrappers around extracted UI components
// ---------------------------------------------------------------------------

interface TraceSummaryRow {
  traceId: string;
  rootServiceName: string;
  rootSpanName: string;
  startTimeNs: string;
  durationNs: string;
  spanCount: number;
  errorCount: number;
  services: Array<{ name: string; count: number; hasError: boolean }>;
}

function TraceSearchView({
  onSelectTrace,
  onCompare,
}: {
  onSelectTrace: (traceId: string) => void;
  onCompare: (traceIds: [string, string]) => void;
}) {
  const urlState = useURLState();
  const service = urlState.service;

  // Build DataSource from URL state
  const ds = useMemo<DataSource>(() => {
    const params: Record<string, unknown> = {
      limit: urlState.limit ?? 20,
      sortOrder: "DESC" as const,
    };
    if (service) params.serviceName = service;
    if (urlState.operation) params.spanName = urlState.operation;
    if (urlState.lookback) {
      const ms = LOOKBACK_MS[urlState.lookback];
      if (ms) {
        params.timestampMin = String((Date.now() - ms) * 1e6);
      }
    }
    if (urlState.tsMin) params.timestampMin = urlState.tsMin;
    if (urlState.tsMax) params.timestampMax = urlState.tsMax;
    if (urlState.minDuration) {
      const parsed = parseDuration(urlState.minDuration);
      if (parsed) params.durationMin = parsed;
    }
    if (urlState.maxDuration) {
      const parsed = parseDuration(urlState.maxDuration);
      if (parsed) params.durationMax = parsed;
    }
    if (urlState.tags) {
      const tagMap = parseLogfmt(urlState.tags);
      if (Object.keys(tagMap).length > 0) params.tags = tagMap;
    }
    return {
      method: "searchTraceSummariesPage",
      params,
    } as DataSource;
  }, [
    service,
    urlState.operation,
    urlState.lookback,
    urlState.tsMin,
    urlState.tsMax,
    urlState.minDuration,
    urlState.maxDuration,
    urlState.limit,
    urlState.tags,
  ]);

  const handleSearch = useCallback(
    (filters: TraceSearchFilters) => {
      pushURLState({
        tab: "services",
        service: filters.service ?? service,
        operation: filters.operation ?? null,
        tags: filters.tags ?? null,
        lookback: filters.lookback ?? null,
        minDuration: filters.minDuration ?? null,
        maxDuration: filters.maxDuration ?? null,
        limit: filters.limit,
      });
    },
    [service]
  );

  // Fetch trace summaries
  const { data, loading, error } = useKopaiData<{
    data: TraceSummaryRow[];
    nextCursor: string | null;
  }>(ds);

  // Fetch services list
  const serviceDs = useMemo<DataSource>(
    () => ({ method: "getServices" as const }),
    []
  );
  const { data: servicesData } = useKopaiData<{ services: string[] }>(
    serviceDs
  );
  const _services = servicesData?.services ?? [];

  // Fetch operations for selected service
  const operationDs = useMemo<DataSource | undefined>(
    () =>
      service
        ? { method: "getOperations" as const, params: { serviceName: service } }
        : undefined,
    [service]
  );
  const { data: opsData } = useKopaiData<{ operations: string[] }>(operationDs);
  const operations = opsData?.operations ?? [];

  // Map TraceSummaryRow → TraceSummary
  const traces = useMemo<TraceSummary[]>(() => {
    if (!data?.data) return [];
    return data.data.map((row) => ({
      traceId: row.traceId,
      rootSpanName: row.rootSpanName,
      serviceName: row.rootServiceName,
      durationMs: parseInt(row.durationNs, 10) / 1e6,
      statusCode: row.errorCount > 0 ? "ERROR" : "OK",
      timestampMs: parseInt(row.startTimeNs, 10) / 1e6,
      spanCount: row.spanCount,
      services: row.services,
      errorCount: row.errorCount,
    }));
  }, [data]);

  // Auto-execute on mount — the ds is already built from URL state,
  // so useKopaiData fires automatically. No extra effect needed.

  return (
    <TraceSearch
      services={_services}
      service={service ?? ""}
      traces={traces}
      operations={operations}
      isLoading={loading}
      error={error ?? undefined}
      onSelectTrace={onSelectTrace}
      onCompare={onCompare}
      onSearch={handleSearch}
    />
  );
}

function TraceDetailView({
  traceId,
  selectedSpanId,
  onSelectSpan,
  onDeselectSpan,
  onBack,
}: {
  traceId: string;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onDeselectSpan: () => void;
  onBack: () => void;
}) {
  const ds = useMemo<DataSource>(
    () => ({
      method: "getTrace",
      params: { traceId },
    }),
    [traceId]
  );

  const { data, loading, error } = useKopaiData<OtelTracesRow[]>(ds);

  return (
    <TraceDetail
      traceId={traceId}
      rows={data ?? []}
      isLoading={loading}
      error={error ?? undefined}
      selectedSpanId={selectedSpanId ?? undefined}
      onSpanClick={(span) => onSelectSpan(span.spanId)}
      onSpanDeselect={onDeselectSpan}
      onBack={onBack}
    />
  );
}

function ServicesTab({
  selectedTraceId,
  selectedSpanId,
  compareParam,
  onSelectTrace,
  onSelectSpan,
  onDeselectSpan,
  onBack,
  onCompare,
}: {
  selectedTraceId: string | null;
  selectedSpanId: string | null;
  compareParam: string | null;
  onSelectTrace: (traceId: string) => void;
  onSelectSpan: (spanId: string) => void;
  onDeselectSpan: () => void;
  onBack: () => void;
  onCompare: (traceIds: [string, string]) => void;
}) {
  useRegisterShortcuts("services-tab", SERVICES_SHORTCUTS);

  // Backspace → navigate back
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === "Backspace") {
        e.preventDefault();
        backRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Comparison view
  if (compareParam) {
    const [traceIdA, traceIdB] = compareParam.split(",");
    if (traceIdA && traceIdB) {
      return (
        <TraceComparison
          traceIdA={traceIdA}
          traceIdB={traceIdB}
          onBack={onBack}
        />
      );
    }
  }

  if (selectedTraceId) {
    return (
      <TraceDetailView
        traceId={selectedTraceId}
        selectedSpanId={selectedSpanId}
        onSelectSpan={onSelectSpan}
        onDeselectSpan={onDeselectSpan}
        onBack={onBack}
      />
    );
  }

  // Default: TraceSearchView directly
  return (
    <TraceSearchView onSelectTrace={onSelectTrace} onCompare={onCompare} />
  );
}

// ---------------------------------------------------------------------------
// Metrics tab — DynamicDashboard
// ---------------------------------------------------------------------------

const METRICS_TREE = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: [
        "heading",
        "ingestion-heading",
        "ingestion-grid",
        "discovery-heading",
        "description",
        "discovery-card",
      ],
      parentKey: "",
      props: {
        direction: "vertical" as const,
        gap: "md" as const,
        align: null,
      },
    },
    heading: {
      key: "heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "Metrics", level: "h2" as const },
    },
    "ingestion-heading": {
      key: "ingestion-heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "OTEL Ingestion", level: "h3" as const },
    },
    "ingestion-grid": {
      key: "ingestion-grid",
      type: "Grid" as const,
      children: ["card-bytes", "card-requests"],
      parentKey: "root",
      props: { columns: 2, gap: "md" as const },
    },
    "card-bytes": {
      key: "card-bytes",
      type: "Card" as const,
      children: ["stat-bytes"],
      parentKey: "ingestion-grid",
      props: {
        title: "Total Bytes Ingested",
        description: null,
        padding: null,
      },
    },
    "stat-bytes": {
      key: "stat-bytes",
      type: "MetricStat" as const,
      children: [],
      parentKey: "card-bytes",
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "kopai.ingestion.bytes",
          aggregate: "sum" as const,
        },
        refetchIntervalMs: 10_000,
      },
      props: { label: "Bytes", showSparkline: false },
    },
    "card-requests": {
      key: "card-requests",
      type: "Card" as const,
      children: ["stat-requests"],
      parentKey: "ingestion-grid",
      props: {
        title: "Total Requests",
        description: null,
        padding: null,
      },
    },
    "stat-requests": {
      key: "stat-requests",
      type: "MetricStat" as const,
      children: [],
      parentKey: "card-requests",
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "kopai.ingestion.requests",
          aggregate: "sum" as const,
        },
        refetchIntervalMs: 10_000,
      },
      props: { label: "Requests", showSparkline: false },
    },
    "discovery-heading": {
      key: "discovery-heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "Discovered Metrics", level: "h3" as const },
    },
    description: {
      key: "description",
      type: "Text" as const,
      children: [],
      parentKey: "root",
      props: {
        content: "Discovered OpenTelemetry metrics",
        variant: "body" as const,
        color: "muted" as const,
      },
    },
    "discovery-card": {
      key: "discovery-card",
      type: "Card" as const,
      children: ["metric-discovery"],
      parentKey: "root",
      props: { title: null, description: null, padding: null },
    },
    "metric-discovery": {
      key: "metric-discovery",
      type: "MetricDiscovery" as const,
      children: [],
      parentKey: "discovery-card",
      dataSource: { method: "discoverMetrics" as const },
      props: {},
    },
  },
};

function useDashboardTree(
  client: Pick<KopaiClient, "getDashboard">,
  dashboardId: string | null
) {
  const { data, isFetching, error } = useQuery<UITree, Error>({
    queryKey: ["dashboard-tree", dashboardId],
    queryFn: async ({ signal }) => {
      const dashboard = await client.getDashboard(dashboardId!, { signal });
      const parsed = observabilityCatalog.uiTreeSchema.safeParse(
        dashboard.uiTree
      );
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.length ? issue.path.join(".") + ": " : "";
        throw new Error(
          `Dashboard has an invalid layout: ${path}${issue?.message}`
        );
      }
      return parsed.data;
    },
    enabled: !!dashboardId,
  });

  return {
    loading: isFetching,
    error: error?.message ?? null,
    tree: data ?? null,
  };
}

function MetricsTab() {
  const kopaiClient = useKopaiSDK();
  const { dashboardId } = useURLState();
  const { loading, error, tree } = useDashboardTree(kopaiClient, dashboardId);

  if (loading)
    return (
      <p className="text-muted-foreground text-sm">Loading dashboard...</p>
    );
  if (error)
    return <p className="text-muted-foreground text-sm">Error: {error}</p>;

  return (
    <DynamicDashboard kopaiClient={kopaiClient} uiTree={tree ?? METRICS_TREE} />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

let _defaultClient: KopaiClient | undefined;
function getDefaultClient() {
  _defaultClient ??= new KopaiClient({ baseUrl: "" });
  return _defaultClient;
}

interface ObservabilityPageProps {
  client?: KopaiClient;
}

export default function ObservabilityPage({ client }: ObservabilityPageProps) {
  const activeClient = client ?? getDefaultClient();
  const {
    tab: activeTab,
    trace: selectedTraceId,
    span: selectedSpanId,
    compare: compareParam,
  } = useURLState();

  const handleTabChange = useCallback((tab: Tab) => {
    pushURLState({ tab });
  }, []);

  const handleSelectTrace = useCallback((traceId: string) => {
    pushURLState({ ...readURLState(), tab: "services", trace: traceId });
  }, []);

  const handleSelectSpan = useCallback((spanId: string) => {
    pushURLState(
      { ...readURLState(), tab: "services", span: spanId },
      { replace: true }
    );
  }, []);

  const handleDeselectSpan = useCallback(() => {
    pushURLState({ ...readURLState(), span: null }, { replace: true });
  }, []);

  const handleCompare = useCallback((traceIds: [string, string]) => {
    pushURLState({
      ...readURLState(),
      tab: "services",
      trace: null,
      span: null,
      view: null,
      uiFind: null,
      viewStart: null,
      viewEnd: null,
      compare: traceIds.join(","),
    });
  }, []);

  const handleBack = useCallback(() => {
    pushURLState({
      ...readURLState(),
      tab: "services",
      trace: null,
      span: null,
      view: null,
      uiFind: null,
      viewStart: null,
      viewEnd: null,
      compare: null,
    });
  }, []);

  return (
    <KopaiSDKProvider client={activeClient}>
      <KeyboardShortcutsProvider
        onNavigateServices={() => pushURLState({ tab: "services" })}
        onNavigateLogs={() => pushURLState({ tab: "logs" })}
        onNavigateMetrics={() => pushURLState({ tab: "metrics" })}
      >
        <div>
          <TabBar
            tabs={TABS}
            active={activeTab}
            onChange={handleTabChange as (key: string) => void}
          />
          {activeTab === "logs" && <LogsTab />}
          {activeTab === "services" && (
            <ServicesTab
              selectedTraceId={selectedTraceId}
              selectedSpanId={selectedSpanId}
              compareParam={compareParam}
              onSelectTrace={handleSelectTrace}
              onSelectSpan={handleSelectSpan}
              onDeselectSpan={handleDeselectSpan}
              onBack={handleBack}
              onCompare={handleCompare}
            />
          )}
          {activeTab === "metrics" && <MetricsTab />}
        </div>
      </KeyboardShortcutsProvider>
    </KopaiSDKProvider>
  );
}
