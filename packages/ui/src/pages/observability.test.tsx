/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import ObservabilityPage from "./observability.js";
import { queryClient } from "@kopai/ui-core";
import type { KopaiClient } from "@kopai/sdk";
import { installReactFlowJsdom } from "../components/observability/ServiceMap/test-utils/react-flow-jsdom.js";
import {
  __resetSessionsForTests,
  peekSnapshot,
} from "../components/observability/ServiceMap/session/session-manager.js";
import {
  pairRows,
  seedNodeRows,
} from "../components/observability/ServiceMap/engine/test-utils.js";

type MockClient = {
  [K in keyof KopaiClient]: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockClient {
  return {
    searchTracesPage: vi.fn().mockResolvedValue({ data: [] }),
    searchLogsPage: vi.fn().mockResolvedValue({ data: [] }),
    searchMetricsPage: vi.fn().mockResolvedValue({ data: [] }),
    searchAggregatedMetrics: vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: null }),
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
    queryTracesRaw: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    queryTracesAggregate: vi.fn().mockResolvedValue({ data: [] }),
    queryLogsRaw: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    queryLogsAggregate: vi.fn().mockResolvedValue({ data: [] }),
    queryMetricsRaw: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    queryMetricsAggregate: vi.fn().mockResolvedValue({ data: [] }),
    query: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
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

let mockClient: MockClient;
let originalLocation: string;

beforeEach(() => {
  mockClient = createMockClient();
  queryClient.clear();
  vi.clearAllMocks();
  originalLocation = window.location.search;
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe("useDashboardTree validation", () => {
  it("renders DynamicDashboard when API returns a valid uiTree", async () => {
    mockClient.getDashboard.mockResolvedValueOnce({ uiTree: VALID_TREE });

    setURL("?tab=metrics&dashboardId=abc");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Test Dashboard")).toBeTruthy();
    });

    expect(mockClient.getDashboard).toHaveBeenCalledWith(
      "abc",
      expect.anything()
    );
    expect(screen.queryByText(/invalid layout/i)).toBeNull();
  });

  it("shows error when API returns an invalid uiTree", async () => {
    const invalidTree = {
      root: "x",
      elements: {
        x: { type: "Bogus", key: "x", children: [], parentKey: "" },
      },
    };

    mockClient.getDashboard.mockResolvedValueOnce({ uiTree: invalidTree });

    setURL("?tab=metrics&dashboardId=def");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(screen.getByText(/invalid layout/i)).toBeTruthy();
    });

    expect(mockClient.getDashboard).toHaveBeenCalledWith(
      "def",
      expect.anything()
    );
  });
});

