import { z } from "zod";
import { dataFilterSchemas } from "@kopai/core";

// DataSource schema - discriminated union with type-safe params per method
export const dataSourceSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("searchTracesPage"),
    params: dataFilterSchemas.tracesDataFilterSchema,
  }),
  z.object({
    method: z.literal("searchLogsPage"),
    params: dataFilterSchemas.logsDataFilterSchema,
  }),
  z.object({
    method: z.literal("searchMetricsPage"),
    params: dataFilterSchemas.metricsDataFilterSchema,
  }),
  z.object({
    method: z.literal("getTrace"),
    params: z.object({ traceId: z.string() }),
  }),
  z.object({
    method: z.literal("discoverMetrics"),
    params: z.object({}).optional(),
  }),
]);

export type DataSource = z.infer<typeof dataSourceSchema>;

export type ComponentSchema = z.ZodType<Record<string, unknown>>;

// UIElement type - defined independently to avoid circular references
export type UIElement<
  T extends string = string,
  P = Record<string, unknown>,
> = {
  key: string;
  type: T;
  props: P;
  children?: string[];
  parentKey?: string | null;
  dataSource?: DataSource;
};

// UITree type - defined independently to avoid circular references
export type UITree = {
  root: string;
  elements: Record<string, UIElement>;
};

// Type guard for tuple with at least 2 elements
function hasAtLeastTwo<T>(arr: T[]): arr is [T, T, ...T[]] {
  return arr.length >= 2;
}

// Helper to build discriminated element schema with component-specific prop validation
function createDiscriminatedElementSchema(
  components: Record<string, ComponentDefinition>
): z.ZodType<UIElement> {
  const componentNames = Object.keys(components);

  if (componentNames.length === 0) {
    return uiElementSchema;
  }

  const variants = componentNames.map((name) => {
    const def = components[name]!;
    return z.object({
      key: z.string(),
      type: z.literal(name),
      props: def.props,
      children: z.array(z.string()).optional(),
      parentKey: z.string().nullable().optional(),
      dataSource: dataSourceSchema.optional(),
    });
  });

  if (variants.length === 1) {
    return variants[0] as z.ZodType<UIElement>;
  }

  if (hasAtLeastTwo(variants)) {
    return z.discriminatedUnion("type", variants) as z.ZodType<UIElement>;
  }

  return uiElementSchema; // unreachable but satisfies TS
}

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
  names: (string | number | symbol)[],
  components: Record<string, ComponentDefinition>
): UITree {
  const containerName =
    names.find((n) => components[n as string]?.hasChildren) ?? names[0];
  const containerKey = `${String(containerName).toLowerCase()}-1`;

  const childKeys: string[] = [];
  const elements: Record<string, UIElement> = {};

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

// Helper to check if a value looks like the dataSource schema (has oneOf with method discriminator)
function isDataSourceSchema(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.oneOf)) return false;
  // Check if first item has method property with const
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
function buildUnifiedSchema(
  treeSchema: z.ZodType<UITree>,
  dsSchema: z.ZodType<DataSource>
): object {
  const dataSourceJsonSchema = z.toJSONSchema(dsSchema);
  const treeJsonSchema = z.toJSONSchema(treeSchema) as Record<string, unknown>;

  // Replace embedded dataSource with $ref
  replaceDataSourceWithRef(treeJsonSchema);

  // Add DataSource to $defs
  treeJsonSchema.$defs = { DataSource: dataSourceJsonSchema };

  return treeJsonSchema;
}

// UIElement schema factory - creates schema with specific component type enums
export const createUIElementSchema = <T extends string>(
  componentTypes: readonly [T, ...T[]]
): z.ZodType<UIElement<T>> =>
  z.object({
    key: z.string(),
    type: z.enum(componentTypes),
    props: z.record(z.string(), z.unknown()),
    children: z.array(z.string()).optional(),
    parentKey: z.string().nullable().optional(),
    dataSource: dataSourceSchema.optional(),
  }) as z.ZodType<UIElement<T>>;

// Base schema for unknown component types
export const uiElementSchema: z.ZodType<UIElement> = z.object({
  key: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.unknown()),
  children: z.array(z.string()).optional(),
  parentKey: z.string().nullable().optional(),
  dataSource: dataSourceSchema.optional(),
}) as z.ZodType<UIElement>;

