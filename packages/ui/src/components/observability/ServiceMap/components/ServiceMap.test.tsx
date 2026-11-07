/**
 * @vitest-environment jsdom
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ServiceMapSnapshot } from "../engine/types.js";
import { fixtureFrames, shop, discover } from "../layout/fixtures.js";
import { updateLayout } from "../layout/layout-d.js";
import { installReactFlowJsdom } from "../test-utils/react-flow-jsdom.js";
import {
  fixtureSnapshot,
  fixtureSnapshots,
  perfFixture,
} from "../test-utils/fixture-snapshot.js";
import {
  EMPTY_TEXT,
  LOADING_TEXT,
  NO_CALLS_HINT,
  ServiceMapView,
  graphSignature,
  useMapLayout,
} from "./ServiceMap.js";
import {
  SHIFT_TWEEN_MS,
  allPositions,
  prefersReducedMotion,
  renderableEdges,
  useTweenedPositions,
} from "./ServiceMapCanvas.js";
import {
  EDGE_MAX_WIDTH,
  EDGE_MIN_WIDTH,
  edgeStrokeWidth,
  edgeVisual,
  errorLevel,
  nodeSize,
} from "./edge-style.js";

let restore: () => void;
let warn: MockInstance;
let error: MockInstance;

beforeAll(() => {
  restore = installReactFlowJsdom();
});
afterAll(() => restore());
beforeEach(() => {
  warn = vi.spyOn(console, "warn");
  error = vi.spyOn(console, "error");
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

/** shop20 frame 1, with two services that had no traffic in the past 60 min. */
function shopFrame1(): ServiceMapSnapshot {
  return fixtureSnapshot(fixtureFrames("shop20")[0]!, {
    inactive: ["report-cron", "recommendations"],
  });
}

const flowWarnings = (spy: MockInstance) =>
  spy.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => /width and a height|\[React Flow\]/i.test(m));

