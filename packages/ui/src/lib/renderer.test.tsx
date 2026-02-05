/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, waitFor, act } from "@testing-library/react";
import { Renderer, type RendererComponentProps } from "./renderer.js";
import { createRegistry } from "./create-registry.js";
import { KopaiSDKProvider } from "./kopai-provider.js";
import { createCatalog } from "./component-catalog.js";
import z from "zod";
import type { KopaiClient } from "@kopai/sdk";

// Create a simple catalog and derive UITree type
const _testCatalog = createCatalog({
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

function Capture(
  _props: RendererComponentProps<typeof _testCatalog.components.Capture>
) {
  return createElement("div", null, "captured");
}

function DataComponent(
  props: RendererComponentProps<typeof _testCatalog.components.DataComponent>
) {
  if (!props.hasData) {
    return createElement("div", { "data-testid": "no-data" }, "No data source");
  }
  const { data, loading, error } = props;
  if (loading)
    return createElement("div", { "data-testid": "loading" }, "Loading...");
  if (error)
    return createElement("div", { "data-testid": "error" }, error.message);
  return createElement("div", { "data-testid": "data" }, JSON.stringify(data));
}

function RefetchComponent(
  props: RendererComponentProps<typeof _testCatalog.components.RefetchComponent>
) {
  if (!props.hasData) return null;
  return createElement(
    "div",
    { "data-testid": "data" },
    JSON.stringify(props.data)
  );
}

const registry = createRegistry(_testCatalog, {
  Box,
  Text,
  Capture,
  DataComponent,
  RefetchComponent,
});

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
    let receivedProps: RendererComponentProps<
      typeof _testCatalog.components.Capture
    > | null = null;
    function CaptureLocal(
      props: RendererComponentProps<typeof _testCatalog.components.Capture>
    ) {
      receivedProps = props;
      return createElement("div", null, "captured");
    }
    const localRegistry = createRegistry(_testCatalog, {
      Box,
      Text,
      Capture: CaptureLocal,
      DataComponent,
      RefetchComponent,
    });
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
      createElement(Renderer, { tree, registry: localRegistry })
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
    render(createElement(Renderer, { tree, registry }), {
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
    render(createElement(Renderer, { tree, registry }), {
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
    render(createElement(Renderer, { tree, registry }), {
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
    function RefetchComponentLocal(
      props: RendererComponentProps<
        typeof _testCatalog.components.RefetchComponent
      >
    ) {
      if (!props.hasData) return null;
      capturedRefetch = props.refetch;
      return createElement(
        "div",
        { "data-testid": "data" },
        JSON.stringify(props.data)
      );
    }

    const localRegistry = createRegistry(_testCatalog, {
      Box,
      Text,
      Capture,
      DataComponent,
      RefetchComponent: RefetchComponentLocal,
    });

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
    render(createElement(Renderer, { tree, registry: localRegistry }), {
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
    render(createElement(Renderer, { tree, registry }), {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId("no-data")).toBeDefined();
    expect(screen.getByTestId("no-data").textContent).toBe("No data source");
  });
});

describe("createRegistry with Renderer integration", () => {
  const integrationCatalog = createCatalog({
    name: "integration-test",
    components: {
      Wrapper: {
        hasChildren: true,
        description: "A wrapper",
        props: z.object({}),
      },
      Label: {
        hasChildren: false,
        description: "A label",
        props: z.object({ text: z.string() }),
      },
    },
  });

  type IntegrationUITree = z.infer<typeof integrationCatalog.uiTreeSchema>;

  function Wrapper({
    children,
  }: RendererComponentProps<typeof integrationCatalog.components.Wrapper>) {
    return createElement("div", { "data-testid": "wrapper" }, children);
  }

  function Label({
    element,
  }: RendererComponentProps<typeof integrationCatalog.components.Label>) {
    return createElement(
      "span",
      { "data-testid": "label" },
      element.props.text
    );
  }

  it("renders tree using registry created with createRegistry", () => {
    const registry = createRegistry(integrationCatalog, {
      Wrapper,
      Label,
    });

    const tree: IntegrationUITree = {
      root: "wrapper-1",
      elements: {
        "wrapper-1": {
          key: "wrapper-1",
          type: "Wrapper",
          props: {},
          children: ["label-1"],
          parentKey: "",
        },
        "label-1": {
          key: "label-1",
          type: "Label",
          props: { text: "Hello World" },
          children: [],
          parentKey: "wrapper-1",
        },
      },
    };

    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );

    expect(result).toContain("Hello World");
    expect(result).toContain('data-testid="wrapper"');
    expect(result).toContain('data-testid="label"');
  });

  it("accepts registry from createRegistry without cast", () => {
    const registry = createRegistry(integrationCatalog, {
      Wrapper,
      Label,
    });

    const tree: IntegrationUITree = {
      root: "label-1",
      elements: {
        "label-1": {
          key: "label-1",
          type: "Label",
          props: { text: "Test" },
          children: [],
          parentKey: "",
        },
      },
    };

    // This should compile without any cast - Renderer is now generic
    const result = renderToStaticMarkup(
      createElement(Renderer, { tree, registry })
    );

    expect(result).toContain("Test");
  });
});