describe("trace search operation picker", () => {
  it("loads the operations of a service as soon as it is picked, before any search is submitted", async () => {
    mockClient.getServices.mockResolvedValue({
      services: ["cart", "checkout"],
    });
    mockClient.getOperations.mockResolvedValue({
      operations: ["GET /cart", "POST /cart"],
    });

    setURL("?tab=services");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const serviceSelect = await screen.findByRole("combobox", {
      name: /service/i,
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "cart" })).toBeTruthy();
    });

    fireEvent.change(serviceSelect, { target: { value: "cart" } });

    await waitFor(() => {
      expect(mockClient.getOperations).toHaveBeenCalledWith(
        "cart",
        expect.anything()
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GET /cart" })).toBeTruthy();
    });

    // The URL is still untouched — no search was submitted.
    expect(window.location.search).not.toContain("service=cart");
  });

  it("clears a stale operation when the service changes", async () => {
    mockClient.getServices.mockResolvedValue({
      services: ["cart", "checkout"],
    });
    mockClient.getOperations.mockResolvedValue({
      operations: ["GET /cart"],
    });

    setURL("?tab=services&service=cart&operation=GET%20%2Fcart");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const operationSelect = (await screen.findByRole("combobox", {
      name: /operation/i,
    })) as HTMLSelectElement;
    const serviceSelect = screen.getByRole("combobox", { name: /service/i });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GET /cart" })).toBeTruthy();
    });
    fireEvent.change(operationSelect, { target: { value: "GET /cart" } });
    expect(operationSelect.value).toBe("GET /cart");

    fireEvent.change(serviceSelect, { target: { value: "checkout" } });

    expect(operationSelect.value).toBe("");
  });

  it("does not submit an operation held over from a URL-driven service change", async () => {
    mockClient.getServices.mockResolvedValue({
      services: ["cart", "checkout"],
    });
    mockClient.getOperations.mockImplementation(async (serviceName: string) =>
      serviceName === "cart"
        ? { operations: ["GET /cart"] }
        : { operations: ["POST /pay"] }
    );

    setURL("?tab=services&service=checkout");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const operationSelect = (await screen.findByRole("combobox", {
      name: /operation/i,
    })) as HTMLSelectElement;
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "POST /pay" })).toBeTruthy();
    });
    fireEvent.change(operationSelect, { target: { value: "POST /pay" } });
    expect(operationSelect.value).toBe("POST /pay");

    // Browser Back onto a search that ran against a different service.
    setURL("?tab=services&service=cart");

    await waitFor(() => {
      const service = screen.getByRole("combobox", {
        name: /service/i,
      }) as HTMLSelectElement;
      expect(service.value).toBe("cart");
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GET /cart" })).toBeTruthy();
    });

    // Submitting the committed search verbatim would rebuild the same URL and
    // fire no request, leaving the assertions below on the pre-click call. Move
    // one unrelated field so the submit is a genuinely new search.
    fireEvent.change(screen.getByRole("spinbutton", { name: /limit/i }), {
      target: { value: "50" },
    });

    const callsBefore = mockClient.searchTraceSummariesPage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /find traces/i }));

    await waitFor(() => {
      expect(
        mockClient.searchTraceSummariesPage.mock.calls.length
      ).toBeGreaterThan(callsBefore);
    });

    // "POST /pay" belongs to checkout — cart never emits it.
    expect(window.location.search).toContain("service=cart");
    expect(window.location.search).not.toContain("POST");
    const lastCall = mockClient.searchTraceSummariesPage.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({ serviceName: "cart" });
    expect(lastCall?.[0]).not.toHaveProperty("spanName");
  });

  it("hydrates the operation filter from the URL", async () => {
    mockClient.getServices.mockResolvedValue({ services: ["cart"] });
    mockClient.getOperations.mockResolvedValue({
      operations: ["GET /cart"],
    });

    setURL("?tab=services&service=cart&operation=GET%20%2Fcart");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GET /cart" })).toBeTruthy();
    });

    const operationSelect = screen.getByRole("combobox", {
      name: /operation/i,
    }) as HTMLSelectElement;
    expect(operationSelect.value).toBe("GET /cart");
  });

  it("hydrates the remaining trace filters from the URL", async () => {
    mockClient.getServices.mockResolvedValue({ services: ["cart"] });

    setURL(
      "?tab=services&service=cart&tags=http.status_code%3D500" +
        "&lookback=1h&minDuration=100ms&maxDuration=5s&limit=50"
    );

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const tags = (await screen.findByRole("textbox", {
      name: /tags/i,
    })) as HTMLTextAreaElement;
    expect(tags.value).toBe("http.status_code=500");

    const lookback = screen.getByRole("combobox", {
      name: /lookback/i,
    }) as HTMLSelectElement;
    expect(lookback.value).toBe("1h");

    const minDuration = screen.getByRole("textbox", {
      name: /min duration/i,
    }) as HTMLInputElement;
    expect(minDuration.value).toBe("100ms");

    const maxDuration = screen.getByRole("textbox", {
      name: /max duration/i,
    }) as HTMLInputElement;
    expect(maxDuration.value).toBe("5s");

    const limit = screen.getByRole("spinbutton", {
      name: /limit/i,
    }) as HTMLInputElement;
    expect(limit.value).toBe("50");
  });

  it("disables the operation picker until a service is chosen", async () => {
    mockClient.getServices.mockResolvedValue({ services: ["cart"] });

    setURL("?tab=services");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const operationSelect = (await screen.findByRole("combobox", {
      name: /operation/i,
    })) as HTMLSelectElement;
    expect(operationSelect.disabled).toBe(true);
    expect(
      screen.getByRole("option", { name: /select a service first/i })
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "cart" })).toBeTruthy();
    });
    fireEvent.change(screen.getByRole("combobox", { name: /service/i }), {
      target: { value: "cart" },
    });

    const operationAfter = screen.getByRole("combobox", {
      name: /operation/i,
    }) as HTMLSelectElement;
    expect(operationAfter.disabled).toBe(false);
  });

  it("clears the service filter when All Services is submitted", async () => {
    mockClient.getServices.mockResolvedValue({
      services: ["cart", "checkout"],
    });

    setURL("?tab=services&service=cart");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const serviceSelect = (await screen.findByRole("combobox", {
      name: /service/i,
    })) as HTMLSelectElement;
    await waitFor(() => {
      expect(serviceSelect.value).toBe("cart");
    });

    fireEvent.change(serviceSelect, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /find traces/i }));

    await waitFor(() => {
      expect(window.location.search).not.toContain("service=");
    });
    await waitFor(() => {
      const lastCall = mockClient.searchTraceSummariesPage.mock.calls.at(-1);
      expect(lastCall?.[0]).not.toHaveProperty("serviceName");
    });
  });
});

