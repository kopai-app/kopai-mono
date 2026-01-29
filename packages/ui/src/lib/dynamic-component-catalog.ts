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

export interface ComponentDefinition<
  TProps extends ComponentSchema = ComponentSchema,
> {
  /** Zod schema for component props */
  props: TProps;
  /** Whether this component can have children */
  hasChildren?: boolean;
  /** Description for AI generation */
  description?: string;
}

export interface ActionDefinition<TParams = Record<string, unknown>> {
  /** Zod schema for params validation */
  params?: z.ZodType<TParams>;
  /** Description for AI */
  description?: string;
}

export interface CatalogConfig<
  TComponents extends Record<string, ComponentDefinition> = Record<
    string,
    ComponentDefinition
  >,
  TActions extends Record<string, ActionDefinition> = Record<
    string,
    ActionDefinition
  >,
> {
  /** Catalog name */
  name?: string;
  /** Component definitions */
  components: TComponents;
  /** Action definitions with param schemas */
  actions?: TActions; // TODO: maybe this should go to the component itself
}

/**
 * Flat UI tree structure (optimized for LLM generation)
 */
export interface UITree {
  /** Root element key */
  root: string;
  /** Flat map of elements by key */
  elements: Record<string, UIElement>;
}

export interface UIElement<
  T extends string = string,
  P = Record<string, unknown>,
> {
  /** Unique key for reconciliation */
  key: string;
  /** Component type from the catalog */
  type: T;
  /** Component props */
  props: P;
  /** Child element keys (flat structure) */
  children?: string[];
  /** Parent element key (null for root) */
  parentKey?: string | null;
  /** Data source for fetching data */
  dataSource?: DataSource;
}

export function createCatalog<
  TComponents extends Record<string, ComponentDefinition>,
  TActions extends Record<string, ActionDefinition> = Record<
    string,
    ActionDefinition
  >,
>(
  config: CatalogConfig<TComponents, TActions>
): Catalog<TComponents, TActions> {
  const { name = "unnamed", components, actions = {} as TActions } = config;

  const componentNames = Object.keys(components) as (keyof TComponents)[];
  const actionNames = Object.keys(actions) as (keyof TActions)[];

  // Create element schema for each component type
  const componentSchemas = componentNames.map((componentName) => {
    const def = components[componentName]!;

    return z.object({
      key: z.string(),
      type: z.literal(componentName as string),
      props: def.props,
      children: z.array(z.string()).optional(),
      parentKey: z.string().nullable().optional(),
      dataSource: dataSourceSchema.optional(),
    });
  });

  // Create union schema for all components
  let elementSchema: z.ZodType<UIElement>;

  if (componentSchemas.length === 0) {
    elementSchema = z.object({
      key: z.string(),
      type: z.string(),
      props: z.record(z.string(), z.unknown()),
      children: z.array(z.string()).optional(),
      parentKey: z.string().nullable().optional(),
      dataSource: dataSourceSchema.optional(),
    }) as unknown as z.ZodType<UIElement>;
  } else if (componentSchemas.length === 1) {
    elementSchema = componentSchemas[0] as unknown as z.ZodType<UIElement>;
  } else {
    elementSchema = z.discriminatedUnion("type", [
      componentSchemas[0] as z.ZodObject<any>,
      componentSchemas[1] as z.ZodObject<any>,
      ...(componentSchemas.slice(2) as z.ZodObject<any>[]),
    ]) as unknown as z.ZodType<UIElement>;
  }

  // Create tree schema
  const treeSchema = z.object({
    root: z.string(),
    elements: z.record(z.string(), elementSchema),
  }) as unknown as z.ZodType<UITree>;

  return {
    name,
    componentNames,
    actionNames,
    components,
    actions,
    elementSchema,
    treeSchema,

    hasComponent(type: string) {
      return type in components;
    },

    hasAction(name: string) {
      return name in actions;
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
  };
}

export interface Catalog<
  TComponents extends Record<string, ComponentDefinition> = Record<
    string,
    ComponentDefinition
  >,
  TActions extends Record<string, ActionDefinition> = Record<
    string,
    ActionDefinition
  >,
> {
  /** Catalog name */
  readonly name: string;
  /** Component names */
  readonly componentNames: (keyof TComponents)[];
  /** Action names */
  readonly actionNames: (keyof TActions)[];
  /** Component definitions */
  readonly components: TComponents;
  /** Action definitions */
  readonly actions: TActions;
  /** Full element schema for AI generation */
  readonly elementSchema: z.ZodType<UIElement>;
  /** Full UI tree schema */
  readonly treeSchema: z.ZodType<UITree>;
  /** Check if component exists */
  hasComponent(type: string): boolean;
  /** Check if action exists */
  hasAction(name: string): boolean;
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
}
