export type OutputFormat = "json" | "table";

export interface OutputOptions {
  format: OutputFormat;
  fields?: string[];
}

export function detectFormat(json?: boolean, table?: boolean): OutputFormat {
  if (json) return "json";
  if (table) return "table";
  // Default: table for TTY, JSON for pipes
  return process.stdout.isTTY ? "table" : "json";
}

function countAttributes(attr: { values: Record<string, string[]> }): number {
  return Object.keys(attr.values).length;
}

function filterFields<T extends object>(data: T, fields: string[]): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => fields.includes(key))
  ) as Partial<T>;
}

export function parseFields(fieldsStr?: string): string[] | undefined {
  if (!fieldsStr) return undefined;
  return fieldsStr.split(",").map((f) => f.trim());
}

function isMetricsDiscoverData(data: unknown[]): data is Array<{
  attributes: { values: Record<string, string[]> };
  resourceAttributes: { values: Record<string, string[]> };
}> {
  return (
    data.length > 0 &&
    typeof data[0] === "object" &&
    data[0] !== null &&
    "attributes" in data[0] &&
    "resourceAttributes" in data[0] &&
    typeof (data[0] as Record<string, unknown>).attributes === "object" &&
    (data[0] as Record<string, unknown>).attributes !== null &&
    "values" in ((data[0] as Record<string, unknown>).attributes as object)
  );
}

export function output<T>(data: T, opts: OutputOptions): void {
  let outputData = data;

  // Apply field filtering
  if (opts.fields && opts.fields.length > 0) {
    if (Array.isArray(data)) {
      outputData = data.map((item) =>
        typeof item === "object" && item !== null
          ? filterFields(item as object, opts.fields!)
          : item
      ) as T;
    } else if (typeof data === "object" && data !== null) {
      outputData = filterFields(data as object, opts.fields) as T;
    }
  }

  if (opts.format === "json") {
    console.log(JSON.stringify(outputData, null, 2));
  } else {
    if (Array.isArray(outputData)) {
      if (outputData.length === 0) {
        console.log("No results found.");
      } else if (!opts.fields && isMetricsDiscoverData(outputData)) {
        const transformed = outputData.map((m) => ({
          name: m.name,
          type: m.type,
          unit: m.unit,
          description: m.description,
          attrs: countAttributes(m.attributes),
          resourceAttrs: countAttributes(m.resourceAttributes),
        }));
        console.table(transformed);
        console.log("\nUse --json for full attribute details.");
      } else {
        console.table(outputData);
      }
    } else {
      console.log(outputData);
    }
  }
}

export function outputError(error: unknown, json: boolean): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };

  if (json) {
    console.error(JSON.stringify({ error: err }));
  } else {
    console.error(`Error: ${err.message}`);
  }
}