describe("trace search tags filter", () => {
  let mockClient: MockClient;
  let originalLocation: string;

  beforeEach(() => {
    mockClient = createMockClient();
    queryClient.clear();
    vi.clearAllMocks();
    originalLocation = window.location.search;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  // Both halves of this filter failed silently: `tags` is not a key of
  // traceSummariesFilterSchema, so zod stripped it, and the logfmt key pattern
  // clipped dotted attribute names to their last segment. Either one returns
  // zero traces with no error, so assert on what actually reaches the client.
  it("sends tags as span attributes, preserving dotted attribute keys", async () => {
    setURL("?tab=services&tags=http.request.method%3DGET");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      const filter = mockClient.searchTraceSummariesPage.mock.calls.at(-1)?.[0];
      expect(filter).toMatchObject({
        spanAttributes: { "http.request.method": "GET" },
      });
      expect(filter).not.toHaveProperty("tags");
    });
  });
});

describe("service map tab", () => {
  let restoreFlow: () => void;

  beforeAll(() => {
    restoreFlow = installReactFlowJsdom();
  });
  afterAll(() => restoreFlow());

  // Unmount first so React drops its session reference, then stop every
  // engine and clear its timers (the 10 s poll and the 1 s release grace).
  afterEach(() => {
    cleanup();
    __resetSessionsForTests();
    vi.unstubAllGlobals();
  });

  /** One frontend -> cart call near now, plus a seed naming both services. */
  function scriptMapData(client: MockClient) {
    const now = Date.now();
    client.queryTracesAggregate
      .mockResolvedValueOnce({
        data: seedNodeRows({ "web-frontend": 50, cart: 30, "report-cron": 2 }),
      })
      .mockResolvedValue({ data: [] });
    client.searchTracesPage.mockImplementation(
      async (filter: { sortOrder?: string }) =>
        filter.sortOrder === "DESC"
          ? { data: pairRows("p1", "web-frontend", "cart", now - 60_000) }
          : { data: [] }
    );
  }

  const map = () => screen.getByRole("region", { name: "Service map" });

  it("clicking a service opens its traces (?service=<name>)", async () => {
    scriptMapData(mockClient);
    setURL("?tab=service-map");
    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );
    const cart = await screen.findByTestId(
      "sm-node-cart",
      {},
      { timeout: 4000 }
    );
    fireEvent.click(cart);
    expect(window.location.search).toBe("?service=cart");
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "Traces" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
  });

  it("going to another tab and back keeps the map: no new seed, nodes shown at once", async () => {
    scriptMapData(mockClient);
    setURL("?tab=service-map");
    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );
    await screen.findByTestId("sm-node-cart", {}, { timeout: 4000 });
    const aggregates = mockClient.queryTracesAggregate.mock.calls.length;

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Service map" })).toBeNull()
    );
    // Longer than the 1 s release grace: the session is paused, not stopped.
    await act(() => new Promise((r) => setTimeout(r, 1500)));

    fireEvent.click(screen.getByRole("tab", { name: "Service map" }));
    expect(
      await screen.findByTestId("sm-node-cart", {}, { timeout: 1000 })
    ).toBeTruthy();
    expect(screen.getByTestId("sm-node-web-frontend").classList).toContain(
      "sm-hub"
    );
    expect(mockClient.queryTracesAggregate.mock.calls.length).toBe(aggregates);
  });

  it("renders the lazy map from ?tab=service-map and starts the scan with the seed, then a DESC page", async () => {
    scriptMapData(mockClient);
    setURL("?tab=service-map");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    expect(
      screen
        .getByRole("tab", { name: "Service map" })
        .getAttribute("aria-selected")
    ).toBe("true");

    // The real React Flow canvas: the busiest connected service is the hub.
    const hub = await screen.findByTestId(
      "sm-node-web-frontend",
      {},
      { timeout: 4000 }
    );
    expect(hub.classList.contains("sm-hub")).toBe(true);
    expect(map().contains(hub)).toBe(true);
    expect(screen.getByTestId("sm-node-cart")).toBeTruthy();
    // report-cron has no calls: it waits in the tray.
    expect(screen.getByText(/Not connected to the map yet · 1/)).toBeTruthy();

    // In-process with the page's custom client (PD-7): the first requests
    // are getServices, the two A1 seed aggregates, then the backward DESC page.
    const order = [
      ...mockClient.getServices.mock.invocationCallOrder.map((n: number) => ({
        n,
        m: "services",
      })),
      ...mockClient.queryTracesAggregate.mock.invocationCallOrder.map(
        (n: number) => ({ n, m: "aggregate" })
      ),
      ...mockClient.searchTracesPage.mock.invocationCallOrder.map(
        (n: number, i: number) => ({
          n,
          m: `search:${(mockClient.searchTracesPage.mock.calls[i]![0] as { sortOrder?: string }).sortOrder}`,
        })
      ),
    ]
      .sort((a, b) => a.n - b.n)
      .map((c) => c.m);
    expect(order.slice(0, 4)).toEqual([
      "services",
      "aggregate",
      "aggregate",
      "search:DESC",
    ]);

    const desc = mockClient.searchTracesPage.mock.calls[0]![0] as {
      timestampMin: string;
      timestampMax: string;
      limit: number;
    };
    expect(desc.limit).toBe(1000);
    // Window: [now - 60 min, T0 - 1], where T0 = now - the 30 s live delay.
    const spanNs = BigInt(desc.timestampMax) - BigInt(desc.timestampMin);
    expect(spanNs).toBeGreaterThan(3_569_000_000_000n);
    expect(spanNs).toBeLessThan(3_570_000_000_000n);
    // The other tabs' data is never touched by the map.
    expect(mockClient.searchTraceSummariesPage).not.toHaveBeenCalled();
  });

  it("stops the engine on unmount: no session survives and no request follows", async () => {
    scriptMapData(mockClient);
    setURL("?tab=service-map");
    const client = mockClient as unknown as KopaiClient;
    const { unmount } = render(createElement(ObservabilityPage, { client }));
    await waitFor(
      () => expect(mockClient.searchTracesPage).toHaveBeenCalled(),
      { timeout: 4000 }
    );
    expect(peekSnapshot({ client })).not.toBeNull();

    unmount();
    __resetSessionsForTests();
    expect(peekSnapshot({ client })).toBeNull();

    const calls = () =>
      mockClient.searchTracesPage.mock.calls.length +
      mockClient.queryTracesAggregate.mock.calls.length +
      mockClient.getTrace.mock.calls.length;
    const before = calls();
    // Longer than the request gap and the 1 s backoff: nothing is scheduled.
    await new Promise((r) => setTimeout(r, 1200));
    expect(calls()).toBe(before);
  });

  it("opens the map by clicking its tab and by Shift+S, and leaves it by Shift+T", async () => {
    scriptMapData(mockClient);
    setURL("?tab=logs");
    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );
    expect(screen.queryByRole("region", { name: "Service map" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Service map" }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "service-map"
    );
    await waitFor(() => expect(map()).toBeTruthy());

    fireEvent.keyDown(document.body, { key: "T", shiftKey: true });
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Service map" })).toBeNull()
    );

    fireEvent.keyDown(document.body, { key: "S", shiftKey: true });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "service-map"
    );
    await waitFor(() => expect(map()).toBeTruthy());
    expect(
      screen
        .getByRole("tab", { name: "Service map" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });

  it("lists Shift+S in the shortcuts help", async () => {
    setURL("?tab=logs");
    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );
    fireEvent.keyDown(document.body, { key: "?", shiftKey: true });
    expect(await screen.findByText("Service map tab")).toBeTruthy();
  });

  it("with serviceMapWorker, connects to that server instead of the custom client", async () => {
    // jsdom has no Worker, so the session runs the worker's own client
    // in-process: that client is built from serviceMapWorker, not `client`.
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/signals/services")
              ? { services: [] }
              : { data: [] }
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    setURL("?tab=service-map");
    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
        serviceMapWorker: {
          baseUrl: "http://kopai.example",
          headers: { "x-tenant": "a" },
        },
      })
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), {
      timeout: 4000,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe("http://kopai.example/signals/services");
    expect(new Headers(init.headers).get("x-tenant")).toBe("a");
    expect(mockClient.queryTracesAggregate).not.toHaveBeenCalled();
    expect(mockClient.searchTracesPage).not.toHaveBeenCalled();
  });
});
