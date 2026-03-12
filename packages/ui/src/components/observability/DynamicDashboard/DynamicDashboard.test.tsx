/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { DynamicDashboard, type UITree } from "./index.js";
import { queryClient } from "../../../providers/kopai-provider.js";
import type { KopaiClient } from "@kopai/sdk";

type MockClient = {
  [K in keyof KopaiClient]: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockClient {
  return {
    searchTracesPage: vi.fn().mockResolvedValue({ data: [] }),
    searchLogsPage: vi.fn().mockResolvedValue({ data: [] }),
    searchMetricsPage: vi.fn().mockResolvedValue({ data: [] }),
    getTrace: vi.fn().mockResolvedValue({ data: [] }),
    discoverMetrics: vi.fn().mockResolvedValue({ data: [] }),
    searchTraces: vi.fn().mockResolvedValue({ data: [] }),
    searchLogs: vi.fn().mockResolvedValue({ data: [] }),
    searchMetrics: vi.fn().mockResolvedValue({ data: [] }),
    createDashboard: vi.fn().mockResolvedValue({}),
    getDashboard: vi.fn().mockResolvedValue({}),
    searchDashboardsPage: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null }),
    searchDashboards: vi.fn().mockReturnValue((async function* () {})()),
    getServices: vi.fn().mockResolvedValue({ services: [] }),
    getOperations: vi.fn().mockResolvedValue({ operations: [] }),
    searchTraceSummariesPage: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null }),
  };
}

/**
 * UITree containing every component from the observability catalog.
 *
 * Structure:
 *   Stack (root)
 *   ├── Heading
 *   ├── Text
 *   ├── Badge
 *   ├── Divider
 *   ├── Empty
 *   ├── Card
 *   │   └── Grid
 *   │       ├── MetricTimeSeries  (dataSource: searchMetricsPage)
 *   │       ├── MetricHistogram   (dataSource: searchMetricsPage)
 *   │       ├── MetricStat        (dataSource: searchMetricsPage)
 *   │       └── MetricTable       (dataSource: searchMetricsPage)
 *   ├── LogTimeline               (dataSource: searchLogsPage)
 *   ├── TraceDetail               (dataSource: searchTracesPage)
 *   └── MetricDiscovery           (dataSource: discoverMetrics)
 */
const ALL_ELEMENTS_TREE = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack" as const,
      children: [
        "heading",
        "text",
        "badge",
        "divider",
        "empty",
        "card",
        "log-timeline",
        "trace-detail",
        "metric-discovery",
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
      props: { text: "Dashboard", level: "h1" as const },
    },
    text: {
      key: "text",
      type: "Text" as const,
      children: [],
      parentKey: "root",
      props: { content: "Overview", variant: null, color: null },
    },
    badge: {
      key: "badge",
      type: "Badge" as const,
      children: [],
      parentKey: "root",
      props: { text: "Active", variant: "success" as const },
    },
    divider: {
      key: "divider",
      type: "Divider" as const,
      children: [],
      parentKey: "root",
      props: { label: null },
    },
    empty: {
      key: "empty",
      type: "Empty" as const,
      children: [],
      parentKey: "root",
      props: {
        title: "No data",
        description: null,
        action: null,
        actionLabel: null,
      },
    },
    card: {
      key: "card",
      type: "Card" as const,
      children: ["grid"],
      parentKey: "root",
      props: { title: "Metrics", description: null, padding: "md" as const },
    },
    grid: {
      key: "grid",
      type: "Grid" as const,
      children: [
        "metric-time-series",
        "metric-histogram",
        "metric-stat",
        "metric-table",
      ],
      parentKey: "card",
      props: { columns: 2, gap: "md" as const },
    },
    "metric-time-series": {
      key: "metric-time-series",
      type: "MetricTimeSeries" as const,
      children: [],
      parentKey: "grid",
      props: { height: 300, showBrush: null },
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Gauge" as const },
      },
    },
    "metric-histogram": {
      key: "metric-histogram",
      type: "MetricHistogram" as const,
      children: [],
      parentKey: "grid",
      props: { height: 300 },
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Gauge" as const },
      },
    },
    "metric-stat": {
      key: "metric-stat",
      type: "MetricStat" as const,
      children: [],
      parentKey: "grid",
      props: { label: "Requests", showSparkline: true },
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Gauge" as const },
      },
    },
    "metric-table": {
      key: "metric-table",
      type: "MetricTable" as const,
      children: [],
      parentKey: "grid",
      props: { maxRows: 50 },
      dataSource: {
        method: "searchMetricsPage" as const,
        params: { metricType: "Gauge" as const },
      },
    },
    "log-timeline": {
      key: "log-timeline",
      type: "LogTimeline" as const,
      children: [],
      parentKey: "root",
      props: { height: 400 },
      dataSource: { method: "searchLogsPage" as const, params: {} },
    },
    "trace-detail": {
      key: "trace-detail",
      type: "TraceDetail" as const,
      children: [],
      parentKey: "root",
      props: { height: 400 },
      dataSource: { method: "searchTracesPage" as const, params: {} },
    },
    "metric-discovery": {
      key: "metric-discovery",
      type: "MetricDiscovery" as const,
      children: [],
      parentKey: "root",
      props: {},
      dataSource: { method: "discoverMetrics" as const, params: {} },
    },
  },
} satisfies UITree;

describe("DynamicDashboard", () => {
  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("renders a UITree containing all catalog components", async () => {
    const { container } = render(
      createElement(DynamicDashboard, {
        kopaiClient: mockClient as unknown as KopaiClient,
        uiTree: ALL_ELEMENTS_TREE,
      })
    );

    // Wait for async data fetches to settle
    await waitFor(() => {
      expect(mockClient.searchMetricsPage).toHaveBeenCalled();
      expect(mockClient.searchLogsPage).toHaveBeenCalled();
      expect(mockClient.searchTracesPage).toHaveBeenCalled();
      expect(mockClient.discoverMetrics).toHaveBeenCalled();
    });

    // Verify static content rendered
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("No data");
  });
});
