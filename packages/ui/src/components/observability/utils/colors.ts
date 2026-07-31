/**
 * Color palette utilities for trace visualization
 * Generates consistent colors for service names using HSL color space
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
// and on top of getServiceTint.
const LABEL_LIGHTNESS = 72;

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

/** The same colour at a given alpha, for fills sitting behind content. */
export function getServiceTint(serviceName: string, alpha: number): string {
  return `hsl(${getServiceHue(serviceName)} ${SATURATION}% ${LIGHTNESS}% / ${alpha})`;
}

/** Text colour for a label on a getServiceTint fill. */
export function getServiceLabelColor(serviceName: string): string {
  return `hsl(${getServiceHue(serviceName)} ${SATURATION}% ${LABEL_LIGHTNESS}%)`;
}

export const ERROR_COLOR = "#ef4444";

export function getSpanBarColor(serviceName: string, isError: boolean): string {
  if (isError) {
    return ERROR_COLOR;
  }
  return getServiceColor(serviceName);
}
