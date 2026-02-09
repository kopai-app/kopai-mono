import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { observabilityCatalog } from "../lib/observability-catalog.js";
import { createRendererFromCatalog } from "../lib/renderer.js";
import { KopaiSDKProvider, useKopaiSDK } from "../providers/kopai-provider.js";
import { KopaiClient } from "@kopai/sdk";
import { useKopaiData } from "../hooks/use-kopai-data.js";
import { useLiveLogs } from "../hooks/use-live-logs.js";
import type { denormalizedSignals, dataFilterSchemas } from "@kopai/core";
import type { DataSource } from "../lib/component-catalog.js";

// Observability components
import {
  LogTimeline,
  LogFilter,
  TabBar,
  ServiceList,
  TraceSearch,
  TraceDetail,
} from "../components/observability/index.js";
import type {
  TraceSummary,
  TraceSearchFilters,
} from "../components/observability/index.js";

// Renderer components (for Metrics tab)
import { Card, Grid, Stack } from "../components/dashboard/index.js";
import {
  OtelMetricTimeSeries,
  OtelMetricHistogram,
  OtelMetricStat,
  OtelMetricTable,
} from "../components/observability/renderers/index.js";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type Tab = "logs" | "services" | "metrics";

const TABS: { key: Tab; label: string }[] = [
  { key: "services", label: "Services" },
  { key: "logs", label: "Logs" },
  { key: "metrics", label: "Metrics" },
];

// ---------------------------------------------------------------------------
// URL state helpers
// ---------------------------------------------------------------------------

interface URLState {
  tab: Tab;
  service: string | null;
  trace: string | null;
  span: string | null;
}

function readURLState(): URLState {
  const params = new URLSearchParams(window.location.search);
  const service = params.get("service");
  const trace = params.get("trace");
  const span = params.get("span");
  const rawTab = params.get("tab");
  const tab = service
    ? "services"
    : rawTab === "logs" || rawTab === "metrics"
      ? rawTab
      : "services";
  return { tab, service, trace, span };
}

