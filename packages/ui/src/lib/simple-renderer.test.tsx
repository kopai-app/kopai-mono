/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  Renderer,
  type ComponentRenderProps,
  type ComponentRegistry,
  type RendererComponentProps,
} from "./simple-renderer.js";
import { KopaiSDKProvider } from "./kopai-provider.js";
import { createSimpleCatalog } from "./simple-component-catalog.js";
import z from "zod";
import type { KopaiClient } from "@kopai/sdk";

// Create a simple catalog and derive UITree type
const _testCatalog = createSimpleCatalog({
  name: "test",
  components: {
    Box: {
      hasChildren: true,
      description: "A box",
      props: z.object({}),
    },
    Text: {
      hasChildren: false,
      description: "Text",
      props: z.object({ content: z.string() }),
    },
    Capture: {
      hasChildren: false,
      description: "Captures props",
      props: z.object({ content: z.string() }),
    },
    DataComponent: {
      hasChildren: false,
      description: "Data test component",
      props: z.object({}),
    },
    RefetchComponent: {
      hasChildren: false,
      description: "Refetch test component",
      props: z.object({}),
    },
  },
});

type UITree = z.infer<typeof _testCatalog.uiTreeSchema>;

type MockClient = {
  searchTracesPage: ReturnType<typeof vi.fn>;
  searchLogsPage: ReturnType<typeof vi.fn>;
  searchMetricsPage: ReturnType<typeof vi.fn>;
  getTrace: ReturnType<typeof vi.fn>;
  discoverMetrics: ReturnType<typeof vi.fn>;
  searchTraces: ReturnType<typeof vi.fn>;
  searchLogs: ReturnType<typeof vi.fn>;
  searchMetrics: ReturnType<typeof vi.fn>;
};

function createWrapper(client: MockClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(KopaiSDKProvider, {
      client: client as unknown as KopaiClient,
      children,
    });
  };
}

// Simple test components
function Box({
  element,
  children,
}: RendererComponentProps<typeof _testCatalog.components.Box>) {
  return createElement(
    "div",
    { "data-type": element.type, "data-key": element.key },
    children
  );
}

function Text({
  element,
}: RendererComponentProps<typeof _testCatalog.components.Text>) {
  const { content } = element.props;
  return createElement("span", null, content);
}

const registry = { Box, Text } as ComponentRegistry;

describe("Renderer", () => {
  it("renders null for null tree", () => {
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree: null, registry })
    );
    expect(result).toBe("");
  });

  it("renders null for tree without root", () => {
    const tree = { root: "", elements: {} } as unknown as UITree;
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );
    expect(result).toBe("");
  });

  it("renders single element", () => {
    const tree = {
      root: "text-1",
      elements: {
        "text-1": {
          key: "text-1",
          type: "Text",
          children: [],
          parentKey: "",
          props: { content: "Hello" },
        },
      },
    } satisfies UITree; // should be like this, not casts
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );
    expect(result).toBe("<span>Hello</span>");
  });

  it("renders nested elements", () => {
    const tree = {
      root: "box-1",
      elements: {
        "box-1": {
          key: "box-1",
          type: "Box",
          props: {},
          children: ["text-1"],
          parentKey: "",
        },
        "text-1": {
          key: "text-1",
          type: "Text",
          props: { content: "Nested" },
          children: [],
          parentKey: "box-1",
        },
      },
    } satisfies UITree;
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );
    expect(result).toBe(
      '<div data-type="Box" data-key="box-1"><span>Nested</span></div>'
    );
  });

  it("renders deeply nested tree", () => {
    const tree = {
      root: "box-1",
      elements: {
        "box-1": {
          key: "box-1",
          type: "Box",
          props: {},
          children: ["box-2"],
          parentKey: "",
        },
        "box-2": {
          key: "box-2",
          type: "Box",
          props: {},
          children: ["text-1"],
          parentKey: "box-1",
        },
        "text-1": {
          key: "text-1",
          type: "Text",
          props: { content: "Deep" },
          children: [],
          parentKey: "box-2",
        },
      },
    } satisfies UITree;
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );
    expect(result).toContain("Deep");
    expect(result).toContain('data-key="box-2"');
  });

  it("skips children with missing elements", () => {
    const tree = {
      root: "box-1",
      elements: {
        "box-1": {
          key: "box-1",
          type: "Box",
          props: {},
          children: ["missing-1", "text-1"],
          parentKey: "",
        },
        "text-1": {
          key: "text-1",
          type: "Text",
          props: { content: "Present" },
          children: [],
          parentKey: "box-1",
        },
      },
    } satisfies UITree;
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );
    expect(result).toContain("Present");
    expect(result).not.toContain("missing");
  });

  it("passes hasData=false for elements without dataSource", () => {
    let receivedProps: ComponentRenderProps | null = null;
    function Capture(props: ComponentRenderProps) {
      receivedProps = props;
      return createElement("div", null, "captured");
    }
    const tree = {
      root: "capture-1",
      elements: {
        "capture-1": {
          key: "capture-1",
          type: "Capture",
          props: { content: "hello" },
          children: [],
          parentKey: "",
        },
      },
    } satisfies UITree;
    renderToStaticMarkup(
      createElement(Renderer, { tree, registry: { Capture } })
    );
    expect(receivedProps).not.toBeNull();
    expect(receivedProps!.hasData).toBe(false);
    expect(receivedProps!.element.props).toEqual({ content: "hello" });
  });
});

