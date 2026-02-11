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

export function getServiceColor(serviceName: string): string {
  const hash = hashString(serviceName);
  const hue = hash % 360;
  const saturation = 70;
  const lightness = 50;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export const ERROR_COLOR = "#ef4444";

export function getSpanBarColor(serviceName: string, isError: boolean): string {
  if (isError) {
    return ERROR_COLOR;
  }
  return getServiceColor(serviceName);
}
