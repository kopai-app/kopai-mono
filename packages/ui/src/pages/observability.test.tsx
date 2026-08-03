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
