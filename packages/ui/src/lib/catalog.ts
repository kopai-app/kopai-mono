import { createCatalog } from "@json-render/core";
import { z } from "zod";

/**
 * Note: OpenAI structured output requires all fields to be required.
 * Use .nullable() instead of .optional() for optional fields.
 */
export const dashboardCatalog = createCatalog({
  name: "dashboard",
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

    // Data Display Components
    Metric: {
      props: z.object({
        label: z.string(),
        valuePath: z.string(),
        format: z.enum(["number", "currency", "percent"]).nullable(),
        trend: z.enum(["up", "down", "neutral"]).nullable(),
        trendValue: z.string().nullable(),
      }),
      description: "Display a single metric with optional trend indicator",
    },

    Chart: {
      props: z.object({
        type: z.enum(["bar", "line", "pie", "area"]),
        dataPath: z.string(),
        title: z.string().nullable(),
        height: z.number().nullable(),
      }),
      description: "Display a chart from array data",
    },

    Table: {
      props: z.object({
        dataPath: z.string(),
        columns: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            format: z.enum(["text", "currency", "date", "badge"]).nullable(),
          })
        ),
      }),
      description: "Display tabular data",
    },

    List: {
      props: z.object({
        dataPath: z.string(),
        emptyMessage: z.string().nullable(),
      }),
      hasChildren: true,
      description: "Render a list from array data",
    },

    // Interactive Components
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(["primary", "secondary", "danger", "ghost"]).nullable(),
        size: z.enum(["sm", "md", "lg"]).nullable(),
        action: z.string(),
        disabled: z.boolean().nullable(),
      }),
      description: "Clickable button with action",
    },

    DatePicker: {
      props: z.object({
        label: z.string().nullable(),
        bindPath: z.string(),
        placeholder: z.string().nullable(),
      }),
      description: "Date picker input",
    },

    // Typography
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h1", "h2", "h3", "h4"]).nullable(),
      }),
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
      description: "Small status badge",
    },

    // Special Components
    Divider: {
      props: z.object({
        label: z.string().nullable(),
      }),
      description: "Visual divider",
    },

    Empty: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        action: z.string().nullable(),
        actionLabel: z.string().nullable(),
      }),
      description: "Empty state placeholder",
    },
  },
  actions: {
    export_report: { description: "Export the current dashboard to PDF" },
    refresh_data: { description: "Refresh all metrics and charts" },
    view_details: { description: "View detailed information" },
    apply_filter: { description: "Apply the current filter settings" },
  },
  validation: "strict",
});

// Export the component list for the AI prompt
export const componentList = dashboardCatalog.componentNames as string[];