describe("ServiceMapView (shop20)", () => {
  it("renders the map: hub label, tray count, dimmed inactive nodes", async () => {
    const snapshot = shopFrame1();
    render(<ServiceMapView snapshot={snapshot} />);
    await act(async () => {});

    // Hub: label present and ringed.
    const hub = screen.getByTestId("sm-node-api-gateway");
    expect(hub.classList.contains("sm-hub")).toBe(true);
    expect(hub.querySelector(".sm-label")?.textContent).toBe("api-gateway");

    // Tray: the 7 services not yet linked to the hub's component on frame 1.
    const expectedTray = updateLayout(null, discover(shop())[0]!).tray.count;
    expect(expectedTray).toBe(7);
    expect(screen.getByText("Not connected to the map yet · 7")).toBeTruthy();

    // Inactive nodes carry the dim class; active ones do not.
    const cron = screen.getByTestId("sm-node-report-cron");
    expect(cron.classList.contains("sm-dim")).toBe(true);
    expect(cron.getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("sm-node-recommendations").classList).toContain(
      "sm-dim"
    );
    expect(screen.getByTestId("sm-node-catalog").classList).not.toContain(
      "sm-dim"
    );

    // Virtual node shapes; no error badge and no tooltip.
    expect(screen.getByTestId("sm-node-postgres · orders").classList).toContain(
      "sm-kind-database"
    );
    expect(
      screen.getByTestId("sm-node-kafka · order-events").classList
    ).toContain("sm-kind-messaging");
    const payments = screen.getByTestId("sm-node-payments");
    expect(payments.classList).toContain("sm-err-warn");
    expect(payments.querySelector(".sm-err-glyph")).toBeNull();
    expect(payments.getAttribute("title")).toBeNull();

    expect(flowWarnings(warn)).toEqual([]);
    expect(flowWarnings(error)).toEqual([]);
  });

  it("renders only edges whose endpoints both exist, dashed when virtual, dimmed when inactive", async () => {
    const snapshot = shopFrame1();
    const ghost: ServiceMapSnapshot = {
      ...snapshot,
      edges: [
        ...snapshot.edges,
        {
          id: "catalog->ghost",
          source: "catalog",
          target: "ghost",
          calls: 10,
          errors: 0,
          active: true,
          virtual: false,
        },
      ],
    };
    const layout = updateLayout(null, discover(shop())[0]!);
    const kept = renderableEdges(ghost, allPositions(layout));
    expect(kept.map((e) => e.id)).not.toContain("catalog->ghost");
    expect(kept).toHaveLength(snapshot.edges.length);

    const { container } = render(<ServiceMapView snapshot={ghost} />);
    await act(async () => {});
    const rendered = [...container.querySelectorAll(".react-flow__edge")];
    expect(rendered.length).toBe(snapshot.edges.length);
    const ids = rendered.map((e) => e.getAttribute("data-id"));
    expect(ids).not.toContain("catalog->ghost");

    const path = (id: string) =>
      container.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`
      )!;
    const virt = path("catalog->postgres");
    expect(virt.style.strokeDasharray).not.toBe("");
    expect(Number(virt.style.strokeWidth)).toBeCloseTo(edgeStrokeWidth(14200));
    const real = path("web-frontend->api-gateway");
    expect(real.style.strokeDasharray).toBe("");
    // report-cron is inactive, so its edge to postgres is dimmed.
    expect(
      container
        .querySelector('.react-flow__edge[data-id="report-cron->postgres"]')!
        .classList.contains("sm-edge-dim")
    ).toBe(true);
  });

  it("hovering a service highlights its connections (like Find) and shows no tooltip", async () => {
    const { container } = render(<ServiceMapView snapshot={shopFrame1()} />);
    await act(async () => {});
    const stroke = (id: string) =>
      container.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`
      )!.style.stroke;
    const own = "web-frontend->api-gateway";
    const other = "catalog->postgres";
    const plain = stroke(own);
    expect(stroke(other)).toBe(plain);

    const node = container.querySelector(
      '.react-flow__node[data-id="api-gateway"]'
    )!;
    expect(node.querySelector("[title]")).toBeNull();
    fireEvent.mouseEnter(node);
    expect(stroke(own)).not.toBe(plain);
    expect(stroke(other)).toBe(plain);

    fireEvent.mouseLeave(node);
    expect(stroke(own)).toBe(plain);
  });

  it("shows the no-calls hint for a single service, plus loading and empty states", async () => {
    const one = fixtureSnapshots({
      nodes: [{ id: "my-app", kind: "service", spans: 4200 }],
      edges: [],
    }).at(-1)!;
    const { rerender } = render(<ServiceMapView snapshot={one} />);
    await act(async () => {});
    expect(screen.getByText(NO_CALLS_HINT)).toBeTruthy();
    expect(screen.getByTestId("sm-node-my-app").classList).toContain("sm-hub");

    rerender(<ServiceMapView snapshot={null} />);
    expect(screen.getAllByText(LOADING_TEXT).length).toBeGreaterThan(0);

    const empty = fixtureSnapshot({ nodes: [], edges: [], hub: null });
    rerender(<ServiceMapView snapshot={empty} />);
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy();

    // Connected services: no hint.
    rerender(<ServiceMapView snapshot={shopFrame1()} />);
    await act(async () => {});
    expect(screen.queryByText(NO_CALLS_HINT)).toBeNull();
  });
});

describe("useMapLayout", () => {
  it("re-runs layout only when the node/edge id signature changes", () => {
    const frames = fixtureSnapshots(shop());
    const first = frames[0]!;
    const { result, rerender } = renderHook(
      ({ s }: { s: ServiceMapSnapshot }) => useMapLayout(s),
      { initialProps: { s: first } }
    );
    const a = result.current;
    expect(a.positions.get("api-gateway")).toEqual({ x: 0, y: 0 });

    // Same ids, different counts (and reversed order): same layout object.
    const recounted: ServiceMapSnapshot = {
      ...first,
      seq: 2,
      nodes: [...first.nodes]
        .reverse()
        .map((n) => ({ ...n, spans: n.spans * 3 + 1 })),
      edges: first.edges.map((e) => ({ ...e, calls: 1 })),
    };
    expect(graphSignature(recounted)).toBe(graphSignature(first));
    rerender({ s: recounted });
    expect(result.current).toBe(a);

    // A new edge: new layout, already-placed nodes keep their positions.
    rerender({ s: frames[1]! });
    const b = result.current;
    expect(b).not.toBe(a);
    for (const [id, p] of a.positions) {
      expect(b.positions.get(id)).toEqual(p);
    }
    expect(b.tray.count).toBeLessThan(a.tray.count);
  });

  it("with layoutFrames, gives the same layout as seeing every frame in turn", () => {
    const frames = fixtureSnapshots(shop());
    const live = renderHook(
      ({ s }: { s: ServiceMapSnapshot }) => useMapLayout(s),
      { initialProps: { s: frames[0]! } }
    );
    for (const f of frames.slice(1)) live.rerender({ s: f });
    const replay = renderHook(() =>
      useMapLayout(frames.at(-1)!, frames.slice(0, -1))
    );
    expect([...replay.result.current.positions]).toEqual([
      ...live.result.current.positions,
    ]);
  });
});

