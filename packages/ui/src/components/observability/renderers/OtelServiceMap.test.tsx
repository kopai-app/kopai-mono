/**
 * @vitest-environment jsdom
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { observabilityCatalog, type KopaiClient } from "@kopai/ui-core";
import type { kopaiQuery } from "@kopai/core";
import { DynamicDashboard, type UITree } from "../DynamicDashboard/index.js";
import { __resetSessionsForTests } from "../ServiceMap/session/session-manager.js";
import { pairRows, seedNodeRows } from "../ServiceMap/engine/test-utils.js";
import { installReactFlowJsdom } from "../ServiceMap/test-utils/react-flow-jsdom.js";
import {
  DASHBOARD_MAP_HEIGHT,
  DASHBOARD_MAP_MIN_HEIGHT,
} from "./OtelServiceMap.js";

/** The lazy chunk loads and the engine throttles snapshots (750 ms). */
const WAIT = { timeout: 5000 };

let restore: () => void;
beforeAll(() => {
  restore = installReactFlowJsdom();
});
afterAll(() => restore());
afterEach(() => {
  __resetSessionsForTests();
  vi.restoreAllMocks();
});

/** An SDK-shaped client: api-gateway calls checkout one minute ago. */
function sdkClient() {
  const now = Date.now();
  return {
    getServices: vi.fn(async () => ({
      services: ["api-gateway", "checkout"],
    })),
    queryTracesAggregate: vi.fn(async (q: kopaiQuery.TraceAggregateQuery) => ({
      data: q.filters?.length
        ? []
        : seedNodeRows({ "api-gateway": 20, checkout: 10 }),
    })),
    query: vi.fn(),
    searchTracesPage: vi.fn(async (f: { sortOrder?: string }) => ({
      data:
        f.sortOrder === "ASC"
          ? []
          : pairRows("a", "api-gateway", "checkout", now - 60_000),
      nextCursor: null,
    })),
    getTrace: vi.fn(async () => []),
    searchLogsPage: vi.fn(),
    searchMetricsPage: vi.fn(),
    searchAggregatedMetrics: vi.fn(),
    discoverMetrics: vi.fn(),
    getDashboard: vi.fn(),
    getOperations: vi.fn(),
    searchTraceSummariesPage: vi.fn(),
  };
}

function tree(height: number | null): UITree {
  return {
    root: "stack-1",
    elements: {
      "stack-1": {
        key: "stack-1",
        type: "Stack",
        props: { direction: "vertical", gap: "md", align: null },
        children: ["card-1"],
        parentKey: "",
      },
      "card-1": {
        key: "card-1",
        type: "Card",
        props: { title: "Service map", description: null, padding: null },
        children: ["map-1"],
        parentKey: "stack-1",
      },
      "map-1": {
        key: "map-1",
        type: "ServiceMap",
        props: { height },
        children: [],
        parentKey: "card-1",
      },
    },
  };
}

function renderDashboard(client: object, uiTree: UITree) {
  // The tree a dashboard stores must pass the catalog's schema.
  expect(observabilityCatalog.uiTreeSchema.safeParse(uiTree).success).toBe(
    true
  );
  return render(
    createElement(DynamicDashboard, {
      kopaiClient: client as unknown as KopaiClient,
      uiTree,
    })
  );
}

describe("ServiceMap dashboard tile", () => {
  it("renders the live map inside the card with the dashboard's client", async () => {
    const client = sdkClient();
    const { container } = renderDashboard(client, tree(null));
    expect(container.textContent).toContain("Service map");
    expect(
      await screen.findByTestId("sm-node-api-gateway", {}, WAIT)
    ).toBeTruthy();
    expect(screen.getByTestId("sm-node-checkout")).toBeTruthy();
    await waitFor(
      () =>
        expect(
          container.querySelector(
            '.react-flow__edge[data-id="api-gateway->checkout"]'
          )
        ).not.toBeNull(),
      WAIT
    );
    expect(client.getServices).toHaveBeenCalled();
    expect(client.queryTracesAggregate).toHaveBeenCalled();
    // No dataSource: the renderer never asked the client for tile data.
    expect(client.query).not.toHaveBeenCalled();
    const canvas = container.querySelector<HTMLElement>(".sm-canvas")!;
    expect(canvas.style.height).toBe(`${DASHBOARD_MAP_HEIGHT}px`);
    // Not clickable in a dashboard (no onServiceClick).
    expect(
      screen
        .getByTestId("sm-node-checkout")
        .classList.contains("cursor-pointer")
    ).toBe(false);
  });

  it("uses the tree's height, raised to the minimum", async () => {
    const { container, unmount } = renderDashboard(sdkClient(), tree(360));
    await screen.findByTestId("sm-node-checkout", {}, WAIT);
    expect(
      container.querySelector<HTMLElement>(".sm-canvas")!.style.height
    ).toBe("360px");
    unmount();
    __resetSessionsForTests();

    const small = renderDashboard(sdkClient(), tree(50));
    await screen.findByTestId("sm-node-checkout", {}, WAIT);
    expect(
      small.container.querySelector<HTMLElement>(".sm-canvas")!.style.height
    ).toBe(`${DASHBOARD_MAP_MIN_HEIGHT}px`);
  });
});
