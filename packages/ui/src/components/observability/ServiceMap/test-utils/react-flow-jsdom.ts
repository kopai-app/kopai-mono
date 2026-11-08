/**
 * The one shared jsdom setup for tests that mount React Flow (xyflow's
 * testing guide): jsdom has no layout engine, so React Flow cannot measure
 * its container or nodes without these stubs.
 *
 * `installReactFlowJsdom()` stubs `ResizeObserver`, `DOMMatrixReadOnly`
 * (parsing `scale(...)` into `m22`), non-zero
 * `HTMLElement.prototype.offsetWidth` / `offsetHeight`, and
 * `SVGElement.prototype.getBBox`, and returns a function that restores the
 * originals. Call it in `beforeAll` and the restore in `afterAll`.
 */

type Restore = () => void;

class ResizeObserverStub {
  private readonly cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    const el = target as HTMLElement;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    this.cb(
      [
        {
          target,
          contentRect: { width, height } as DOMRectReadOnly,
          borderBoxSize: [{ inlineSize: width, blockSize: height }],
          contentBoxSize: [{ inlineSize: width, blockSize: height }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}

/** Width/height from an inline `px` style when set, else a non-zero default. */
function styleSize(el: HTMLElement, prop: "width" | "height", dflt: number) {
  const raw = el.style?.[prop] ?? "";
  const v = raw.endsWith("px") ? parseFloat(raw) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

export function installReactFlowJsdom(
  size: { width: number; height: number } = { width: 1200, height: 700 }
): Restore {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevRO = g.ResizeObserver;
  const prevMatrix = g.DOMMatrixReadOnly;
  const proto = HTMLElement.prototype;
  const prevWidth = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  const prevHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  const svgProto = SVGElement.prototype as unknown as Record<string, unknown>;
  const hadBBox = Object.prototype.hasOwnProperty.call(svgProto, "getBBox");
  const prevBBox = svgProto.getBBox;

  g.ResizeObserver = ResizeObserverStub;
  g.DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return styleSize(this, "width", size.width);
    },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return styleSize(this, "height", size.height);
    },
  });
  svgProto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });

  return () => {
    g.ResizeObserver = prevRO;
    g.DOMMatrixReadOnly = prevMatrix;
    if (prevWidth) Object.defineProperty(proto, "offsetWidth", prevWidth);
    else delete (proto as unknown as Record<string, unknown>).offsetWidth;
    if (prevHeight) Object.defineProperty(proto, "offsetHeight", prevHeight);
    else delete (proto as unknown as Record<string, unknown>).offsetHeight;
    if (hadBBox) svgProto.getBBox = prevBBox;
    else delete svgProto.getBBox;
  };
}