// UITree schema factory
export const createUITreeSchema = <T extends string>(
  componentTypes: readonly [T, ...T[]]
): z.ZodType<UITree> =>
  z.object({
    root: z.string(),
    elements: z.record(z.string(), createUIElementSchema(componentTypes)),
  }) as z.ZodType<UITree>;

// Base schema
export const uiTreeSchema: z.ZodType<UITree> = z.object({
  root: z.string(),
  elements: z.record(z.string(), uiElementSchema),
}) as z.ZodType<UITree>;

// ComponentDefinition schema
export const componentDefinitionSchema = z.object({
  props: z.custom<z.ZodType<Record<string, unknown>>>(
    (val) => val instanceof z.ZodType
  ),
  hasChildren: z.boolean().optional(),
  description: z.string().optional(),
});

// Keep generic type for inference
export type ComponentDefinition<
  TProps extends ComponentSchema = ComponentSchema,
> = {
  props: TProps;
  hasChildren?: boolean;
  description?: string;
};

// CatalogConfig schema
export const catalogConfigSchema = z.object({
  name: z.string().optional(),
  components: z.record(z.string(), componentDefinitionSchema),
});

// Keep generic type for inference
export type CatalogConfig<
  TComponents extends Record<string, ComponentDefinition> = Record<
    string,
    ComponentDefinition
  >,
> = {
  name?: string;
  components: TComponents;
};

export function createCatalog<
  TComponents extends Record<string, ComponentDefinition>,
>(config: CatalogConfig<TComponents>): Catalog<TComponents> {
  const { name = "unnamed", components } = config;

  const componentNames = Object.keys(components) as (keyof TComponents)[];

  // Build discriminated union schema for component-specific prop validation
  const elementSchema = createDiscriminatedElementSchema(components);
  const treeSchema = z.object({
    root: z.string(),
    elements: z.record(z.string(), elementSchema),
  }) as z.ZodType<UITree>;

  return {
    name,
    componentNames,
    components,
    elementSchema,
    treeSchema,

    hasComponent(type: string) {
      return type in components;
    },

    validateElement(element: unknown) {
      const result = elementSchema.safeParse(element);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false, error: result.error };
    },

    validateTree(tree: unknown) {
      const result = treeSchema.safeParse(tree);
      if (result.success) {
        return { success: true, data: result.data };
      }
      return { success: false, error: result.error };
    },

    toPromptInstructions() {
      const componentSections = componentNames
        .map((name) => {
          const def = components[name as string]!;
          const propsSchema = z.toJSONSchema(def.props);
          const propsFormatted = formatPropsFromJsonSchema(propsSchema);
          const roleLine = def.hasChildren
            ? "Accepts children: yes"
            : "Accepts dataSource: yes";

          return `### ${String(name)}
${def.description ?? "No description"}

Props:
${propsFormatted}
${roleLine}`;
        })
        .join("\n\n---\n\n");

      const unifiedSchema = buildUnifiedSchema(treeSchema, dataSourceSchema);
      const exampleElements = buildExampleElements(componentNames, components);

      return `## Available Components

${componentSections}

---

## Output Schema

${JSON.stringify(unifiedSchema)}

---

## Example

${JSON.stringify(exampleElements)}`;
    },
  };
}

export interface Catalog<
  TComponents extends Record<string, ComponentDefinition> = Record<
    string,
    ComponentDefinition
  >,
> {
  /** Catalog name */
  readonly name: string;
  /** Component names */
  readonly componentNames: (keyof TComponents)[];
  /** Component definitions */
  readonly components: TComponents;
  /** Full element schema for AI generation */
  readonly elementSchema: z.ZodType<UIElement>;
  /** Full UI tree schema */
  readonly treeSchema: z.ZodType<UITree>;
  /** Check if component exists */
  hasComponent(type: string): boolean;
  /** Validate an element */
  validateElement(element: unknown): {
    success: boolean;
    data?: UIElement;
    error?: z.ZodError;
  };
  /** Validate a UI tree */
  validateTree(tree: unknown): {
    success: boolean;
    data?: UITree;
    error?: z.ZodError;
  };
  /** Generate LLM prompt instructions for UI generation */
  toPromptInstructions(): string;
}