function pushURLState(
  state: {
    tab: Tab;
    service?: string | null;
    trace?: string | null;
    span?: string | null;
  },
  { replace = false }: { replace?: boolean } = {}
) {
  const params = new URLSearchParams();
  if (state.tab !== "services") params.set("tab", state.tab);
  if (state.service) params.set("service", state.service);
  if (state.trace) params.set("trace", state.trace);
  if (state.span) params.set("span", state.span);
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
  trace: null,
  span: null,
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
          onAtBottomChange={(atBottom) => setLive(atBottom)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Services tab — data-fetching wrappers around extracted UI components
// ---------------------------------------------------------------------------

const SERVICES_DS: DataSource = {
  method: "searchTracesPage",
  params: { limit: 1000, sortOrder: "DESC" },
};

function ServiceListView({
  onSelect,
}: {
  onSelect: (service: string) => void;
}) {
  const { data, loading, error } = useKopaiData<{
    data: OtelTracesRow[];
    nextCursor: string | null;
  }>(SERVICES_DS);

  const services = useMemo(() => {
    if (!data?.data) return [];
    const counts = new Map<string, number>();
    for (const row of data.data) {
      const svc = row.ServiceName ?? "unknown";
      counts.set(svc, (counts.get(svc) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, spanCount: count }));
  }, [data]);

  return (
    <ServiceList
      services={services}
      isLoading={loading}
      error={error ?? undefined}
      onSelect={onSelect}
    />
  );
}

function TraceSearchView({
  service,
  onBack,
  onSelectTrace,
}: {
  service: string;
  onBack: () => void;
  onSelectTrace: (traceId: string) => void;
}) {
  const [ds, setDs] = useState<DataSource>(() => ({
    method: "searchTracesPage",
    params: { serviceName: service, limit: 20, sortOrder: "DESC" as const },
  }));

  const handleSearch = useCallback(
    (filters: TraceSearchFilters) => {
      const params: Record<string, unknown> = {
        serviceName: service,
        limit: filters.limit,
        sortOrder: "DESC",
      };
      if (filters.operation) params.spanName = filters.operation;
      if (filters.lookbackMs) {
        params.timestampMin = String((Date.now() - filters.lookbackMs) * 1e6);
      }
      if (filters.minDuration) {
        const parsed = parseDuration(filters.minDuration);
        if (parsed) params.durationMin = parsed;
      }
      if (filters.maxDuration) {
        const parsed = parseDuration(filters.maxDuration);
        if (parsed) params.durationMax = parsed;
      }
      setDs({
        method: "searchTracesPage",
        params,
      } as DataSource);
    },
    [service]
  );

  const { data, loading, error } = useKopaiData<{
    data: OtelTracesRow[];
    nextCursor: string | null;
  }>(ds);

  // Fetch full traces for each unique traceId so service breakdown is complete
  const client = useKopaiSDK();
  const [fullTraces, setFullTraces] = useState<Map<string, OtelTracesRow[]>>(
    () => new Map()
  );

  useEffect(() => {
    if (!data?.data?.length) {
      setFullTraces(new Map());
      return;
    }
    const traceIds = [...new Set(data.data.map((r) => r.TraceId))];
    const ac = new AbortController();

    Promise.all(
      traceIds.map((tid) =>
        client
          .getTrace(tid, { signal: ac.signal })
          .then((spans) => [tid, spans] as const)
      )
    )
      .then((entries) => {
        if (!ac.signal.aborted) {
          setFullTraces(new Map(entries));
        }
      })
      .catch((err) => {
        if (!ac.signal.aborted)
          console.error("Failed to fetch full traces", err);
      });

    return () => ac.abort();
  }, [data, client]);

  // Derive unique operations for filter dropdown
  const operations = useMemo(() => {
    if (!data?.data) return [];
    const set = new Set<string>();
    for (const row of data.data) {
      if (row.SpanName) set.add(row.SpanName);
    }
    return Array.from(set).sort();
  }, [data]);

  const traces = useMemo<TraceSummary[]>(() => {
    if (!data?.data) return [];
    const grouped = new Map<string, OtelTracesRow[]>();
    for (const row of data.data) {
      const tid = row.TraceId;
      if (!grouped.has(tid)) grouped.set(tid, []);
      grouped.get(tid)!.push(row);
    }

    return Array.from(grouped.entries()).map(([traceId, searchSpans]) => {
      const fullSpans = fullTraces.get(traceId);
      const spans = fullSpans ?? searchSpans;

      const root = spans.find((s) => !s.ParentSpanId) ?? spans[0]!;
      const durationNs = root.Duration ? parseInt(root.Duration, 10) : 0;

      const svcMap = new Map<string, { count: number; hasError: boolean }>();
      let errorCount = 0;
      for (const s of spans) {
        const svcName = s.ServiceName ?? "unknown";
        const entry = svcMap.get(svcName) ?? { count: 0, hasError: false };
        entry.count++;
        if (s.StatusCode === "ERROR") {
          entry.hasError = true;
          errorCount++;
        }
        svcMap.set(svcName, entry);
      }
      const services = Array.from(svcMap.entries())
        .map(([name, v]) => ({ name, count: v.count, hasError: v.hasError }))
        .sort((a, b) => b.count - a.count);

      return {
        traceId,
        rootSpanName: root.SpanName ?? "unknown",
        serviceName: root.ServiceName ?? "unknown",
        durationMs: durationNs / 1e6,
        statusCode: root.StatusCode ?? "UNSET",
        timestampMs: parseInt(root.Timestamp, 10) / 1e6,
        spanCount: spans.length,
        services,
        errorCount,
      };
    });
  }, [data, fullTraces]);

  return (
    <TraceSearch
      service={service}
      traces={traces}
      operations={operations}
      isLoading={loading}
      error={error ?? undefined}
      onSelectTrace={onSelectTrace}
      onBack={onBack}
      onSearch={handleSearch}
    />
  );
}

function TraceDetailView({
  service,
  traceId,
  selectedSpanId,
  onSelectSpan,
  onBack,
}: {
  service: string;
  traceId: string;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
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
      service={service}
      traceId={traceId}
      rows={data ?? []}
      isLoading={loading}
      error={error ?? undefined}
      selectedSpanId={selectedSpanId ?? undefined}
      onSpanClick={(span) => onSelectSpan(span.spanId)}
      onBack={onBack}
    />
  );
}

function ServicesTab({
  selectedService,
  selectedTraceId,
  selectedSpanId,
  onSelectService,
  onSelectTrace,
  onSelectSpan,
  onBackToServices,
  onBackToTraceList,
}: {
  selectedService: string | null;
  selectedTraceId: string | null;
  selectedSpanId: string | null;
  onSelectService: (service: string) => void;
  onSelectTrace: (traceId: string) => void;
  onSelectSpan: (spanId: string) => void;
  onBackToServices: () => void;
  onBackToTraceList: () => void;
}) {
  if (selectedTraceId && selectedService) {
    return (
      <TraceDetailView
        service={selectedService}
        traceId={selectedTraceId}
        selectedSpanId={selectedSpanId}
        onSelectSpan={onSelectSpan}
        onBack={onBackToTraceList}
      />
    );
  }
  if (selectedService) {
    return (
      <TraceSearchView
        service={selectedService}
        onBack={onBackToServices}
        onSelectTrace={onSelectTrace}
      />
    );
  }
  return <ServiceListView onSelect={onSelectService} />;
}

// ---------------------------------------------------------------------------
// Metrics tab (configurable, uses renderer)
// ---------------------------------------------------------------------------

const MetricsRenderer = createRendererFromCatalog(observabilityCatalog, {
  Card,
  Grid,
  Stack,
  Heading: () => null,
  Text: () => null,
  Badge: () => null,
  Divider: () => null,
  Empty: () => null,
  LogTimeline: () => null,
  TraceDetail: () => null,
  MetricTimeSeries: OtelMetricTimeSeries,
  MetricHistogram: OtelMetricHistogram,
  MetricStat: OtelMetricStat,
  MetricTable: OtelMetricTable,
});

const metricsTree = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: [
        "stats-grid",
        "cpu-chart-card",
        "duration-card",
        "metrics-table-card",
      ],
      parentKey: "",
      props: { direction: "vertical", gap: "lg", align: null },
    },

    // Stats Grid
    "stats-grid": {
      key: "stats-grid",
      type: "Grid" as const,
      children: ["stat-active-req-card", "stat-cpu-card", "stat-memory-card"],
      parentKey: "root",
      props: { columns: 3, gap: "md" },
    },
    "stat-active-req-card": {
      key: "stat-active-req-card",
      type: "Card" as const,
      children: ["stat-active-req"],
      parentKey: "stats-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "stat-active-req": {
      key: "stat-active-req",
      type: "MetricStat" as const,
      children: [],
      parentKey: "stat-active-req-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "http.server.active_requests",
          limit: 50,
        },
        refetchIntervalMs: 30_000,
      },
      props: { label: "Active Requests", showSparkline: true },
    },
    "stat-cpu-card": {
      key: "stat-cpu-card",
      type: "Card" as const,
      children: ["stat-cpu"],
      parentKey: "stats-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "stat-cpu": {
      key: "stat-cpu",
      type: "MetricStat" as const,
      children: [],
      parentKey: "stat-cpu-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Gauge" as const,
          metricName: "system.cpu.utilization",
          limit: 50,
        },
        refetchIntervalMs: 30_000,
      },
      props: { label: "CPU Utilization", showSparkline: true },
    },
    "stat-memory-card": {
      key: "stat-memory-card",
      type: "Card" as const,
      children: ["stat-memory"],
      parentKey: "stats-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "stat-memory": {
      key: "stat-memory",
      type: "MetricStat" as const,
      children: [],
      parentKey: "stat-memory-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Gauge" as const,
          metricName: "system.memory.utilization",
          limit: 50,
        },
        refetchIntervalMs: 30_000,
      },
      props: { label: "Memory Utilization", showSparkline: true },
    },

    // CPU Time Series
    "cpu-chart-card": {
      key: "cpu-chart-card",
      type: "Card" as const,
      children: ["cpu-time-series"],
      parentKey: "root",
      props: { title: "CPU Utilization", description: null, padding: "md" },
    },
    "cpu-time-series": {
      key: "cpu-time-series",
      type: "MetricTimeSeries" as const,
      children: [],
      parentKey: "cpu-chart-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Gauge" as const,
          metricName: "system.cpu.utilization",
          limit: 500,
        },
        refetchIntervalMs: 30_000,
      },
      props: { height: 400, showBrush: true },
    },

    // Request Duration Histogram
    "duration-card": {
      key: "duration-card",
      type: "Card" as const,
      children: ["duration-histogram"],
      parentKey: "root",
      props: { title: "Request Duration", description: null, padding: "md" },
    },
    "duration-histogram": {
      key: "duration-histogram",
      type: "MetricHistogram" as const,
      children: [],
      parentKey: "duration-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Histogram" as const,
          metricName: "http.server.request.duration",
          limit: 100,
        },
        refetchIntervalMs: 30_000,
      },
      props: { height: 400 },
    },

    // JVM Memory Table
    "metrics-table-card": {
      key: "metrics-table-card",
      type: "Card" as const,
      children: ["jvm-memory-table"],
      parentKey: "root",
      props: { title: "JVM Memory", description: null, padding: "md" },
    },
    "jvm-memory-table": {
      key: "jvm-memory-table",
      type: "MetricTable" as const,
      children: [],
      parentKey: "metrics-table-card",
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "jvm.memory.used",
          limit: 50,
        },
        refetchIntervalMs: 30_000,
      },
      props: { maxRows: 25 },
    },
  },
};

