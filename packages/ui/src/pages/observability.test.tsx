/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ObservabilityPage from "./observability.js";
import { queryClient } from "@kopai/ui-core";
import type { KopaiClient } from "@kopai/sdk";

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

// KOP-216: with no time range the page used to ask for the workspace's whole
// history, which times out on a large one. Assert on what reaches the client.
describe("default lookback (KOP-216)", () => {
  const HOUR_NS = 60n * 60n * 1_000_000_000n;

  function nowNs(): bigint {
    return BigInt(Date.now()) * 1_000_000n;
  }

  /** The request covers about the last hour: start within a minute of now - 1h. */
  function expectLastHour(
    timestampMin: unknown,
    before: bigint,
    after: bigint
  ) {
    expect(typeof timestampMin).toBe("string");
    const min = BigInt(timestampMin as string);
    expect(min).toBeGreaterThanOrEqual(before - HOUR_NS - 60_000_000_000n);
    expect(min).toBeLessThanOrEqual(after - HOUR_NS);
  }

  it("searches traces over the last hour when the URL has no time range", async () => {
    setURL("?tab=services");
    const before = nowNs();

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchTraceSummariesPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchTraceSummariesPage.mock.calls[0]?.[0];
    expectLastHour(filter?.timestampMin, before, nowNs());
    expect(filter?.timestampMax).toBeUndefined();

    const lookback = screen.getByRole("combobox", {
      name: /lookback/i,
    }) as HTMLSelectElement;
    expect(lookback.value).toBe("1h");
    const labels = Array.from(lookback.options).map((o) => o.textContent);
    expect(labels).not.toContain("All time");
  });

  it("keeps an absolute end time from the URL without adding the default start", async () => {
    setURL("?tab=services&tsMax=1700000000000000000");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchTraceSummariesPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchTraceSummariesPage.mock.calls[0]?.[0];
    expect(filter?.timestampMax).toBe("1700000000000000000");
    expect(filter?.timestampMin).toBeUndefined();
  });

  it("keeps an absolute start time from the URL", async () => {
    setURL("?tab=services&tsMin=1700000000000000000");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchTraceSummariesPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchTraceSummariesPage.mock.calls[0]?.[0];
    expect(filter?.timestampMin).toBe("1700000000000000000");
  });

  it("tails logs from the last hour when the URL has no time range", async () => {
    setURL("?tab=logs");
    const before = nowNs();

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchLogsPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchLogsPage.mock.calls[0]?.[0];
    expectLastHour(filter?.timestampMin, before, nowNs());
  });

  it("restarts the logs default hour from now when a filter changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t0 = new Date("2027-01-15T08:00:00Z").getTime();
      vi.setSystemTime(t0);
      setURL("?tab=logs");

      render(
        createElement(ObservabilityPage, {
          client: mockClient as unknown as KopaiClient,
        })
      );
      await waitFor(() => {
        expect(mockClient.searchLogsPage).toHaveBeenCalled();
      });

      // Five hours later the user changes the sort order.
      const t1 = t0 + 5 * 60 * 60_000;
      vi.setSystemTime(t1);
      fireEvent.click(screen.getByTestId("log-filter-toggle"));
      fireEvent.change(screen.getByTestId("filter-sortOrder"), {
        target: { value: "ASC" },
      });

      await waitFor(() => {
        const filter = mockClient.searchLogsPage.mock.calls.at(-1)?.[0];
        expect(filter?.sortOrder).toBe("ASC");
        expect(filter?.timestampMin).toBe(
          String(BigInt(t1 - 60 * 60_000) * 1_000_000n)
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not limit a log search by trace ID to the last hour", async () => {
    setURL("?tab=logs&traceId=abc");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchLogsPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchLogsPage.mock.calls[0]?.[0];
    expect(filter?.traceId).toBe("abc");
    expect(filter?.timestampMin).toBeUndefined();
  });

  it("shows an absolute URL range as Custom range and keeps it when other filters are submitted", async () => {
    setURL("?tab=services&tsMin=1700000000000000000&tsMax=1700000600000000000");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const lookback = (await screen.findByRole("combobox", {
      name: /lookback/i,
    })) as HTMLSelectElement;
    expect(lookback.selectedOptions[0]?.textContent).toBe("Custom range");

    fireEvent.change(screen.getByRole("textbox", { name: /tags/i }), {
      target: { value: "http.route=/cart" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /find traces/i })
    );

    await waitFor(() => {
      expect(window.location.search).toContain("tags=");
    });
    expect(window.location.search).toContain("tsMin=1700000000000000000");
    expect(window.location.search).toContain("tsMax=1700000600000000000");
    expect(window.location.search).not.toContain("lookback=");
    await waitFor(() => {
      const filter = mockClient.searchTraceSummariesPage.mock.calls.at(-1)?.[0];
      expect(filter).toMatchObject({
        timestampMin: "1700000000000000000",
        timestampMax: "1700000600000000000",
        spanAttributes: { "http.route": "/cart" },
      });
    });
  });

  it("replaces an absolute URL range when a lookback is picked", async () => {
    setURL("?tab=services&tsMin=1700000000000000000");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const lookback = (await screen.findByRole("combobox", {
      name: /lookback/i,
    })) as HTMLSelectElement;
    fireEvent.change(lookback, { target: { value: "2h" } });
    fireEvent.click(
      await screen.findByRole("button", { name: /find traces/i })
    );

    await waitFor(() => {
      expect(window.location.search).toContain("lookback=2h");
    });
    expect(window.location.search).not.toContain("tsMin=");
  });

  it("offers no Custom range when the URL has no absolute range", async () => {
    setURL("?tab=services");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    const lookback = (await screen.findByRole("combobox", {
      name: /lookback/i,
    })) as HTMLSelectElement;
    const labels = Array.from(lookback.options).map((o) => o.textContent);
    expect(labels).not.toContain("Custom range");
  });

  it("keeps a log start time from the URL", async () => {
    setURL("?tab=logs&tsMin=1700000000000000000");

    render(
      createElement(ObservabilityPage, {
        client: mockClient as unknown as KopaiClient,
      })
    );

    await waitFor(() => {
      expect(mockClient.searchLogsPage).toHaveBeenCalled();
    });
    const filter = mockClient.searchLogsPage.mock.calls[0]?.[0];
    expect(filter?.timestampMin).toBe("1700000000000000000");
  });
});
