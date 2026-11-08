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
import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KopaiSDKProvider, type KopaiClient } from "@kopai/ui-core";
import type { kopaiQuery } from "@kopai/core";
import {
  ServiceMap,
  ServiceMapErrorBoundary,
  ServiceMapSourceProvider,
  resolveServiceMapSource,
} from "./ServiceMapLazy.js";
import { toServiceMapClient } from "./session/client-adapter.js";
import { __resetSessionsForTests } from "./session/session-manager.js";
import { pairRows, seedNodeRows } from "./engine/test-utils.js";
import type { ServiceMapClient } from "./engine/types.js";
import { installReactFlowJsdom } from "./test-utils/react-flow-jsdom.js";

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

/**
 * A dashboard-shaped client (ui-core's `KopaiClient`): no
 * `queryTracesAggregate`, so the map's seed aggregates go through `query`.
 * checkout calls cart one minute ago; both are known services.
 */
function dashboardClient() {
  const now = Date.now();
  const client = {
    getServices: vi.fn(async () => ({ services: ["cart", "checkout"] })),
    query: vi.fn(async (q: kopaiQuery.TraceAggregateQuery) => ({
      data: q.filters?.length ? [] : seedNodeRows({ checkout: 10, cart: 10 }),
    })),
    searchTracesPage: vi.fn(async (f: { sortOrder?: string }) => ({
      data:
        f.sortOrder === "ASC"
          ? []
          : pairRows("a", "checkout", "cart", now - 60_000),
      nextCursor: null,
    })),
    getTrace: vi.fn(async () => []),
  };
  return client;
}

function provider(client: object) {
  return ({ children }: { children: ReactNode }) =>
    createElement(KopaiSDKProvider, {
      client: client as unknown as KopaiClient,
      children,
    });
}

describe("resolveServiceMapSource", () => {
  const sdkLike = {
    searchTracesPage: vi.fn(),
    queryTracesAggregate: vi.fn(),
    getTrace: vi.fn(),
    getServices: vi.fn(),
  } as unknown as ServiceMapClient;
  const ctx = dashboardClient() as unknown as KopaiClient;

  it("prefers an explicit client and keeps an SDK client as it is", () => {
    expect(resolveServiceMapSource({ client: sdkLike }, ctx)).toEqual({
      client: sdkLike,
    });
  });

  it("uses the worker when baseUrl, headers or token are given", () => {
    expect(
      resolveServiceMapSource({ baseUrl: "http://x", token: "t" }, ctx)
    ).toEqual({ baseUrl: "http://x", headers: undefined, token: "t" });
    expect(resolveServiceMapSource({ token: "t" }, ctx)).toEqual({
      baseUrl: "",
      headers: undefined,
      token: "t",
    });
  });

  it("falls back to the provider's client, then to the page origin", () => {
    expect(resolveServiceMapSource({}, ctx).client).toBe(
      toServiceMapClient(ctx)
    );
    expect(resolveServiceMapSource({}, null)).toEqual({
      baseUrl: "",
      headers: undefined,
      token: undefined,
    });
  });
});

describe("resolveServiceMapSource with a ServiceMapSourceProvider source", () => {
  const ctx = dashboardClient() as unknown as KopaiClient;

  it("beats the KopaiSDKProvider client: a worker source sends tiles to the worker", () => {
    expect(resolveServiceMapSource({}, ctx, { baseUrl: "" })).toEqual({
      baseUrl: "",
      headers: undefined,
      token: undefined,
    });
    const other = dashboardClient() as unknown as KopaiClient;
    expect(resolveServiceMapSource({}, ctx, { client: other }).client).toBe(
      toServiceMapClient(other)
    );
  });

  it("never beats the map's own client, baseUrl, headers or token", () => {
    const own = dashboardClient() as unknown as KopaiClient;
    const source = { baseUrl: "http://shared", token: "s" };
    expect(resolveServiceMapSource({ client: own }, ctx, source).client).toBe(
      toServiceMapClient(own)
    );
    expect(resolveServiceMapSource({ token: "t" }, ctx, source)).toEqual({
      baseUrl: "",
      headers: undefined,
      token: "t",
    });
  });
});

