import { z } from "zod";
import { dataSourceSchema } from "./component-catalog.js";

type Catalog = {
  name: string;
  components: Record<
    string,
    { hasChildren: boolean; description: string; props: unknown }
  >;
  uiTreeSchema: z.ZodTypeAny;
};

// Helper to format prop type from JSON schema property
function formatPropType(prop: {
  type?: string | string[];
  enum?: string[];
  items?: object;
}): string {
  if (prop.enum) return prop.enum.map((v) => `"${v}"`).join(" | ");
  if (Array.isArray(prop.type))
    return prop.type.filter((t) => t !== "null").join(" | ");
  if (prop.type === "array" && prop.items)
    return `array of ${formatPropType(prop.items as Parameters<typeof formatPropType>[0])}`;
  return prop.type ?? "unknown";
}

// Helper to format props from JSON schema
function formatPropsFromJsonSchema(jsonSchema: object): string {
  const schema = jsonSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (!schema.properties) return "(no props)";

  const required = new Set(schema.required ?? []);
  const lines: string[] = [];

  for (const [key, value] of Object.entries(schema.properties)) {
    const prop = value as {
      type?: string | string[];
      enum?: string[];
      description?: string;
      items?: object;
    };
    const isRequired = required.has(key);
    const typeStr = formatPropType(prop);
    const reqStr = isRequired ? " (required)" : " | null";
    const descStr = prop.description ? ` - ${prop.description}` : "";
    lines.push(`- ${key}: ${typeStr}${reqStr}${descStr}`);
  }
  return lines.join("\n");
}

// Helper to build example UI tree
function buildExampleElements(
  names: string[],
  components: Record<string, { hasChildren: boolean }>
): { root: string; elements: Record<string, unknown> } {
  const containerName =
    names.find((n) => components[n]?.hasChildren) ?? names[0];
  const containerKey = `${String(containerName).toLowerCase()}-1`;

  const childKeys: string[] = [];
  const elements: Record<string, unknown> = {};

  elements[containerKey] = {
    key: containerKey,
    type: String(containerName),
    props: {},
    children: childKeys,
  };

  const otherNames = names.filter((n) => n !== containerName).slice(0, 2);
  for (const name of otherNames) {
    const key = `${String(name).toLowerCase()}-1`;
    childKeys.push(key);
    elements[key] = {
      key,
      type: String(name),
      props: {},
      parentKey: containerKey,
      dataSource: {
        method: "searchTracesPage",
        params: { limit: 10 },
      },
    };
  }

  return { root: containerKey, elements };
}

// Helper to check if a value looks like the dataSource schema
function isDataSourceSchema(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.oneOf)) return false;
  const first = obj.oneOf[0] as Record<string, unknown> | undefined;
  if (!first?.properties) return false;
  const props = first.properties as Record<string, unknown>;
  const method = props.method as Record<string, unknown> | undefined;
  return method?.const === "searchTracesPage";
}

// Helper to recursively replace dataSource schema with $ref
function replaceDataSourceWithRef(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === "dataSource" && isDataSourceSchema(value)) {
      record[key] = { $ref: "#/$defs/DataSource" };
    } else if (value && typeof value === "object") {
      replaceDataSourceWithRef(value);
    }
  }
}

// Helper to build unified schema with $defs
function buildUnifiedSchema(treeSchema: z.ZodTypeAny): object {
  const dataSourceJsonSchema = z.toJSONSchema(dataSourceSchema);
  const treeJsonSchema = z.toJSONSchema(treeSchema) as Record<string, unknown>;

  replaceDataSourceWithRef(treeJsonSchema);
  treeJsonSchema.$defs = { DataSource: dataSourceJsonSchema };

  return treeJsonSchema;
}

/**
 * Generates LLM prompt instructions from a catalog.
 * Includes component docs, JSON schema, and usage examples.
 *
 * @param catalog - The catalog created via createCatalog
 * @returns Markdown string with component docs, schema, and examples
 *
 * @example
 * ```ts
 * const instructions = generatePromptInstructions(catalog);
 * const prompt = `Build a dashboard UI.\n\n${instructions}`;
 * ```
 */
export function generatePromptInstructions(catalog: Catalog): string {
  const componentNames = Object.keys(catalog.components);

  const componentSections = componentNames
    .map((name) => {
      const def = catalog.components[name]!;
      const propsSchema = z.toJSONSchema(def.props as z.ZodTypeAny);
      const propsFormatted = formatPropsFromJsonSchema(propsSchema);
      const roleLine = def.hasChildren
        ? "Accepts children: yes"
        : "Accepts dataSource: yes";

      return `### ${name}
${def.description ?? "No description"}

Props:
${propsFormatted}
${roleLine}`;
    })
    .join("\n\n---\n\n");

  const unifiedSchema = buildUnifiedSchema(catalog.uiTreeSchema);
  const exampleElements = buildExampleElements(
    componentNames,
    catalog.components
  );

  return `## Available Components

${componentSections}

---

## Output Schema

${JSON.stringify(unifiedSchema)}

---

## Example

${JSON.stringify(exampleElements)}`;
}
