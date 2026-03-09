export function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  if (Array.isArray(value) || typeof value === "object")
    return JSON.stringify(value, null, 2);
  return String(value);
}

export function formatSeriesLabel(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  if (entries.length === 1) return String(entries[0]![1]);
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

export function isComplexValue(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (Array.isArray(value) || Object.keys(value).length > 0)
  );
}
