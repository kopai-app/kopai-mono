import { KopaiSDKProvider } from "../lib/kopai-provider.js";
import { createSimpleCatalog } from "../lib/simple-component-catalog.js";
import {
  Renderer,
  createRegistry,
  type RendererComponentProps,
} from "../lib/simple-renderer.js";
import { KopaiClient } from "@kopai/sdk";
import { denormalizedSignals } from "@kopai/core";
import { z } from "zod";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;
type OtelLogsRow = denormalizedSignals.OtelLogsRow;
type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  fontSize: 12,
  marginTop: 8,
};

const thStyle = {
  textAlign: "left" as const,
  padding: "8px 4px",
  borderBottom: "2px solid var(--border)",
  whiteSpace: "nowrap" as const,
};

const tdStyle = {
  padding: "6px 4px",
  borderBottom: "1px solid var(--border)",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

function formatTimestamp(ts: string) {
  if (!ts) return "-";
  const ms = Number(ts) / 1e6;
  return new Date(ms).toLocaleTimeString();
}

function formatDuration(ns: string) {
  if (!ns) return "-";
  const ms = Number(ns) / 1e6;
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(1)}ms`;
}

function formatAttrs(attrs: Record<string, unknown> | undefined) {
  if (!attrs) return "-";
  const entries = Object.entries(attrs).slice(0, 3);
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") || "-";
}

// Create catalog for dashboard OTel components
const dashboardOtelCatalog = createSimpleCatalog({
  name: "dashboard-otel",
  components: {
    TracesTable: {
      props: z.object({}),
      hasChildren: false,
      description: "Table displaying OpenTelemetry traces",
    },
    LogsTable: {
      props: z.object({}),
      hasChildren: false,
      description: "Table displaying OpenTelemetry logs",
    },
    MetricsTable: {
      props: z.object({}),
      hasChildren: false,
      description: "Table displaying OpenTelemetry metrics",
    },
    Container: {
      props: z.object({}),
      hasChildren: true,
      description: "Container wrapper with padding",
    },
  },
});

type UITree = z.infer<typeof dashboardOtelCatalog.uiTreeSchema>;

// Traces Table
function TracesTable(
  props: RendererComponentProps<
    typeof dashboardOtelCatalog.components.TracesTable
  >
) {
  if (!props.hasData) return <div>No data source</div>;
  const { data, loading, error, refetch } = props;
  if (loading) return <div>Loading traces...</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error.message}</div>;

  const traces = ((data as { data?: unknown[] })?.data ??
    []) as OtelTracesRow[];
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Traces ({traces.length})</h2>
        <button onClick={() => refetch()}>Refresh</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>TraceId</th>
              <th style={thStyle}>SpanId</th>
              <th style={thStyle}>ParentSpanId</th>
              <th style={thStyle}>SpanName</th>
              <th style={thStyle}>SpanKind</th>
              <th style={thStyle}>Duration</th>
              <th style={thStyle}>ServiceName</th>
              <th style={thStyle}>StatusCode</th>
              <th style={thStyle}>StatusMessage</th>
              <th style={thStyle}>SpanAttributes</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t, i) => (
              <tr key={`${t.TraceId}-${t.SpanId}-${i}`}>
                <td style={tdStyle}>{formatTimestamp(t.Timestamp)}</td>
                <td style={tdStyle} title={t.TraceId}>
                  {t.TraceId?.slice(0, 8)}...
                </td>
                <td style={tdStyle} title={t.SpanId}>
                  {t.SpanId?.slice(0, 8)}...
                </td>
                <td style={tdStyle}>{t.ParentSpanId?.slice(0, 8) || "-"}</td>
                <td style={tdStyle} title={t.SpanName}>
                  {t.SpanName || "-"}
                </td>
                <td style={tdStyle}>{t.SpanKind || "-"}</td>
                <td style={tdStyle}>
                  {t.Duration ? formatDuration(t.Duration) : "-"}
                </td>
                <td style={tdStyle}>{t.ServiceName || "-"}</td>
                <td style={tdStyle}>{t.StatusCode || "-"}</td>
                <td style={tdStyle}>{t.StatusMessage || "-"}</td>
                <td style={tdStyle} title={JSON.stringify(t.SpanAttributes)}>
                  {formatAttrs(t.SpanAttributes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Logs Table
function LogsTable(
  props: RendererComponentProps<
    typeof dashboardOtelCatalog.components.LogsTable
  >
) {
  if (!props.hasData) return <div>No data source</div>;
  const { data, loading, error, refetch } = props;
  if (loading) return <div>Loading logs...</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error.message}</div>;

  const logs = ((data as { data?: unknown[] })?.data ?? []) as OtelLogsRow[];
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Logs ({logs.length})</h2>
        <button onClick={() => refetch()}>Refresh</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>Severity</th>
              <th style={thStyle}>Body</th>
              <th style={thStyle}>ServiceName</th>
              <th style={thStyle}>TraceId</th>
              <th style={thStyle}>SpanId</th>
              <th style={thStyle}>ScopeName</th>
              <th style={thStyle}>LogAttributes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={`${l.Timestamp}-${i}`}>
                <td style={tdStyle}>{formatTimestamp(l.Timestamp)}</td>
                <td style={tdStyle}>
                  {l.SeverityText || l.SeverityNumber || "-"}
                </td>
                <td style={{ ...tdStyle, maxWidth: 300 }} title={l.Body}>
                  {l.Body || "-"}
                </td>
                <td style={tdStyle}>{l.ServiceName || "-"}</td>
                <td style={tdStyle} title={l.TraceId}>
                  {l.TraceId?.slice(0, 8) || "-"}
                </td>
                <td style={tdStyle} title={l.SpanId}>
                  {l.SpanId?.slice(0, 8) || "-"}
                </td>
                <td style={tdStyle}>{l.ScopeName || "-"}</td>
                <td style={tdStyle} title={JSON.stringify(l.LogAttributes)}>
                  {formatAttrs(l.LogAttributes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Metrics Table
function MetricsTable(
  props: RendererComponentProps<
    typeof dashboardOtelCatalog.components.MetricsTable
  >
) {
  if (!props.hasData) return <div>No data source</div>;
  const { data, loading, error, refetch } = props;
  if (loading) return <div>Loading metrics...</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error.message}</div>;

  const metrics = ((data as { data?: unknown[] })?.data ??
    []) as OtelMetricsRow[];
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Metrics ({metrics.length})</h2>
        <button onClick={() => refetch()}>Refresh</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Time</th>
              <th style={thStyle}>MetricName</th>
              <th style={thStyle}>MetricType</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}>Unit</th>
              <th style={thStyle}>ServiceName</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Attributes</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m, i) => {
              // Value depends on metric type
              let value = "-";
              if (m.MetricType === "Gauge" || m.MetricType === "Sum") {
                value = m.Value?.toFixed(2) ?? "-";
              } else if (
                m.MetricType === "Histogram" ||
                m.MetricType === "Summary" ||
                m.MetricType === "ExponentialHistogram"
              ) {
                value = `count=${m.Count ?? 0}, sum=${m.Sum?.toFixed(2) ?? 0}`;
              }
              return (
                <tr key={`${m.MetricName}-${m.TimeUnix}-${i}`}>
                  <td style={tdStyle}>{formatTimestamp(m.TimeUnix)}</td>
                  <td style={tdStyle} title={m.MetricName}>
                    {m.MetricName || "-"}
                  </td>
                  <td style={tdStyle}>{m.MetricType || "-"}</td>
                  <td style={tdStyle}>{value}</td>
                  <td style={tdStyle}>{m.MetricUnit || "-"}</td>
                  <td style={tdStyle}>{m.ServiceName || "-"}</td>
                  <td style={tdStyle} title={m.MetricDescription}>
                    {m.MetricDescription?.slice(0, 30) || "-"}
                  </td>
                  <td style={tdStyle} title={JSON.stringify(m.Attributes)}>
                    {formatAttrs(m.Attributes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Container(
  props: RendererComponentProps<
    typeof dashboardOtelCatalog.components.Container
  >
) {
  return <div style={{ padding: 24 }}>{props.children}</div>;
}

const registry = createRegistry(dashboardOtelCatalog, {
  TracesTable,
  LogsTable,
  MetricsTable,
  Container,
});

// UI tree with all three signal types
const testTree: UITree = {
  root: "container-1",
  elements: {
    "container-1": {
      key: "container-1",
      type: "Container",
      props: {},
      children: ["traces-table", "logs-table", "metrics-table"],
      parentKey: "",
    },
    "traces-table": {
      key: "traces-table",
      type: "TracesTable",
      props: {},
      parentKey: "container-1",
      children: [],
      dataSource: {
        method: "searchTracesPage",
        params: { limit: 10 },
      },
    },
    "logs-table": {
      key: "logs-table",
      type: "LogsTable",
      props: {},
      parentKey: "container-1",
      children: [],
      dataSource: {
        method: "searchLogsPage",
        params: { limit: 10 },
      },
    },
    "metrics-table": {
      key: "metrics-table",
      type: "MetricsTable",
      props: {},
      parentKey: "container-1",
      children: [],
      dataSource: {
        method: "searchMetricsPage",
        params: { metricType: "Sum", limit: 10 },
      },
    },
  },
};

// Create SDK client pointing to local server
const client = new KopaiClient({ baseUrl: "http://localhost:8000/signals" });

export default function DashboardPage() {
  return (
    <KopaiSDKProvider client={client}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 48 }}>
        <h1>Kopai Dashboard</h1>
        <p style={{ color: "var(--muted)" }}>
          Real-time telemetry data from KopaiSDK
        </p>
        <Renderer tree={testTree} registry={registry} />
      </div>
    </KopaiSDKProvider>
  );
}
