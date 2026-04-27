/**
 * Reference implementation for `@kopai/ui`'s `observabilityCatalog`.
 *
 * This file is intentionally self-contained and minimal. Its purpose is
 * pedagogical: it shows, for every component in the catalog, the exact typing
 * and rendering contract a custom consumer must fulfil. The production-grade
 * renderers shipped inside `@kopai/ui` live under
 * `packages/ui/src/components/observability/renderers/OtelMetric*.tsx` and
 * include charts, virtual lists, drill-downs etc — read those when you need a
 * feature-complete implementation.
 *
 * File layout:
 *   1. Imports & shared `RendererProps<N>` helper type
 *   2. <RequestState> / <NoSource> helpers used by every data-backed renderer
 *   3. Primitive renderers:   Stack, Grid, Card, Heading, Text, Badge, Divider, Empty
 *   4. Data-backed renderers: MetricStat, MetricTimeSeries, MetricHistogram,
 *                             MetricTable, MetricDiscovery, LogTimeline, TraceDetail
 *   5. Kitchen-sink `UITree` exercising every component
 *   6. Provider-wrapped <ExampleObservabilityCatalog /> export
 */

// =============================================================================
// 1. Imports & shared types
// =============================================================================
import {
  KopaiClient,
  type AggregatedMetricRow,
  type OtelLogsRow,
  type OtelMetricsRow,
  type OtelTracesRow,
  type SearchResult,
  type TraceSummaryRow,
} from "@kopai/sdk";
import {
  KopaiSDKProvider,
  createRendererFromCatalog,
  observabilityCatalog,
  type RendererComponentProps,
} from "@kopai/ui-core";
import type { ReactNode } from "react";
import { z } from "zod";

type Catalog = typeof observabilityCatalog.components;

/**
 * Helper: given a catalog component name, resolve the fully-typed props the
 * renderer receives. This is the idiomatic pattern for building a renderer
 * registry — the discriminated-union over `hasData` + narrowed `response`
 * comes from here.
 */
type RendererProps<N extends keyof Catalog> = RendererComponentProps<
  Catalog[N]
>;

// Catalog-specific UITree type. Derived from the catalog's Zod schema, so it
// narrows to the exact union of element variants allowed by *this* catalog.
type ObservabilityUITree = z.infer<typeof observabilityCatalog.uiTreeSchema>;

// =============================================================================
// 2. Shared helpers
// =============================================================================

/** Uniform loading / error display for every data-backed renderer. */
function RequestState({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  if (loading) return <span style={{ color: "#666" }}>Loading…</span>;
  if (error) {
    return <span style={{ color: "#ef4444" }}>Error: {error.message}</span>;
  }
  return <>{children}</>;
}

/** Shown when a data-backed component is rendered without a dataSource. */
function NoSource({ name }: { name: string }) {
  return (
    <span style={{ color: "#999", fontStyle: "italic" }}>
      {name}: no dataSource configured
    </span>
  );
}

// =============================================================================
// 3. Primitive renderers
// =============================================================================

const gapMap: Record<string, string> = { sm: "8px", md: "16px", lg: "24px" };
const padMap: Record<string, string> = { sm: "8px", md: "16px", lg: "24px" };
const alignMap: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

function Stack({ element, children }: RendererProps<"Stack">) {
  const { direction, gap, align } = element.props;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap: gapMap[gap ?? "md"],
        alignItems: alignMap[align ?? "stretch"],
      }}
    >
      {children}
    </div>
  );
}