function MetricsTab() {
  return <MetricsRenderer tree={metricsTree} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const client = new KopaiClient({ baseUrl: "http://localhost:8000/signals" });

export default function ObservabilityPage() {
  const {
    tab: activeTab,
    service: selectedService,
    trace: selectedTraceId,
    span: selectedSpanId,
  } = useURLState();

  const handleTabChange = useCallback((tab: Tab) => {
    pushURLState({ tab });
  }, []);

  const handleSelectService = useCallback((service: string) => {
    pushURLState({ tab: "services", service });
  }, []);

  const handleSelectTrace = useCallback(
    (traceId: string) => {
      pushURLState({
        tab: "services",
        service: selectedService,
        trace: traceId,
      });
    },
    [selectedService]
  );

  const handleSelectSpan = useCallback(
    (spanId: string) => {
      pushURLState(
        {
          tab: "services",
          service: selectedService,
          trace: selectedTraceId,
          span: spanId,
        },
        { replace: true }
      );
    },
    [selectedService, selectedTraceId]
  );

  const handleBackToServices = useCallback(() => {
    pushURLState({ tab: "services" });
  }, []);

  const handleBackToTraceList = useCallback(() => {
    pushURLState({ tab: "services", service: selectedService });
  }, [selectedService]);

  return (
    <KopaiSDKProvider client={client}>
      <div className="min-h-screen bg-background text-foreground p-6">
        <h1 className="text-2xl font-bold mb-4">Observability</h1>
        <TabBar
          tabs={TABS}
          active={activeTab}
          onChange={handleTabChange as (key: string) => void}
        />
        {activeTab === "logs" && <LogsTab />}
        {activeTab === "services" && (
          <ServicesTab
            selectedService={selectedService}
            selectedTraceId={selectedTraceId}
            selectedSpanId={selectedSpanId}
            onSelectService={handleSelectService}
            onSelectTrace={handleSelectTrace}
            onSelectSpan={handleSelectSpan}
            onBackToServices={handleBackToServices}
            onBackToTraceList={handleBackToTraceList}
          />
        )}
        {activeTab === "metrics" && <MetricsTab />}
      </div>
    </KopaiSDKProvider>
  );
}

export { metricsTree, MetricsRenderer };
