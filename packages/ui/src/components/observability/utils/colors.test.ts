import { describe, it, expect } from "vitest";
import {
  getServiceColor,
  getServiceTint,
  getServiceLabelColor,
  getSpanBarColor,
  ERROR_COLOR,
} from "./colors.js";

/**
 * Anchored, so a value with anything trailing it — `hsl(200, 70%, 50%)20`,
 * the shape that broke the traces page — fails to parse rather than being
 * quietly accepted. Handles both the legacy comma form and the modern
 * space/slash form.
 */
function parseHsl(css: string): { h: number; s: number; l: number; a: number } {
  const m =
    /^hsl\(\s*([\d.]+)\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(
      css
    );
  if (!m)
    throw new Error(`not a parseable hsl() colour: ${JSON.stringify(css)}`);
  return {
    h: Number(m[1]),
    s: Number(m[2]),
    l: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

type Rgb = [number, number, number];

/** HSL (h in degrees, s/l as percentages) to sRGB channels in 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: Rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = lig - c / 2;
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio. 4.5:1 is the AA threshold for body-size text. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over alpha blend, the way a browser paints a translucent fill. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const mix = (f: number, b: number) => alpha * f + (1 - alpha) * b;
  return [mix(fg[0], bg[0]), mix(fg[1], bg[1]), mix(fg[2], bg[2])];
}

// --background in src/styles/globals.css. The app defines only this palette —
// :root is dark and there is no light theme to fall back to.
const PAGE_BACKGROUND: Rgb = hslToRgb(0, 0, 3.9);

const SERVICES = [
  "cart",
  "checkout",
  "frontend",
  "payment-gateway",
  "shipping",
  "email",
  "ad",
  "recommendation",
  "quote",
  "currency",
  "",
];

describe("service colour palette", () => {
  it("returns parseable CSS colours", () => {
    for (const name of SERVICES) {
      expect(() => parseHsl(getServiceColor(name))).not.toThrow();
      expect(() => parseHsl(getServiceTint(name))).not.toThrow();
      expect(() => parseHsl(getServiceLabelColor(name))).not.toThrow();
    }
  });

  it("is stable for a given service name", () => {
    for (const name of SERVICES) {
      expect(getServiceColor(name)).toBe(getServiceColor(name));
      expect(getServiceLabelColor(name)).toBe(getServiceLabelColor(name));
    }
  });

  it("spreads distinct services across distinct hues", () => {
    const hues = new Set(
      SERVICES.map((name) => parseHsl(getServiceColor(name)).h)
    );
    expect(hues.size).toBeGreaterThan(SERVICES.length / 2);
  });

  // The reason getServiceTint exists. Appending a hex alpha suffix was how the
  // chip fill used to be built. No engine accepts it *as a tint* — Chromium
  // discards it, WebKit resolves it to the opaque colour — so pin that the
  // concatenation still produces something unparseable.
  it("cannot be given an alpha by string concatenation", () => {
    expect(() => parseHsl(`${getServiceColor("cart")}20`)).toThrow();
  });
});

describe("getServiceTint", () => {
  it("matches getServiceColor exactly apart from alpha, so a tinted fill and a solid one read as one service", () => {
    for (const name of SERVICES) {
      const solid = parseHsl(getServiceColor(name));
      const tint = parseHsl(getServiceTint(name));
      expect(tint.h).toBe(solid.h);
      expect(tint.s).toBe(solid.s);
      expect(tint.l).toBe(solid.l);
      expect(tint.a).toBeLessThan(1);
    }
  });

  it("defaults to a translucent alpha and honours an override", () => {
    const def = parseHsl(getServiceTint("cart")).a;
    expect(def).toBeGreaterThan(0);
    expect(def).toBeLessThan(1);
    expect(parseHsl(getServiceTint("cart", 0.5)).a).toBe(0.5);
  });
});

describe("getServiceLabelColor", () => {
  it("shares the hue with getServiceColor", () => {
    for (const name of SERVICES) {
      expect(parseHsl(getServiceLabelColor(name)).h).toBe(
        parseHsl(getServiceColor(name)).h
      );
    }
  });

  // Guards the KOP-29 fix directly: collapsing the label back onto
  // getServiceColor is what made service names unreadable on the dark page.
  it("is lighter than getServiceColor", () => {
    for (const name of SERVICES) {
      expect(parseHsl(getServiceLabelColor(name)).l).toBeGreaterThan(
        parseHsl(getServiceColor(name)).l
      );
    }
  });

  it("clears WCAG AA against a chip fill on the page background, for every hue", () => {
    const failures: string[] = [];
    for (let hue = 0; hue < 360; hue++) {
      // Reconstruct a chip at this hue from the real palette values rather
      // than trusting one service name to land on the worst case.
      const sample = parseHsl(getServiceLabelColor("cart"));
      const fill = parseHsl(getServiceTint("cart"));
      const label = hslToRgb(hue, sample.s, sample.l);
      const chipBg = composite(
        hslToRgb(hue, fill.s, fill.l),
        fill.a,
        PAGE_BACKGROUND
      );
      const ratio = contrastRatio(label, chipBg);
      if (ratio < 4.5) failures.push(`hue ${hue}: ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });
});

describe("getSpanBarColor", () => {
  it("uses the service colour when the span is healthy", () => {
    expect(getSpanBarColor("cart", false)).toBe(getServiceColor("cart"));
  });

  it("overrides the service colour for errors", () => {
    expect(getSpanBarColor("cart", true)).toBe(ERROR_COLOR);
  });
});
