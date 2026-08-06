import { createCatalog } from "./component-catalog.js";
import { z } from "zod";

export const observabilityCatalog = createCatalog({
  name: "observability",
  components: {
    // Layout Components
    Card: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        padding: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      hasChildren: true,
      description: "A card container with optional title",
    },

    Grid: {
      props: z.object({
        columns: z.number().min(1).max(4).nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      hasChildren: true,
      description: "Grid layout with configurable columns",
    },

    Stack: {
      props: z.object({
        direction: z.enum(["horizontal", "vertical"]).nullable(),
        gap: z.enum(["sm", "md", "lg"]).nullable(),
        align: z.enum(["start", "center", "end", "stretch"]).nullable(),
      }),
      hasChildren: true,
      description: "Flex stack for horizontal or vertical layouts",
    },

    // Typography
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h1", "h2", "h3", "h4"]).nullable(),
      }),
      hasChildren: false,
      description: "Section heading",
    },

    Text: {
      props: z.object({
        content: z.string(),
        variant: z.enum(["body", "caption", "label"]).nullable(),
        color: z
          .enum(["default", "muted", "success", "warning", "danger"])
          .nullable(),
      }),
      hasChildren: false,
      description: "Text paragraph",
    },

    // Status Components
    Badge: {
      props: z.object({
        text: z.string(),
        variant: z
          .enum(["default", "success", "warning", "danger", "info"])
          .nullable(),
      }),
      hasChildren: false,
      description: "Small status badge",
    },

    Divider: {
      props: z.object({
        label: z.string().nullable(),
      }),
      hasChildren: false,
      description: "Visual divider",
    },

    Empty: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        action: z.string().nullable(),
        actionLabel: z.string().nullable(),
      }),
      hasChildren: false,
      description: "Empty state placeholder",
    },

    // Observability Components
    LogTimeline: {
      props: z.object({ height: z.number().nullable() }),
      hasChildren: false,
      description:
        "Log timeline with virtual scroll, severity filtering, detail pane",
      acceptsDataFrom: ["searchLogsPage", "query"] as const,
    },

    TraceDetail: {
      props: z.object({ height: z.number().nullable() }),
      hasChildren: false,
      description:
        "Trace detail with traceId input field and waterfall timeline",
      acceptsDataFrom: [
        "searchTracesPage",
        "searchTraceSummariesPage",
        "query",
      ] as const,
    },

    MetricTimeSeries: {
      props: z.object({
        height: z.number().nullable(),
        showBrush: z.boolean().nullable(),
        yAxisLabel: z.string().nullable(),
        unit: z.string().nullable(),
      }),
      hasChildren: false,
      description: "Time series line chart for Gauge/Sum metrics",
      acceptsDataFrom: ["searchMetricsPage", "query"] as const,
    },

    MetricHistogram: {
      props: z.object({
        height: z.number().nullable(),
        yAxisLabel: z.string().nullable(),
        unit: z.string().nullable(),
      }),
      hasChildren: false,
      description: "Histogram bar chart for distribution metrics",
      acceptsDataFrom: ["searchMetricsPage", "query"] as const,
    },

    MetricStat: {
      props: z.object({
        label: z.string().nullable(),
        showSparkline: z.boolean().nullable(),
      }),
      hasChildren: false,
      description:
        "Single metric KPI card with sparkline and threshold coloring",
      acceptsDataFrom: [
        "searchMetricsPage",
        "searchAggregatedMetrics",
        "query",
      ] as const,
    },

    MetricTable: {
      props: z.object({ maxRows: z.number().nullable() }),
      hasChildren: false,
      description: "Tabular display of metric data points",
      acceptsDataFrom: ["searchMetricsPage", "query"] as const,
    },

    AggregateTable: {
      props: z.object({
        maxRows: z.number().int().positive().nullable(),
        units: z.record(z.string(), z.string()).nullable(),
        labels: z.record(z.string(), z.string()).nullable(),
      }),
      hasChildren: false,
      description:
        "Tabular display of aggregate query results — dimension and measure " +
        "columns from a `query` dataSource in aggregate mode (e.g. top spans " +
        "by AVG(Duration), request counts grouped by StatusCode). Columns are " +
        "derived from the result rows, so it renders any signal's aggregate output. " +
        "`units` maps a column name to its OTel unit so the cell renders in " +
        'human terms — e.g. {"avg_duration_ns": "ns"} shows 23070000 as ' +
        '"23.07 ms". Understood units: ns/us/ms/s (duration ladder) and By ' +
        "(binary byte ladder); unmapped columns keep generic SI scaling. " +
        "Headers are humanised automatically — snake_case, dotted and " +
        'PascalCase names become Title Case ("span_count" -> "Span Count"), ' +
        "and a trailing unit token is dropped when that column is unit-annotated " +
        '("avg_duration_ns" + "ns" -> "Avg Duration") since the unit already ' +
        "shows in the cell. `labels` overrides the header for any column, which " +
        "is the escape hatch when humanising mangles a name — e.g. " +
        '{"SpanAttributes.http.route": "Route"}.',
      acceptsDataFrom: ["query"] as const,
    },

    MetricDiscovery: {
      props: z.object({}),
      hasChildren: false,
      description:
        "Table of discovered metric names, types, units and descriptions",
      acceptsDataFrom: ["discoverMetrics"] as const,
    },
  },
});
