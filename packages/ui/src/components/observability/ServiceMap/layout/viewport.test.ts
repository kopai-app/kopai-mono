import { describe, it, expect } from "vitest";
import { initialViewport, labelsVisible, truncateName } from "./viewport.js";
import { layoutFrames, type LayoutResult } from "./layout-d.js";
import { fixtureFrames } from "./fixtures.js";
import { FIT_PAD_X, FIT_PAD_Y } from "./constants.js";

const BOX = { width: 1200, height: 700 };
const last = (rs: LayoutResult[]) => rs[rs.length - 1] as LayoutResult;

describe("initialViewport", () => {
  it("one node: zoom 1, never past 100 %, centred on the node", () => {
    const r = last(layoutFrames(fixtureFrames("one")));
    const v = initialViewport(r.bounds, BOX, r.positions.get("my-app") ?? null);
    expect(v.fit).toBeGreaterThan(1);
    expect(v.zoom).toBe(1);
    expect(v.centredOnHub).toBe(false);
    expect(v).toMatchObject({ x: 600, y: 350 });
  });

  it("empty map: zoom 1 at the origin", () => {
    const v = initialViewport(null, BOX, null);
    expect(v).toMatchObject({ x: 600, y: 350, zoom: 1, centredOnHub: false });
  });

  it("gen400 in 1200×700: fit < 0.4, opens centred on the hub at zoom 0.8", () => {
    const r = last(layoutFrames(fixtureFrames("gen400")));
    const hub = r.positions.get(r.state?.hub as string) ?? null;
    expect(hub).toEqual({ x: 0, y: 0 });
    const v = initialViewport(r.bounds, BOX, hub);
    expect(v.fit).toBeLessThan(0.4);
    expect(v.centredOnHub).toBe(true);
    expect(v.zoom).toBe(0.8);
    // the hub lands in the middle of the box
    expect(v.x).toBe(600);
    expect(v.y).toBe(350);
    // zooming out can show everything
    expect(v.minZoom).toBeLessThanOrEqual(v.fit);
  });

  it("a mid-size map fits whole at its fit scale, centred on the bounds", () => {
    const r = last(layoutFrames(fixtureFrames("shop20")));
    const b = r.bounds;
    expect(b).not.toBeNull();
    if (!b) return;
    const v = initialViewport(b, BOX, r.positions.get("api-gateway") ?? null);
    expect(v.fit).toBeGreaterThanOrEqual(0.4);
    expect(v.fit).toBeLessThan(1);
    expect(v.zoom).toBe(v.fit);
    expect(v.centredOnHub).toBe(false);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    expect(cx * v.zoom + v.x).toBeCloseTo(600);
    expect(cy * v.zoom + v.y).toBeCloseTo(350);
    // the padded map fits inside the box
    expect((b.maxX - b.minX + 2 * FIT_PAD_X) * v.zoom).toBeLessThanOrEqual(
      1200 + 1e-6
    );
    expect((b.maxY - b.minY + 2 * FIT_PAD_Y) * v.zoom).toBeLessThanOrEqual(
      700 + 1e-6
    );
  });
});

describe("labelsVisible", () => {
  it("hides labels that would render below 7.5 px", () => {
    expect(labelsVisible(0.6)).toBe(false);
    expect(labelsVisible(0.7)).toBe(true);
    expect(labelsVisible(1)).toBe(true);
    expect(labelsVisible(7.5 / 11.5)).toBe(true);
  });
});

describe("truncateName", () => {
  it("keeps names of up to 20 characters", () => {
    expect(truncateName("checkout")).toBe("checkout");
    expect(truncateName("a".repeat(20))).toBe("a".repeat(20));
  });

  it("cuts longer names to 20 characters plus …", () => {
    const t = truncateName("notifications-worker-eu-west-1");
    expect(t).toBe("notifications-worker…");
    expect(t).toHaveLength(21);
  });
});
