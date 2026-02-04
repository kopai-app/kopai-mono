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

type ElementSchema<Props> = z.ZodObject<{
  key: z.ZodString;
  type: z.ZodString;
  children: z.ZodArray<z.ZodString>;
  parentKey: z.ZodString;
  dataSource: z.ZodOptional<typeof dataSourceSchema>;
  props: Props extends z.ZodTypeAny ? Props : z.ZodTypeAny;
}>;

type ElementsShape<C extends Record<string, { props: unknown }>> = {
  [K in keyof C]: ElementSchema<C[K]["props"]>;
};

export function createSimpleCatalog<
  C extends Record<string, z.infer<typeof componentDefinitionSchema>>,
>(catalogConfig: { name: string; components: C }) {
  const elementsShape = Object.fromEntries(
    Object.entries(catalogConfig.components).map(
      ([catalogItemName, catalogItemSchema]) => [
        catalogItemName,
        z.object({
          key: z.string(),
          type: z.string(),
          children: z.array(z.string()),
          parentKey: z.string(),
          dataSource: dataSourceSchema.optional(),
          props: catalogItemSchema.props as z.ZodTypeAny,
        }),
      ]
    )
  ) as ElementsShape<C>;

  const elements = z.object(elementsShape);

  const uiTreeSchema = z.object({
    root: z.string().describe("root uiElement key in the elements array"),
    elements,
  });

  return {
    name: catalogConfig.name,
    components: catalogConfig.components,
    uiTreeSchema,
  };
}
