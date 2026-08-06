/**
 * Color palette utilities for trace visualization
 * Generates consistent colors for service names using HSL color space
 */

/**
 * djb2. Deliberately a hand-rolled hash rather than anything host-provided: a
 * service has to keep the same colour across reloads, processes and machines,
 * so this must never depend on insertion order or a per-process hash seed.
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

const SATURATION = 70;
const LIGHTNESS = 50;
// Lifted well above LIGHTNESS so a label stays legible on the dark background
// and on top of getServiceTint. At LIGHTNESS a blue-ish hue lands near 2:1
// against --background (0 0% 3.9%); at 72 the worst hue clears WCAG AA.
const LABEL_LIGHTNESS = 72;
// Faint enough that LABEL_LIGHTNESS keeps its contrast against the page
// background, strong enough that the chip still reads as a filled shape.
const TINT_ALPHA = 0.14;

/**
 * The single hue every colour below is derived from. Sharing one basis is what
 * lets a tint, a label and a solid bar read as the same service; deriving any
 * of them from its own hash would let them drift apart on a rename.
 */
function getServiceHue(serviceName: string): number {
  return hashString(serviceName) % 360;
}

/**
 * Opaque colour for a service — bars, dots, borders.
 *
 * Do not build a translucent variant by appending a hex alpha suffix to this
 * string. `hsl(...)20` is not a parseable CSS colour, and the two engines
 * disagree about it on the property-assignment path React uses for inline
 * styles: Chromium discards the declaration, while WebKit accepts it and
 * resolves it to the *opaque* colour — which is how KOP-29 shipped a chip
 * painted over its own same-coloured label. Use getServiceTint instead.
 */
export function getServiceColor(serviceName: string): string {
  return `hsl(${getServiceHue(serviceName)}, ${SATURATION}%, ${LIGHTNESS}%)`;
}

/**
 * getServiceColor at an alpha, for fills sitting behind content. Same hue,
 * saturation and lightness, so a tinted fill and a solid one read as the same
 * service.
 */
export function getServiceTint(
  serviceName: string,
  alpha: number = TINT_ALPHA
): string {
  return `hsl(${getServiceHue(serviceName)} ${SATURATION}% ${LIGHTNESS}% / ${alpha})`;
}

/**
 * Text colour for a label on a getServiceTint fill. Shares the hue with
 * getServiceColor but is deliberately lighter — flattening the two back
 * together is what made service names unreadable on the traces page.
 */
export function getServiceLabelColor(serviceName: string): string {
  return `hsl(${getServiceHue(serviceName)} ${SATURATION}% ${LABEL_LIGHTNESS}%)`;
}

export const ERROR_COLOR = "#ef4444";

/**
 * Bar colour for a span in the waterfall. An error drops the per-service hue
 * for one shared red, so a failing span is findable without first learning
 * which hue belongs to which service.
 */
export function getSpanBarColor(serviceName: string, isError: boolean): string {
  if (isError) {
    return ERROR_COLOR;
  }
  return getServiceColor(serviceName);
}
