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

    // DataDisplay Components (observability-specific)
    Table: {
      props: z.object({
        columns: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            format: z
              .enum([
                "text",
                "timestamp",
                "duration",
                "truncate",
                "badge",
                "json",
              ])
              .nullable(),
          })
        ),
        title: z.string().nullable(),
      }),
      hasChildren: false,
      description: "Table with data from dataSource",
    },

    Metric: {
      props: z.object({
        label: z.string(),
        valueKey: z.string(),
        format: z.enum(["number", "count", "duration"]).nullable(),
      }),
      hasChildren: false,
      description: "Single metric from dataSource",
    },

    Chart: {
      props: z.object({
        type: z.enum(["bar", "line", "area"]),
        title: z.string().nullable(),
        xKey: z.string(),
        yKey: z.string(),
        height: z.number().nullable(),
      }),
      hasChildren: false,
      description: "Chart from dataSource array",
    },

    List: {
      props: z.object({
        emptyMessage: z.string().nullable(),
      }),
      hasChildren: true,
      description: "Iterate dataSource array",
    },
  },
});