describe("Renderer with dataSource", () => {
  const createMockClient = (): MockClient => ({
    searchTracesPage: vi.fn(),
    searchLogsPage: vi.fn(),
    searchMetricsPage: vi.fn(),
    getTrace: vi.fn(),
    discoverMetrics: vi.fn(),
    searchTraces: vi.fn(),
    searchLogs: vi.fn(),
    searchMetrics: vi.fn(),
  });

  let mockClient: MockClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
  });

  function DataComponent(props: ComponentRenderProps) {
    if (!props.hasData) {
      return createElement(
        "div",
        { "data-testid": "no-data" },
        "No data source"
      );
    }
    const { data, loading, error } = props;
    if (loading)
      return createElement("div", { "data-testid": "loading" }, "Loading...");
    if (error)
      return createElement("div", { "data-testid": "error" }, error.message);
    return createElement(
      "div",
      { "data-testid": "data" },
      JSON.stringify(data)
    );
  }

  const dataRegistry: ComponentRegistry = { DataComponent };

  it("passes data props to component with dataSource", async () => {
    mockClient.searchTracesPage.mockResolvedValueOnce({
      data: [{ traceId: "abc" }],
    });

    const tree = {
      root: "data-1",
      elements: {
        "data-1": {
          key: "data-1",
          type: "DataComponent",
          props: {},
          children: [],
          parentKey: "",
          dataSource: { method: "searchTracesPage", params: { limit: 10 } },
        },
      },
    } satisfies UITree;

    const Wrapper = createWrapper(mockClient);
    render(createElement(Renderer, { tree, registry: dataRegistry }), {
      wrapper: Wrapper,
    });

    // Initially loading
    expect(screen.getByTestId("loading")).toBeDefined();

    // After data loads
    await waitFor(() => {
      expect(screen.queryByTestId("data")).not.toBeNull();
    });
    expect(screen.getByTestId("data").textContent).toBe(
      '{"data":[{"traceId":"abc"}]}'
    );
  });

  it("passes loading state correctly", async () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockClient.searchTracesPage.mockReturnValueOnce(promise);

    const tree = {
      root: "data-1",
      elements: {
        "data-1": {
          key: "data-1",
          type: "DataComponent",
          props: {},
          children: [],
          parentKey: "",
          dataSource: { method: "searchTracesPage", params: {} },
        },
      },
    } satisfies UITree;

    const Wrapper = createWrapper(mockClient);
    render(createElement(Renderer, { tree, registry: dataRegistry }), {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId("loading")).toBeDefined();

    resolvePromise!({ data: [] });
    await waitFor(() => {
      expect(screen.queryByTestId("data")).not.toBeNull();
    });
  });

  it("passes error state correctly", async () => {
    mockClient.searchTracesPage.mockRejectedValueOnce(
      new Error("Network error")
    );

    const tree = {
      root: "data-1",
      elements: {
        "data-1": {
          key: "data-1",
          type: "DataComponent",
          props: {},
          children: [],
          parentKey: "",
          dataSource: { method: "searchTracesPage", params: {} },
        },
      },
    } satisfies UITree;

    const Wrapper = createWrapper(mockClient);
    render(createElement(Renderer, { tree, registry: dataRegistry }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(screen.queryByTestId("error")).not.toBeNull();
    });
    expect(screen.getByTestId("error").textContent).toBe("Network error");
  });

  it("provides refetch function", async () => {
    mockClient.searchTracesPage
      .mockResolvedValueOnce({ data: [{ traceId: "first" }] })
      .mockResolvedValueOnce({ data: [{ traceId: "second" }] });

    let capturedRefetch: ((params?: Record<string, unknown>) => void) | null =
      null;
    function RefetchComponent(props: ComponentRenderProps) {
      if (!props.hasData) return null;
      capturedRefetch = props.refetch;
      return createElement(
        "div",
        { "data-testid": "data" },
        JSON.stringify(props.data)
      );
    }

    const tree = {
      root: "data-1",
      elements: {
        "data-1": {
          key: "data-1",
          type: "RefetchComponent",
          props: {},
          children: [],
          parentKey: "",
          dataSource: { method: "searchTracesPage", params: {} },
        },
      },
    } satisfies UITree;

    const Wrapper = createWrapper(mockClient);
    render(createElement(Renderer, { tree, registry: { RefetchComponent } }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(capturedRefetch).not.toBeNull();
    });

    act(() => {
      capturedRefetch!({ limit: 5 });
    });

    await waitFor(() => {
      expect(mockClient.searchTracesPage).toHaveBeenCalledTimes(2);
    });
  });

  it("renders element without dataSource normally", () => {
    const tree = {
      root: "data-1",
      elements: {
        "data-1": {
          key: "data-1",
          type: "DataComponent",
          props: {},
          children: [],
          parentKey: "",
          // No dataSource
        },
      },
    } satisfies UITree;

    const Wrapper = createWrapper(mockClient);
    render(createElement(Renderer, { tree, registry: dataRegistry }), {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId("no-data")).toBeDefined();
    expect(screen.getByTestId("no-data").textContent).toBe("No data source");
  });
});
