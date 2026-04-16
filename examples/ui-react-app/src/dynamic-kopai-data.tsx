import { KopaiClient } from "@kopai/sdk";
import {
  KopaiSDKProvider,
  createCatalog,
  createRendererFromCatalog,
} from "@kopai/ui";
import { z } from "zod";

const catalog = createCatalog({
  name: "hello world catalog",
  components: {
    PlainText: {
      description: "displays static textual content",
      hasChildren: false,
      props: z.object({
        content: z.string(),
      }),
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
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h1", "h2", "h3", "h4"]).nullable(),
      }),
      hasChildren: false,
      description: "Section heading",
    },
    Card: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        padding: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      hasChildren: true,
      description: "A card container with optional title",
    },
    MetricStat: {
      props: z.object({
        label: z.string().nullable(),
        showSparkline: z.boolean().nullable(),
      }),
      hasChildren: false,
      description: "Single metric KPI card backed by searchAggregatedMetrics",
      acceptsDataFrom: ["searchAggregatedMetrics"] as const,
    },
  },
});

const gaps: Record<string, string> = { sm: "8px", md: "16px", lg: "24px" };
const paddings: Record<string, string> = {
  sm: "8px",
  md: "16px",
  lg: "24px",
};
const alignments: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

const ExampleUiTreeRenderer = createRendererFromCatalog(catalog, {
  PlainText({ element }) {
    return <p style={{ margin: 0 }}>{element.props.content}</p>;
  },

  Stack({ element, children }) {
    const { direction, gap, align } = element.props;
    return (
      <div
        style={{
          display: "flex",
          flexDirection: direction === "horizontal" ? "row" : "column",
          gap: gaps[gap || "md"],
          alignItems: alignments[align || "stretch"],
        }}
      >
        {children}
      </div>
    );
  },

  Heading({ element }) {
    const { text, level } = element.props;
    const Tag = level ?? "h2";
    return <Tag style={{ margin: 0 }}>{text}</Tag>;
  },

  Card({ element, children }) {
    const { title, description, padding } = element.props;
    return (
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "6px",
          padding: paddings[padding || "md"],
        }}
      >
        {(title || description) && (
          <div style={{ marginBottom: "8px" }}>
            {title && (
              <div style={{ fontWeight: 600, fontSize: "14px" }}>{title}</div>
            )}
            {description && (
              <div style={{ color: "#666", fontSize: "12px" }}>
                {description}
              </div>
            )}
          </div>
        )}
        {children}
      </div>
    );
  },

  MetricStat(props) {
    const { element } = props;
    const { label } = element.props;

    if (!props.hasData) {
      return <div>No data source</div>;
    }

    if (props.loading) {
      return <div>Loading…</div>;
    }

    if (props.error) {
      return (
        <div style={{ color: "#ef4444" }}>Error: {props.error.message}</div>
      );
    }

    const row = props.response?.data?.[0];
    const value = row?.value ?? "—";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {label && (
          <span style={{ color: "#666", fontSize: "12px" }}>{label}</span>
        )}
        <span style={{ fontSize: "24px", fontWeight: 600 }}>
          {String(value)}
        </span>
      </div>
    );
  },
});

type UiTree = z.infer<typeof catalog.uiTreeSchema>;

const metricsUiTree = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: ["ingestion-heading", "card-requests"],
      parentKey: "",
      props: {
        direction: "vertical" as const,
        gap: "md" as const,
        align: null,
      },
    },
    "ingestion-heading": {
      key: "ingestion-heading",
      type: "Heading" as const,
      children: [],
      parentKey: "root",
      props: { text: "OTEL Ingestion", level: "h3" as const },
    },
    "card-requests": {
      key: "card-requests",
      type: "Card" as const,
      children: ["stat-requests"],
      parentKey: "root",
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
  },
} satisfies UiTree;

// `/kopai-api` is proxied to https://demo.kopai.app by vite.config.ts
// (bypasses CORS since the browser sees same-origin).
const kopaiClient = new KopaiClient({ baseUrl: "/kopai-api" });

export function ExampleWithDynamicData() {
  return (
    <KopaiSDKProvider client={kopaiClient}>
      <ExampleUiTreeRenderer tree={metricsUiTree} />
    </KopaiSDKProvider>
  );
}
