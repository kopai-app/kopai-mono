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
    },

    TraceDetail: {
      props: z.object({ height: z.number().nullable() }),
      hasChildren: false,
      description:
        "Trace detail with traceId input field and waterfall timeline",
    },

    MetricTimeSeries: {
      props: z.object({
        height: z.number().nullable(),
        showBrush: z.boolean().nullable(),
      }),
      hasChildren: false,
      description: "Time series line chart for Gauge/Sum metrics",
    },

    MetricHistogram: {
      props: z.object({ height: z.number().nullable() }),
      hasChildren: false,
      description: "Histogram bar chart for distribution metrics",
    },

    MetricStat: {
      props: z.object({
        label: z.string().nullable(),
        showSparkline: z.boolean().nullable(),
      }),
      hasChildren: false,
      description:
        "Single metric KPI card with sparkline and threshold coloring",
    },

    MetricTable: {
      props: z.object({ maxRows: z.number().nullable() }),
      hasChildren: false,
      description: "Tabular display of metric data points",
    },
  },
});
