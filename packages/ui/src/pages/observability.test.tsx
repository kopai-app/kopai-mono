/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import ObservabilityPage from "./observability.js";
import { queryClient } from "../providers/kopai-provider.js";
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
  };
}

const VALID_TREE = {
  root: "root",
  elements: {
    root: {
      key: "root",
      type: "Stack",
      children: ["heading"],
      parentKey: "",
      props: { direction: "vertical", gap: "md", align: null },
    },
    heading: {
      key: "heading",
      type: "Heading",
      children: [],
      parentKey: "root",
      props: { text: "Test Dashboard", level: "h2" },
    },
  },
};

describe("useDashboardTree validation", () => {
  let mockClient: MockClient;
  let originalLocation: string;

  beforeEach(() => {
    mockClient = createMockClient();
    queryClient.clear();
    vi.clearAllMocks();
    originalLocation = window.location.search;
  });

  afterEach(() => {
    window.history.replaceState(
      null,
      "",
      window.location.pathname + originalLocation
    );
  });

  function setURL(params: string) {
    window.history.replaceState(null, "", window.location.pathname + params);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  it("renders DynamicDashboard when API returns a valid uiTree", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ uiTree: VALID_TREE }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    setURL("?tab=metrics&dashboardId=abc");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Test Dashboard")).toBeTruthy();
    });

    expect(screen.queryByText(/invalid layout/i)).toBeNull();
  });

  it("shows error when API returns an invalid uiTree", async () => {
    const invalidTree = {
      root: "x",
      elements: {
        x: { type: "Bogus", key: "x", children: [], parentKey: "" },
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ uiTree: invalidTree }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    setURL("?tab=metrics&dashboardId=def");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(screen.getByText(/invalid layout/i)).toBeTruthy();
    });
  });
});