describe("toServiceMapClient", () => {
  it("adapts a dashboard client once and sends aggregates through query", async () => {
    const c = dashboardClient();
    const a = toServiceMapClient(c as unknown as KopaiClient);
    expect(toServiceMapClient(c as unknown as KopaiClient)).toBe(a);
    const q = {
      signal: "traces",
      mode: "aggregate",
    } as unknown as kopaiQuery.TraceAggregateQuery;
    const signal = new AbortController().signal;
    await a.queryTracesAggregate(q, { signal });
    expect(c.query).toHaveBeenCalledWith(q, { signal });
    await a.getServices({ signal });
    expect(c.getServices).toHaveBeenCalledWith({ signal });
  });
});

describe("<ServiceMap /> standalone", () => {
  it("reads from the KopaiSDKProvider client by default", async () => {
    const client = dashboardClient();
    render(createElement(ServiceMap, { height: 400 }), {
      wrapper: provider(client),
    });
    // The lazy chunk's fallback first.
    expect(screen.getByText("Loading service map…")).toBeTruthy();
    expect(
      await screen.findByTestId("sm-node-checkout", {}, WAIT)
    ).toBeTruthy();
    expect(screen.getByTestId("sm-node-cart")).toBeTruthy();
    expect(client.getServices).toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "traces", mode: "aggregate" }),
      expect.anything()
    );
    await waitFor(
      () =>
        expect(
          document.querySelector('.react-flow__edge[data-id="checkout->cart"]')
        ).not.toBeNull(),
      WAIT
    );
    const canvas = document.querySelector<HTMLElement>(".sm-canvas")!;
    expect(canvas.style.height).toBe("400px");
    expect(screen.getByRole("region", { name: "Service map" })).toBeTruthy();
  });

  it("reads from the ServiceMapSourceProvider source instead of the KopaiSDKProvider client", async () => {
    const dashboard = dashboardClient();
    const shared = dashboardClient();
    render(
      createElement(ServiceMapSourceProvider, {
        source: { client: shared as unknown as KopaiClient },
        children: createElement(ServiceMap, { height: 400 }),
      }),
      { wrapper: provider(dashboard) }
    );
    expect(
      await screen.findByTestId("sm-node-checkout", {}, WAIT)
    ).toBeTruthy();
    expect(shared.getServices).toHaveBeenCalled();
    expect(dashboard.getServices).not.toHaveBeenCalled();
  });

  it("calls onServiceClick with the service name", async () => {
    const onServiceClick = vi.fn();
    const client = dashboardClient();
    render(
      createElement(ServiceMap, {
        client: client as unknown as KopaiClient,
        onServiceClick,
      })
    );
    const node = await screen.findByTestId("sm-node-checkout", {}, WAIT);
    node.click();
    expect(onServiceClick).toHaveBeenCalledWith("checkout");
  });

  it("lets two maps share one session without clashing ids", async () => {
    const client = dashboardClient();
    const { container } = render(
      createElement(
        "div",
        null,
        createElement(ServiceMap, { height: 300 }),
        createElement(ServiceMap, { height: 500 })
      ),
      { wrapper: provider(client) }
    );
    await waitFor(
      () => expect(screen.getAllByTestId("sm-node-checkout")).toHaveLength(2),
      WAIT
    );
    // One session: one seed, however many maps show it.
    expect(client.getServices).toHaveBeenCalledTimes(1);
    const flows = [...container.querySelectorAll(".react-flow")];
    expect(flows).toHaveLength(2);
    const ids = flows.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith("sm-"))).toBe(true);
    const heights = [
      ...container.querySelectorAll<HTMLElement>(".sm-canvas"),
    ].map((c) => c.style.height);
    expect(heights).toEqual(["300px", "500px"]);
  });
});

describe("ServiceMapErrorBoundary", () => {
  it("keeps a failed load inside the map area and retries on demand", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const onRetry = vi.fn(() => {
      fail = false;
    });
    function Child() {
      if (fail) throw new Error("chunk load failed");
      return createElement("p", null, "map loaded");
    }
    render(
      createElement(
        "div",
        null,
        createElement("p", null, "sibling tile"),
        createElement(
          ServiceMapErrorBoundary,
          { onRetry },
          createElement(Child)
        )
      )
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Service map failed to load"
    );
    // The rest of the page stays mounted.
    expect(screen.getByText("sibling tile")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("map loaded")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
