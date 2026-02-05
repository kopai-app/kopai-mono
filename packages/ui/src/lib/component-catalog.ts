import { z } from "zod";
import { dataFilterSchemas } from "@kopai/core";
import type { ReactNode } from "react";

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

export const componentDefinitionSchema = z
  .object({
    hasChildren: z.boolean(),
    description: z
      .string()
      .describe(
        "Component description to be displayed by the prompt generator"
      ),
    props: z.unknown(),
  })
  .describe(
    "All options and properties necessary to render the React component with renderer"
  );

export const catalogConfigSchema = z.object({
  name: z.string().describe("catalog name"),
  components: z.record(
    z.string().describe("React component name"),
    componentDefinitionSchema
  ),
});

// Union of all element types with literal type discriminator
export type InferredElement<C extends Record<string, { props: unknown }>> = {
  [K in keyof C & string]: {
    key: string;
    type: K;
    children: string[];
    parentKey: string;
    dataSource?: z.infer<typeof dataSourceSchema>;
    props: C[K]["props"] extends z.ZodTypeAny
      ? z.infer<C[K]["props"]>
      : unknown;
  };
}[keyof C & string];

// Zod schema type for a single element variant (preserves K-to-props mapping)
type ElementVariantSchema<
  K extends string,
  Props extends z.ZodTypeAny,
> = z.ZodObject<{
  key: z.ZodString;
  type: z.ZodLiteral<K>;
  children: z.ZodArray<z.ZodString>;
  parentKey: z.ZodString;
  dataSource: z.ZodOptional<typeof dataSourceSchema>;
  props: Props;
}>;

// Union of all element variant schemas
type ElementVariantSchemas<C extends Record<string, { props: unknown }>> = {
  [K in keyof C & string]: ElementVariantSchema<
    K,
    C[K]["props"] extends z.ZodTypeAny ? C[K]["props"] : z.ZodUnknown
  >;
}[keyof C & string];

export function createCatalog<
  C extends Record<string, z.infer<typeof componentDefinitionSchema>>,
>(catalogConfig: { name: string; components: C }) {
  const elementVariants = (
    Object.keys(catalogConfig.components) as (keyof C & string)[]
  )
    .map((catalogItemName) => ({
      catalogItemName,
      component: catalogConfig.components[catalogItemName],
    }))
    .filter(
      (
        itemConfig
      ): itemConfig is typeof itemConfig & { component: C[keyof C] } =>
        !!itemConfig.component
    )
    .map(({ catalogItemName, component }) =>
      z.object({
        key: z.string(),
        type: z.literal(catalogItemName),
        children: z.array(z.string()),
        parentKey: z.string(),
        dataSource: dataSourceSchema.optional(),
        props: component.props,
      })
    );

  type Schemas = ElementVariantSchemas<C>;
  const elementsUnion = z.discriminatedUnion(
    "type",
    elementVariants as unknown as [Schemas, ...Schemas[]]
  );

  // TODO: implement a mechanism for validating there are no circular references
  const uiTreeSchema = z.object({
    root: z.string().describe("root uiElement key in the elements array"),
    elements: z.record(
      z.string().describe("equal to the element key"),
      elementsUnion
    ),
  });

  return {
    name: catalogConfig.name,
    components: catalogConfig.components,
    uiTreeSchema,
  };
}

export type ComponentDefinition = z.infer<typeof componentDefinitionSchema>;

export type InferProps<P> = P extends z.ZodTypeAny ? z.infer<P> : P;

export type CatalogueComponentProps<CD extends ComponentDefinition> =
  CD extends { hasChildren: true; props: infer P }
    ? { element: { props: InferProps<P> }; children: ReactNode }
    : CD extends { props: infer P }
      ? { element: { props: InferProps<P> } }
      : never;
