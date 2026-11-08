/**
 * @vitest-environment jsdom
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import type { ServiceMapSnapshot } from "../engine/types.js";
import { fixtureFrames } from "../layout/fixtures.js";
import { initialViewport } from "../layout/viewport.js";
import { installReactFlowJsdom } from "../test-utils/react-flow-jsdom.js";
import { fixtureSnapshot } from "../test-utils/fixture-snapshot.js";
import { ServiceMapView, useMapLayout } from "./ServiceMap.js";
import { detectColorMode, findBoxWidth } from "./ServiceMapCanvas.js";

/**
 * A ResizeObserver whose callbacks the test fires: React Flow's own
 * observers and the canvas's, all at once (like a window resize).
 */
class ControlledResizeObserver {
  static all = new Set<ControlledResizeObserver>();
  private targets: Element[] = [];
  constructor(private readonly cb: ResizeObserverCallback) {
    ControlledResizeObserver.all.add(this);
  }
  observe(target: Element) {
    this.targets.push(target);
    this.fire();
  }
  unobserve() {}
  disconnect() {
    ControlledResizeObserver.all.delete(this);
  }
  fire() {
    if (this.targets.length === 0) return;
    const entries = this.targets.map((target) => {
      const el = target as HTMLElement;
      return {
        target,
        contentRect: {
          width: el.offsetWidth,
          height: el.offsetHeight,
        } as DOMRectReadOnly,
        borderBoxSize: [
          { inlineSize: el.offsetWidth, blockSize: el.offsetHeight },
        ],
      } as unknown as ResizeObserverEntry;
    });
    this.cb(entries, this as unknown as ResizeObserver);
  }
  static fireAll() {
    for (const o of [...ControlledResizeObserver.all]) o.fire();
  }
}

let restore: () => void;
let prevRO: unknown;
beforeAll(() => {
  restore = installReactFlowJsdom();
  const g = globalThis as unknown as Record<string, unknown>;
  prevRO = g.ResizeObserver;
  g.ResizeObserver = ControlledResizeObserver;
});
afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = prevRO;
  restore();
});
afterEach(() => {
  cleanup();
  document.documentElement.className = "";
});

function shopFrame1(): ServiceMapSnapshot {
  return fixtureSnapshot(fixtureFrames("shop20")[0]!);
}

/** The React Flow viewport transform: "translate(xpx, ypx) scale(z)". */
function viewport(container: HTMLElement) {
  const t = container.querySelector<HTMLElement>(".react-flow__viewport")!.style
    .transform;
  const m = t.match(
    /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\) scale\(([\d.]+)\)/
  );
  if (!m) throw new Error(`no viewport transform in "${t}"`);
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

function expectedInitial(snapshot: ServiceMapSnapshot, height: number) {
  const layout = renderHook(() => useMapLayout(snapshot)).result.current;
  const hub = layout.positions.get(snapshot.hub!) ?? null;
  return initialViewport(layout.bounds, { width: 1200, height }, hub);
}

describe("canvas size changes", () => {
  it("re-applies the initial view for the new size while the user has not moved the view", async () => {
    const snapshot = shopFrame1();
    const { container, rerender } = render(
      <ServiceMapView snapshot={snapshot} height={300} />
    );
    await act(async () => {});
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const small = expectedInitial(snapshot, 300);
    expect(viewport(container).zoom).toBeCloseTo(small.zoom, 3);

    // The window grows: the canvas is now 900 px tall.
    rerender(<ServiceMapView snapshot={snapshot} height={900} />);
    await act(async () => ControlledResizeObserver.fireAll());
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const big = expectedInitial(snapshot, 900);
    expect(big.zoom).not.toBeCloseTo(small.zoom, 3);
    const v = viewport(container);
    expect(v.zoom).toBeCloseTo(big.zoom, 3);
    expect(v.y).toBeCloseTo(big.y, 1);
  });

  it("leaves the view alone after the user zoomed", async () => {
    const snapshot = shopFrame1();
    const { container, rerender, getByRole } = render(
      <ServiceMapView snapshot={snapshot} height={300} />
    );
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    const initial = viewport(container);
    fireEvent.click(getByRole("button", { name: "Zoom out" }));
    await act(async () => new Promise((r) => setTimeout(r, 400)));
    const before = viewport(container);
    expect(before.zoom).toBeLessThan(initial.zoom);

    rerender(<ServiceMapView snapshot={snapshot} height={900} />);
    await act(async () => ControlledResizeObserver.fireAll());
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(viewport(container)).toEqual(before);
  });
});

describe("Find box width", () => {
  it("is 256 px on a wide canvas and narrows so it never reaches the buttons", () => {
    expect(findBoxWidth(1200)).toBe(256);
    expect(findBoxWidth(406)).toBe(256);
    expect(findBoxWidth(344)).toBe(194);
    expect(findBoxWidth(200)).toBe(120);
  });

  it("is applied to the Find box from the measured canvas width", async () => {
    const { container } = render(
      <div style={{ width: "344px" }}>
        <ServiceMapView snapshot={shopFrame1()} height={300} />
      </div>
    );
    await act(async () => {});
    // jsdom has no layout: the stub reports 1200 px for the canvas itself.
    const find = container.querySelector<HTMLElement>(".sm-find")!;
    expect(find.style.width).toBe("256px");
    const input = find.querySelector("input")!;
    expect(input.getAttribute("spellcheck")).toBe("false");
  });
});

describe("colour mode", () => {
  it("follows a .dark / .light ancestor, else the OS preference", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    outer.className = "dark";
    expect(detectColorMode(inner)).toBe("dark");
    outer.className = "light";
    expect(detectColorMode(inner)).toBe("light");
    outer.className = "";
    // jsdom: no matchMedia → light.
    expect(detectColorMode(inner)).toBe("light");
  });

  it("renders the canvas light inside a light host and dark inside the dark app", async () => {
    const light = render(
      <div className="light">
        <ServiceMapView snapshot={shopFrame1()} height={300} />
      </div>
    );
    await act(async () => {});
    expect(
      light.container.querySelector(".react-flow")!.classList.contains("light")
    ).toBe(true);
    cleanup();

    document.documentElement.className = "dark";
    const dark = render(
      <ServiceMapView snapshot={shopFrame1()} height={300} />
    );
    await act(async () => {});
    expect(
      dark.container.querySelector(".react-flow")!.classList.contains("dark")
    ).toBe(true);
  });
});

describe('height="fill"', () => {
  it("re-measures when something above the map changes height, not only on window resize", async () => {
    let top = 100;
    const proto = HTMLElement.prototype;
    const prev = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      const t = this.classList.contains("sm-root") ? top : 0;
      return {
        top: t,
        left: 0,
        right: 0,
        bottom: t,
        width: 0,
        height: 0,
      } as DOMRect;
    };
    try {
      const { container } = render(
        <ServiceMapView snapshot={null} height="fill" />
      );
      await act(async () => {});
      const root = container.querySelector<HTMLElement>(".sm-root")!;
      expect(root.style.height).toBe(`${window.innerHeight - 100}px`);

      // A banner above the map grows by 50 px: the map moves down.
      top = 150;
      await act(async () => ControlledResizeObserver.fireAll());
      expect(root.style.height).toBe(`${window.innerHeight - 150}px`);
    } finally {
      proto.getBoundingClientRect = prev;
    }
  });
});
