type AttributeValue = string | number | boolean;

/**
 * Coerce a string attribute value to its appropriate JS type.
 * ClickHouse Map(String, String) stores all values as strings; this recovers
 * booleans and numbers for the kopai-mono response schema.
 */
export function coerceAttributeValue(value: string): AttributeValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

/**
 * Convert a ClickHouse Map(String, String) (returned as Record<string, string>)
 * to Record<string, string | number | boolean> with type coercion.
 */
export function coerceAttributes(
  attrs: Record<string, string> | undefined | null
): Record<string, AttributeValue> | undefined {
  if (!attrs || typeof attrs !== "object") return undefined;
  const result: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    result[key] = coerceAttributeValue(String(value));
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Convert an Array(Map(String, String)) to Record<string, AttributeValue>[].
 */
export function coerceAttributesArray(
  arr: Record<string, string>[] | undefined | null
): Record<string, AttributeValue>[] | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  return arr.map((item) => {
    const result: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(item)) {
      result[key] = coerceAttributeValue(String(value));
    }
    return result;
  });
}
