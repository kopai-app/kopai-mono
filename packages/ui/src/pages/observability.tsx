import { observabilityCatalog } from "../lib/observability-catalog.js";
import { createRendererFromCatalog } from "../lib/renderer.js";
import { KopaiSDKProvider } from "../providers/kopai-provider.js";
import { KopaiClient } from "@kopai/sdk";
import { Card } from "../components/card.js";
import { Grid } from "../components/grid.js";
import { Stack } from "../components/stack.js";
import { Heading } from "../components/heading.js";
import { Text } from "../components/text.js";
import { Badge } from "../components/badge.js";
import { Divider } from "../components/divider.js";
import { Empty } from "../components/empty.js";
import { OtelMetric } from "../components/otel-metric.js";
import { OtelChart } from "../components/otel-chart.js";
import { OtelTable } from "../components/otel-table.js";
import { OtelList } from "../components/otel-list.js";

const ObservabilityRenderer = createRendererFromCatalog(observabilityCatalog, {
  Card,
  Grid,
  Stack,
  Heading,
  Text,
  Badge,
  Divider,
  Empty,
  Metric: OtelMetric,
  Chart: OtelChart,
  Table: OtelTable,
  List: OtelList,
});

const observabilityTree = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: [
        "heading",
        "metrics-grid",
        "traces-card",
        "logs-card",
        "metrics-card",
      ],
      parentKey: "",
      props: { direction: "vertical", gap: "lg", align: null },
    },
    heading: {
      key: "heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "Observability Dashboard", level: "h1" },
    },

    // Summary Metrics Grid
    "metrics-grid": {
      key: "metrics-grid",
      type: "Grid" as const,
      children: ["trace-count-card", "log-count-card", "metric-count-card"],
      parentKey: "root",
      props: { columns: 3, gap: "md" },
    },
    "trace-count-card": {
      key: "trace-count-card",
      type: "Card" as const,
      children: ["trace-count-metric"],
      parentKey: "metrics-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "trace-count-metric": {
      key: "trace-count-metric",
      type: "Metric" as const,
      children: [],
      parentKey: "trace-count-card",
      dataSource: {
        method: "searchTracesPage" as const,
        params: { limit: 100 },
      },
      props: {
        label: "Total Traces",
        valueKey: "data.length",
        format: "count",
      },
    },
    "log-count-card": {
      key: "log-count-card",
      type: "Card" as const,
      children: ["log-count-metric"],
      parentKey: "metrics-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "log-count-metric": {
      key: "log-count-metric",
      type: "Metric" as const,
      children: [],
      parentKey: "log-count-card",
      dataSource: {
        method: "searchLogsPage" as const,
        params: { limit: 100 },
      },
      props: { label: "Total Logs", valueKey: "data.length", format: "count" },
    },
    "metric-count-card": {
      key: "metric-count-card",
      type: "Card" as const,
      children: ["metric-count-metric"],
      parentKey: "metrics-grid",
      props: { title: null, description: null, padding: "md" },
    },
    "metric-count-metric": {
      key: "metric-count-metric",
      type: "Metric" as const,
      children: [],
      parentKey: "metric-count-card",
      dataSource: {
        method: "discoverMetrics" as const,
        params: {},
      },
      props: {
        label: "Total Metrics",
        valueKey: "data.length",
        format: "count",
      },
    },

    // Traces Table
    "traces-card": {
      key: "traces-card",
      type: "Card" as const,
      children: ["traces-table"],
      parentKey: "root",
      props: { title: "Recent Traces", description: null, padding: "md" },
    },
    "traces-table": {
      key: "traces-table",
      type: "Table" as const,
      children: [],
      parentKey: "traces-card",
      dataSource: {
        method: "searchTracesPage" as const,
        params: { limit: 10 },
      },
      props: {
        title: null,
        columns: [
          { key: "traceId", label: "Trace ID", format: "truncate" },
          { key: "rootSpan.name", label: "Name", format: "text" },
          { key: "rootSpan.status.code", label: "Status", format: "badge" },
          {
            key: "rootSpan.startTimeUnixNano",
            label: "Start Time",
            format: "timestamp",
          },
          {
            key: "rootSpan.endTimeUnixNano",
            label: "Duration",
            format: "duration",
          },
        ],
      },
    },

    // Logs Table
    "logs-card": {
      key: "logs-card",
      type: "Card" as const,
      children: ["logs-table"],
      parentKey: "root",
      props: { title: "Recent Logs", description: null, padding: "md" },
    },
    "logs-table": {
      key: "logs-table",
      type: "Table" as const,
      children: [],
      parentKey: "logs-card",
      dataSource: {
        method: "searchLogsPage" as const,
        params: { limit: 10 },
      },
      props: {
        title: null,
        columns: [
          { key: "timeUnixNano", label: "Time", format: "timestamp" },
          { key: "severityText", label: "Severity", format: "badge" },
          { key: "body.stringValue", label: "Message", format: "truncate" },
          { key: "traceId", label: "Trace ID", format: "truncate" },
        ],
      },
    },

    // Metrics Table
    "metrics-card": {
      key: "metrics-card",
      type: "Card" as const,
      children: ["metrics-table"],
      parentKey: "root",
      props: { title: "Recent Metrics", description: null, padding: "md" },
    },
    "metrics-table": {
      key: "metrics-table",
      type: "Table" as const,
      children: [],
      parentKey: "metrics-card",
      dataSource: {
        method: "discoverMetrics" as const,
        params: {},
      },
      props: {
        title: null,
        columns: [
          { key: "name", label: "Name", format: "text" },
          { key: "description", label: "Description", format: "truncate" },
          { key: "unit", label: "Unit", format: "text" },
        ],
      },
    },
  },
};

// Create SDK client pointing to local server
const client = new KopaiClient({ baseUrl: "http://localhost:8000/signals" });

export default function ObservabilityPage() {
  return (
    <KopaiSDKProvider client={client}>
      <div
        style={{
          minHeight: "100vh",
          background: "var(--background)",
          color: "var(--foreground)",
          padding: 24,
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <ObservabilityRenderer tree={observabilityTree} />
      </div>
    </KopaiSDKProvider>
  );
}

export { observabilityTree, ObservabilityRenderer };
