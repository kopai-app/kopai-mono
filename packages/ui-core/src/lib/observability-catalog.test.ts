/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, renderHook } from "@testing-library/react";
import { observabilityCatalog } from "./observability-catalog.js";
import { generatePromptInstructions } from "./generate-prompt-instructions.js";
import { createRendererFromCatalog, type UITree } from "./renderer.js";
import {
  KopaiSDKProvider,
  useOptionalKopaiSDK,
  type KopaiClient,
} from "../providers/kopai-provider.js";

/** A one-card dashboard holding a Service map. */
function serviceMapTree(
  mapProps: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return {
    root: "card-1",
    elements: {
      "card-1": {
        key: "card-1",
        type: "Card",
        props: { title: "Services", description: null, padding: null },
        children: ["map-1"],
        parentKey: "",
      },
      "map-1": {
        key: "map-1",
        type: "ServiceMap",
        props: mapProps,
        children: [],
        parentKey: "card-1",
        ...extra,
      },
    },
  };
}

describe("observabilityCatalog.ServiceMap", () => {
  const schema = observabilityCatalog.uiTreeSchema;

  it("is a leaf that declares no dataSource methods", () => {
    const def = observabilityCatalog.components.ServiceMap;
    expect(def.hasChildren).toBe(false);
    expect("acceptsDataFrom" in def).toBe(false);
  });

  it("accepts a ServiceMap without a dataSource", () => {
    expect(schema.safeParse(serviceMapTree({ height: 480 })).success).toBe(
      true
    );
    expect(schema.safeParse(serviceMapTree({ height: null })).success).toBe(
      true
    );
  });

  it("requires the nullable height prop to be present", () => {
    expect(schema.safeParse(serviceMapTree({})).success).toBe(false);
  });

  it("rejects a non-numeric height", () => {
    expect(schema.safeParse(serviceMapTree({ height: "480px" })).success).toBe(
      false
    );
  });

  it("is documented in the generated prompt instructions", () => {
    const text = generatePromptInstructions(observabilityCatalog, "0.17.0");
    const section = text
      .split("\n\n---\n\n")
      .find((s) => s.startsWith("### ServiceMap"));
    expect(section).toBeDefined();
    // Nullable numbers print as plain "number" (same as LogTimeline.height).
    expect(section).toContain("- height: number (required)");
    expect(section).toContain("null = 480");
    expect(section).toContain("Accepts dataSource: no");
    expect(section).toContain("past 60 minutes");
    expect(section).toContain("NO dataSource");
    // The output schema lists it as an element type.
    expect(text).toContain('"const":"ServiceMap"');
  });
});

describe("rendering a ServiceMap element", () => {
  const seen: { hasData: boolean; height: unknown }[] = [];
  const noop = () => null;
  const Render = createRendererFromCatalog(observabilityCatalog, {
    Card: ({ children }) => createElement("div", null, children as ReactNode),
    Grid: noop,
    Stack: noop,
    Heading: noop,
    Text: noop,
    Badge: noop,
    Divider: noop,
    Empty: noop,
    LogTimeline: noop,
    TraceDetail: noop,
    MetricTimeSeries: noop,
    MetricHistogram: noop,
    MetricStat: noop,
    MetricTable: noop,
    AggregateTable: noop,
    MetricDiscovery: noop,
    ServiceMap: (props) => {
      seen.push({ hasData: props.hasData, height: props.element.props.height });
      return createElement("div", { "data-testid": "map" });
    },
  });
  const client = {} as KopaiClient;

  afterEach(() => {
    seen.length = 0;
    vi.restoreAllMocks();
  });

  it("renders it directly, without data, with its props", () => {
    const { getByTestId } = render(
      createElement(KopaiSDKProvider, {
        client,
        children: createElement(Render, {
          tree: serviceMapTree({ height: 360 }) as UITree,
        }),
      })
    );
    expect(getByTestId("map")).toBeTruthy();
    expect(seen).toEqual([{ hasData: false, height: 360 }]);
  });

  it("renders nothing when a dataSource is attached to it", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tree = serviceMapTree(
      { height: null },
      { dataSource: { method: "getServices", params: {} } }
    );
    const { queryByTestId } = render(
      createElement(KopaiSDKProvider, {
        client,
        children: createElement(Render, { tree: tree as UITree }),
      })
    );
    expect(queryByTestId("map")).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"ServiceMap" does not accept dataSource')
    );
  });
});

describe("useOptionalKopaiSDK", () => {
  it("is null outside a KopaiSDKProvider", () => {
    const { result } = renderHook(() => useOptionalKopaiSDK());
    expect(result.current).toBeNull();
  });

  it("returns the provider's client inside one", () => {
    const client = { getServices: vi.fn() } as unknown as KopaiClient;
    const { result } = renderHook(() => useOptionalKopaiSDK(), {
      wrapper: ({ children }) =>
        createElement(KopaiSDKProvider, { client, children }),
    });
    expect(result.current).toBe(client);
  });
});