describe("edge and node style scales", () => {
  it("edge width is a fixed log scale of calls, never normalised to a running max", () => {
    expect(edgeStrokeWidth(0)).toBe(EDGE_MIN_WIDTH);
    expect(edgeStrokeWidth(1)).toBe(1);
    expect(edgeStrokeWidth(10)).toBeCloseTo(2.2);
    expect(edgeStrokeWidth(1000)).toBeCloseTo(4.6);
    expect(edgeStrokeWidth(1e9)).toBe(EDGE_MAX_WIDTH);
    expect(edgeStrokeWidth(Number.NaN)).toBe(EDGE_MIN_WIDTH);
    // The same edge keeps its width whatever else is on the map.
    const w = edgeVisual({
      calls: 500,
      active: true,
      virtual: false,
    }).strokeWidth;
    expect(w).toBeCloseTo(1 + 1.2 * Math.log10(500));
  });

  it("dims inactive edges and dashes virtual ones", () => {
    const on = edgeVisual({ calls: 10, active: true, virtual: false });
    const off = edgeVisual({ calls: 10, active: false, virtual: true });
    expect(off.opacity).toBeLessThan(on.opacity);
    expect(on.strokeDasharray).toBeUndefined();
    expect(off.strokeDasharray).toBeTruthy();
    expect(off.strokeWidth).toBe(on.strokeWidth);
  });

  it("node size uses fixed breakpoints; error cue thresholds are 1 % and 5 %", () => {
    expect(nodeSize("service", 50)).toBe(16);
    expect(nodeSize("service", 5_000)).toBe(24);
    expect(nodeSize("service", 5_000_000)).toBe(36);
    expect(nodeSize("database", 0)).toBe(nodeSize("external", 1e6));
    expect(errorLevel(0.009)).toBe("none");
    expect(errorLevel(0.01)).toBe("warn");
    expect(errorLevel(0.05)).toBe("high");
    expect(errorLevel(Number.NaN)).toBe("none");
  });
});

describe("block-shift tween", () => {
  const A = new Map([
    ["hub", { x: 0, y: 0 }],
    ["far", { x: 440, y: 64 }],
  ]);
  const B = new Map([
    ["hub", { x: 0, y: 0 }],
    ["far", { x: 610, y: 64 }],
    ["new", { x: 220, y: 0 }],
  ]);

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tweens moved nodes over 300 ms with requestAnimationFrame; new nodes appear in place", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const { result, rerender } = renderHook(
      ({ t }: { t: ReadonlyMap<string, { x: number; y: number }> }) =>
        useTweenedPositions(t),
      {
        initialProps: { t: A as ReadonlyMap<string, { x: number; y: number }> },
      }
    );
    expect(result.current.get("far")).toEqual({ x: 440, y: 64 });
    rerender({ t: B });
    act(() => {
      vi.advanceTimersByTime(16 * 5);
    });
    const mid = result.current.get("far")!;
    expect(mid.x).toBeGreaterThan(440);
    expect(mid.x).toBeLessThan(610);
    expect(mid.y).toBe(64);
    expect(result.current.get("new")).toEqual({ x: 220, y: 0 });
    expect(result.current.get("hub")).toEqual({ x: 0, y: 0 });
    act(() => {
      vi.advanceTimersByTime(SHIFT_TWEEN_MS + 50);
    });
    expect(result.current.get("far")).toEqual({ x: 610, y: 64 });
  });

  it("jumps straight to the new positions under prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      (q: string) =>
        ({ matches: q.includes("reduce"), media: q }) as MediaQueryList
    );
    expect(prefersReducedMotion()).toBe(true);
    const { result, rerender } = renderHook(
      ({ t }: { t: ReadonlyMap<string, { x: number; y: number }> }) =>
        useTweenedPositions(t),
      {
        initialProps: { t: A as ReadonlyMap<string, { x: number; y: number }> },
      }
    );
    rerender({ t: B });
    expect(result.current.get("far")).toEqual({ x: 610, y: 64 });
  });
});

describe("perf fixture", () => {
  it("has 500 nodes and 900 distinct edges, all laid out without NaN", () => {
    const f = perfFixture(500, 900);
    expect(f.nodes).toHaveLength(500);
    expect(f.edges).toHaveLength(900);
    expect(new Set(f.edges.map((e) => `${e.source}>${e.target}`)).size).toBe(
      900
    );
    const last = discover(f).at(-1)!;
    const layout = updateLayout(null, last);
    const all = allPositions(layout);
    expect(all.size).toBe(500);
    for (const p of all.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