function Grid({ element, children }: RendererProps<"Grid">) {
  const { columns, gap } = element.props;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns ?? 2}, minmax(0, 1fr))`,
        gap: gapMap[gap ?? "md"],
      }}
    >
      {children}
    </div>
  );
}

function Card({ element, children }: RendererProps<"Card">) {
  const { title, description, padding } = element.props;
  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        padding: padMap[padding ?? "md"],
        background: "#fff",
      }}
    >
      {(title || description) && (
        <div style={{ marginBottom: 8 }}>
          {title && (
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          )}
          {description && (
            <div style={{ color: "#666", fontSize: 12 }}>{description}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function Heading({ element }: RendererProps<"Heading">) {
  const { text, level } = element.props;
  const Tag = level ?? "h2";
  return <Tag style={{ margin: 0 }}>{text}</Tag>;
}

const textSize: Record<string, string> = {
  body: "14px",
  caption: "12px",
  label: "13px",
};
const textColor: Record<string, string> = {
  default: "#111",
  muted: "#666",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#ef4444",
};
function Text({ element }: RendererProps<"Text">) {
  const { content, variant, color } = element.props;
  return (
    <p
      style={{
        margin: 0,
        fontSize: textSize[variant ?? "body"],
        color: textColor[color ?? "default"],
      }}
    >
      {content}
    </p>
  );
}

const badgeBg: Record<string, string> = {
  default: "#f1f5f9",
  success: "#dcfce7",
  warning: "#fef3c7",
  danger: "#fee2e2",
  info: "#dbeafe",
};
const badgeFg: Record<string, string> = {
  default: "#334155",
  success: "#166534",
  warning: "#92400e",
  danger: "#991b1b",
  info: "#1e40af",
};
function Badge({ element }: RendererProps<"Badge">) {
  const { text, variant } = element.props;
  const v = variant ?? "default";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        background: badgeBg[v],
        color: badgeFg[v],
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {text}
    </span>
  );
}

function Divider({ element }: RendererProps<"Divider">) {
  const { label } = element.props;
  if (!label) {
    return (
      <hr
        style={{ border: "none", borderTop: "1px solid #e5e5e5", margin: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#666",
        fontSize: 12,
      }}
    >
      <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e5e5e5" }} />
      <span>{label}</span>
      <hr style={{ flex: 1, border: "none", borderTop: "1px solid #e5e5e5" }} />
    </div>
  );
}

function Empty({ element }: RendererProps<"Empty">) {
  const { title, description, action, actionLabel } = element.props;
  return (
    <div style={{ textAlign: "center", padding: 24, color: "#666" }}>
      <div style={{ fontWeight: 600, color: "#111", marginBottom: 4 }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 13, marginBottom: 12 }}>{description}</div>
      )}
      {action && actionLabel && (
        <a href={action} style={{ fontSize: 13 }}>
          {actionLabel}
        </a>
      )}
    </div>
  );
}

// =============================================================================
// 4. Data-backed renderers
//
// Each follows the same three-step shape:
//   a) bail out if `!hasData` (element has no dataSource attached);
//   b) wrap display in <RequestState> to cover loading / error;
//   c) render the response. For components whose `acceptsDataFrom` lists
//      multiple methods, narrow the response type with a `method === "..."`
//      type guard before indexing into method-specific fields.
// =============================================================================

// ---------- MetricStat (two accepted methods) -------------------------------
type MetricStatProps = RendererProps<"MetricStat">;
function isAggregatedMetricStat(
  props: MetricStatProps & { hasData: true }
): props is MetricStatProps & {
  hasData: true;
  response: { data: AggregatedMetricRow[]; nextCursor: null } | null;
} {
  return props.element.dataSource?.method === "searchAggregatedMetrics";
}

function MetricStat(props: MetricStatProps) {
  if (!props.hasData) return <NoSource name="MetricStat" />;
  const { label } = props.element.props;

  return (
    <RequestState loading={props.loading} error={props.error}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {label && <span style={{ color: "#666", fontSize: 12 }}>{label}</span>}
        {isAggregatedMetricStat(props) ? (
          <span style={{ fontSize: 24, fontWeight: 600 }}>
            {props.response?.data[0]?.value ?? "—"}
          </span>
        ) : (
          <span style={{ fontSize: 14 }}>
            {props.response?.data.length ?? 0} rows
            {props.response?.data[0]?.MetricName
              ? ` · ${props.response.data[0].MetricName}`
              : ""}
          </span>
        )}
      </div>
    </RequestState>
  );
}

// ---------- MetricTimeSeries ------------------------------------------------
function MetricTimeSeries(props: RendererProps<"MetricTimeSeries">) {
  if (!props.hasData) return <NoSource name="MetricTimeSeries" />;
  const rows: OtelMetricsRow[] = props.response?.data ?? [];
  return (
    <RequestState loading={props.loading} error={props.error}>
      <div style={{ fontSize: 13, color: "#666" }}>
        {rows.length} points
        {rows[0]?.MetricName ? ` · ${rows[0].MetricName}` : ""}{" "}
        <em>(render a line chart here)</em>
      </div>
    </RequestState>
  );
}

// ---------- MetricHistogram -------------------------------------------------
function MetricHistogram(props: RendererProps<"MetricHistogram">) {
  if (!props.hasData) return <NoSource name="MetricHistogram" />;
  const rows: OtelMetricsRow[] = props.response?.data ?? [];
  const first = rows[0];
  return (
    <RequestState loading={props.loading} error={props.error}>
      <div style={{ fontSize: 13, color: "#666" }}>
        {rows.length} data points
        {first?.MetricName ? ` · ${first.MetricName}` : ""}
        {first && first.MetricType === "Histogram" && first.Count !== undefined
          ? ` · count=${first.Count}`
          : ""}{" "}
        <em>(render a histogram here)</em>
      </div>
    </RequestState>
  );
}

// ---------- MetricTable -----------------------------------------------------
function MetricTable(props: RendererProps<"MetricTable">) {
  if (!props.hasData) return <NoSource name="MetricTable" />;
  const maxRows = props.element.props.maxRows ?? 5;
  const rows: OtelMetricsRow[] = props.response?.data ?? [];
  const shown = rows.slice(0, maxRows);
  return (
    <RequestState loading={props.loading} error={props.error}>
      {shown.length === 0 ? (
        <div style={{ fontSize: 12, color: "#999" }}>(no rows)</div>
      ) : (
        <table
          style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "#666" }}>
              <th style={{ padding: "4px 8px" }}>Time</th>
              <th style={{ padding: "4px 8px" }}>Metric</th>
              <th style={{ padding: "4px 8px" }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={`${r.TimeUnix}-${r.MetricName ?? ""}-${i}`}
                style={{ borderTop: "1px solid #eee" }}
              >
                <td style={{ padding: "4px 8px" }}>{r.TimeUnix}</td>
                <td style={{ padding: "4px 8px" }}>{r.MetricName ?? "—"}</td>
                <td style={{ padding: "4px 8px" }}>{r.MetricType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </RequestState>
  );
}

// ---------- MetricDiscovery -------------------------------------------------
// Unlike the paginated endpoints, `discoverMetrics` returns `{ metrics: [...] }`
// — the shape is different, and the renderer reads `response.metrics` (not
// `response.data`).
function MetricDiscovery(props: RendererProps<"MetricDiscovery">) {
  if (!props.hasData) return <NoSource name="MetricDiscovery" />;
  const metrics = props.response?.metrics ?? [];
  return (
    <RequestState loading={props.loading} error={props.error}>
      {metrics.length === 0 ? (
        <div style={{ fontSize: 12, color: "#999" }}>
          (no metrics discovered)
        </div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
          {metrics.slice(0, 10).map((m) => (
            <li key={m.name}>
              <code>{m.name}</code>{" "}
              <span style={{ color: "#666" }}>({m.type})</span>
            </li>
          ))}
          {metrics.length > 10 && (
            <li style={{ color: "#999" }}>…{metrics.length - 10} more</li>
          )}
        </ul>
      )}
    </RequestState>
  );
}

// ---------- LogTimeline -----------------------------------------------------
function LogTimeline(props: RendererProps<"LogTimeline">) {
  if (!props.hasData) return <NoSource name="LogTimeline" />;
  const rows: OtelLogsRow[] = props.response?.data ?? [];
  return (
    <RequestState loading={props.loading} error={props.error}>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#999" }}>(no log rows)</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}>
          {rows.slice(0, 10).map((r, i) => (
            <li
              key={`${r.Timestamp}-${r.SpanId ?? ""}-${i}`}
              style={{
                padding: "4px 0",
                borderBottom: "1px solid #eee",
                display: "flex",
                gap: 8,
              }}
            >
              <span style={{ color: "#999", minWidth: 60 }}>
                {r.SeverityText ?? "—"}
              </span>
              <span style={{ color: "#666", minWidth: 120 }}>
                {r.ServiceName ?? "—"}
              </span>
              <span style={{ flex: 1 }}>{(r.Body ?? "").slice(0, 80)}</span>
            </li>
          ))}
        </ul>
      )}
    </RequestState>
  );
}

// ---------- TraceDetail (two accepted methods) ------------------------------
type TraceDetailProps = RendererProps<"TraceDetail">;
function isTraceSummaries(
  props: TraceDetailProps & { hasData: true }
): props is TraceDetailProps & {
  hasData: true;
  response: SearchResult<TraceSummaryRow> | null;
} {
  return props.element.dataSource?.method === "searchTraceSummariesPage";
}

function TraceDetail(props: TraceDetailProps) {
  if (!props.hasData) return <NoSource name="TraceDetail" />;

  return (
    <RequestState loading={props.loading} error={props.error}>
      {isTraceSummaries(props) ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}>
          {(props.response?.data ?? []).slice(0, 10).map((t) => (
            <li
              key={t.traceId}
              style={{ padding: "4px 0", borderBottom: "1px solid #eee" }}
            >
              <code style={{ color: "#666" }}>{t.traceId.slice(0, 16)}…</code>{" "}
              <strong>{t.rootServiceName}</strong>
              <span style={{ color: "#666" }}>
                {" · "}
                {t.rootSpanName}
                {" · "}
                {Math.round(parseInt(t.durationNs, 10) / 1e6)}ms
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}>
          {((props.response?.data ?? []) as OtelTracesRow[])
            .slice(0, 10)
            .map((s) => (
              <li
                key={s.SpanId}
                style={{ padding: "4px 0", borderBottom: "1px solid #eee" }}
              >
                <code style={{ color: "#666" }}>{s.SpanId}</code>{" "}
                {s.SpanName ?? "—"} · {s.ServiceName ?? "—"} ·{" "}
                {s.Duration ?? "—"}ns
              </li>
            ))}
        </ul>
      )}
    </RequestState>
  );
}

// =============================================================================
// Register all 15 renderers with the catalog. `createRendererFromCatalog`
// enforces at compile time that the registry matches the catalog shape.
// =============================================================================
const ObservabilityRenderer = createRendererFromCatalog(observabilityCatalog, {
  // primitives
  Stack,
  Grid,
  Card,
  Heading,
  Text,
  Badge,
  Divider,
  Empty,
  // data-backed
  MetricStat,
  MetricTimeSeries,
  MetricHistogram,
  MetricTable,
  MetricDiscovery,
  LogTimeline,
  TraceDetail,
});

// =============================================================================
// 5. Kitchen-sink UITree — exercises every component in one layout.
// =============================================================================
const kitchenSinkTree = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      parentKey: "",
      children: [
        "title",
        "intro",
        "divider-primitives",
        "badges",
        "divider-data",
        "grid",
        "divider-empty",
        "empty",
      ],
      props: {
        direction: "vertical" as const,
        gap: "lg" as const,
        align: null,
      },
    },
    title: {
      key: "title",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: {
        text: "Custom observability catalog — reference",
        level: "h2" as const,
      },
    },
    intro: {
      key: "intro",
      type: "Text" as const,
      parentKey: "root",
      children: [],
      props: {
        content:
          "Every component declared in observabilityCatalog is registered and exercised below.",
        variant: "body" as const,
        color: "muted" as const,
      },
    },
    "divider-primitives": {
      key: "divider-primitives",
      type: "Divider" as const,
      parentKey: "root",
      children: [],
      props: { label: "Primitives" },
    },
    badges: {
      key: "badges",
      type: "Stack" as const,
      parentKey: "root",
      children: ["b-default", "b-success", "b-warning", "b-danger", "b-info"],
      props: {
        direction: "horizontal" as const,
        gap: "sm" as const,
        align: "center" as const,
      },
    },
    "b-default": {
      key: "b-default",
      type: "Badge" as const,
      parentKey: "badges",
      children: [],
      props: { text: "default", variant: null },
    },
    "b-success": {
      key: "b-success",
      type: "Badge" as const,
      parentKey: "badges",
      children: [],
      props: { text: "success", variant: "success" as const },
    },
    "b-warning": {
      key: "b-warning",
      type: "Badge" as const,
      parentKey: "badges",
      children: [],
      props: { text: "warning", variant: "warning" as const },
    },
    "b-danger": {
      key: "b-danger",
      type: "Badge" as const,
      parentKey: "badges",
      children: [],
      props: { text: "danger", variant: "danger" as const },
    },
    "b-info": {
      key: "b-info",
      type: "Badge" as const,
      parentKey: "badges",
      children: [],
      props: { text: "info", variant: "info" as const },
    },
    "divider-data": {
      key: "divider-data",
      type: "Divider" as const,
      parentKey: "root",
      children: [],
      props: { label: "Data-backed" },
    },
    grid: {
      key: "grid",
      type: "Grid" as const,
      parentKey: "root",
      children: [
        "c-stat-agg",
        "c-stat-paged",
        "c-timeseries",
        "c-histogram",
        "c-table",
        "c-discovery",
        "c-logs",
        "c-traces",
      ],
      props: { columns: 2, gap: "md" as const },
    },

    "c-stat-agg": {
      key: "c-stat-agg",
      type: "Card" as const,
      parentKey: "grid",
      children: ["stat-agg"],
      props: {
        title: "MetricStat (aggregated)",
        description: "searchAggregatedMetrics",
        padding: null,
      },
    },
    "stat-agg": {
      key: "stat-agg",
      type: "MetricStat" as const,
      parentKey: "c-stat-agg",
      children: [],
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "kopai.ingestion.requests",
          aggregate: "sum" as const,
        },
      },
      props: { label: "Total requests", showSparkline: false },
    },

    "c-stat-paged": {
      key: "c-stat-paged",
      type: "Card" as const,
      parentKey: "grid",
      children: ["stat-paged"],
      props: {
        title: "MetricStat (paged)",
        description: "searchMetricsPage",
        padding: null,
      },
    },
    "stat-paged": {
      key: "stat-paged",
      type: "MetricStat" as const,
      parentKey: "c-stat-paged",
      children: [],
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "kopai.ingestion.requests",
          limit: 20,
        },
      },
      props: { label: "Latest rows", showSparkline: false },
    },

    "c-timeseries": {
      key: "c-timeseries",
      type: "Card" as const,
      parentKey: "grid",
      children: ["timeseries"],
      props: {
        title: "MetricTimeSeries",
        description: "Gauge/Sum over time",
        padding: null,
      },
    },
    timeseries: {
      key: "timeseries",
      type: "MetricTimeSeries" as const,
      parentKey: "c-timeseries",
      children: [],
      dataSource: {
        method: "searchMetricsPage" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "kopai.ingestion.requests",
          limit: 100,
        },
      },
      props: {
        height: 120,
        showBrush: false,
        yAxisLabel: null,
        unit: null,
      },
    },

    "c-histogram": {
      key: "c-histogram",
      type: "Card" as const,
      parentKey: "grid",
      children: ["histogram"],
      props: {
        title: "MetricHistogram",
        description: "bucketed distribution",
        padding: null,
      },
    },
    histogram: {
      key: "histogram",
      type: "MetricHistogram" as const,
      parentKey: "c-histogram",
      children: [],
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Histogram" as const, limit: 50 },
      },
      props: { height: 120, yAxisLabel: null, unit: null },
    },

    "c-table": {
      key: "c-table",
      type: "Card" as const,
      parentKey: "grid",
      children: ["mtable"],
      props: { title: "MetricTable", description: "raw rows", padding: null },
    },
    mtable: {
      key: "mtable",
      type: "MetricTable" as const,
      parentKey: "c-table",
      children: [],
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Sum" as const, limit: 10 },
      },
      props: { maxRows: 5 },
    },

    "c-discovery": {
      key: "c-discovery",
      type: "Card" as const,
      parentKey: "grid",
      children: ["discovery"],
      props: {
        title: "MetricDiscovery",
        description: "discoverMetrics",
        padding: null,
      },
    },
    discovery: {
      key: "discovery",
      type: "MetricDiscovery" as const,
      parentKey: "c-discovery",
      children: [],
      dataSource: { method: "discoverMetrics" as const, params: {} },
      props: {},
    },

    "c-logs": {
      key: "c-logs",
      type: "Card" as const,
      parentKey: "grid",
      children: ["logs"],
      props: {
        title: "LogTimeline",
        description: "searchLogsPage",
        padding: null,
      },
    },
    logs: {
      key: "logs",
      type: "LogTimeline" as const,
      parentKey: "c-logs",
      children: [],
      dataSource: {
        method: "searchLogsPage" as const,
        params: { limit: 20 },
      },
      props: { height: 200 },
    },

    "c-traces": {
      key: "c-traces",
      type: "Card" as const,
      parentKey: "grid",
      children: ["traces"],
      props: {
        title: "TraceDetail (summaries)",
        description: "searchTraceSummariesPage",
        padding: null,
      },
    },
    traces: {
      key: "traces",
      type: "TraceDetail" as const,
      parentKey: "c-traces",
      children: [],
      dataSource: {
        method: "searchTraceSummariesPage" as const,
        params: { limit: 10, sortOrder: "DESC" as const },
      },
      props: { height: 200 },
    },

    "divider-empty": {
      key: "divider-empty",
      type: "Divider" as const,
      parentKey: "root",
      children: [],
      props: { label: "Empty state" },
    },
    empty: {
      key: "empty",
      type: "Empty" as const,
      parentKey: "root",
      children: [],
      props: {
        title: "No data yet",
        description: "Empty is a primitive for intent / next-step UI.",
        action: "https://kopai.app",
        actionLabel: "Learn more",
      },
    },
  },
} satisfies ObservabilityUITree;

// =============================================================================
// 6. Provider-wrapped export
// =============================================================================

// `/kopai-api` is proxied to https://demo.kopai.app by vite.config.ts
// (bypasses CORS since the browser sees same-origin).
const kopaiClient = new KopaiClient({ baseUrl: "/kopai-api" });

export function ExampleObservabilityCatalog() {
  return (
    <KopaiSDKProvider client={kopaiClient}>
      <ObservabilityRenderer tree={kitchenSinkTree} />
    </KopaiSDKProvider>
  );
}
