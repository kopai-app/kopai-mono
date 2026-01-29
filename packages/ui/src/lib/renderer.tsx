import { type ComponentType, type ReactNode } from "react";
import type { z } from "zod";
import type {
  Catalog,
  ComponentDefinition,
  UIElement,
  UITree,
} from "./dynamic-component-catalog.js";
import { useKopaiData } from "./use-kopai-data.js";

/**
 * Base props (no dataSource)
 */
export interface ComponentRenderPropsBase<P = Record<string, unknown>> {
  element: UIElement<string, P>;
  children?: ReactNode;
  hasData: false;
}

/**
 * Props with dataSource
 */
export interface ComponentRenderPropsWithData<P = Record<string, unknown>> {
  element: UIElement<string, P>;
  children?: ReactNode;
  hasData: true;
  data: unknown;
  loading: boolean;
  error: Error | null;
  refetch: (newParams?: Record<string, unknown>) => void;
}

/**
 * Discriminated union for component render props
 */
export type ComponentRenderProps<P = Record<string, unknown>> =
  | ComponentRenderPropsBase<P>
  | ComponentRenderPropsWithData<P>;

/**
 * Component renderer type
 */
export type ComponentRenderer<P = Record<string, unknown>> = ComponentType<
  ComponentRenderProps<P>
>;

/**
 * Registry mapping component type names to React components
 */
export type ComponentRegistry = Record<
  string,
  ComponentRenderer<Record<string, unknown>>
>;

/**
 * Derives a type-safe ComponentRegistry from a Catalog.
 * Ensures each component's props match the zod schema.
 */
export type RegistryFromCatalog<
  TComponents extends Record<string, ComponentDefinition>,
> = {
  [K in keyof TComponents]: ComponentRenderer<z.infer<TComponents[K]["props"]>>;
};

/**
 * Props for the Renderer component
 */
export interface RendererProps {
  tree: UITree | null;
  registry: ComponentRegistry;
  fallback?: ComponentRenderer;
}

/**
 * Wrapper component for elements with dataSource
 */
function DataSourceElement({
  element,
  Component,
  children,
}: {
  element: UIElement;
  Component: ComponentRenderer;
  children?: ReactNode;
}) {
  const { data, loading, error, refetch } = useKopaiData(element.dataSource);
  return (
    <Component
      element={element}
      hasData={true}
      data={data}
      loading={loading}
      error={error}
      refetch={refetch}
    >
      {children}
    </Component>
  );
}

/**
 * Internal element renderer - recursively renders elements and children
 */
function ElementRenderer({
  element,
  tree,
  registry,
  fallback,
}: {
  element: UIElement;
  tree: UITree;
  registry: ComponentRegistry;
  fallback?: ComponentRenderer;
}) {
  const Component = registry[element.type] ?? fallback;

  if (!Component) {
    console.warn(`No renderer for component type: ${element.type}`);
    return null;
  }

  const children = element.children?.map((childKey) => {
    const childElement = tree.elements[childKey];
    if (!childElement) return null;
    return (
      <ElementRenderer
        key={childKey}
        element={childElement}
        tree={tree}
        registry={registry}
        fallback={fallback}
      />
    );
  });

  // If element has dataSource, wrap with data fetching
  if (element.dataSource) {
    return (
      <DataSourceElement element={element} Component={Component}>
        {children}
      </DataSourceElement>
    );
  }

  // Otherwise render directly (no data)
  return (
    <Component element={element} hasData={false}>
      {children}
    </Component>
  );
}

/**
 * Renders a UITree using a component registry
 */
export function Renderer({ tree, registry, fallback }: RendererProps) {
  if (!tree || !tree.root) return null;

  const rootElement = tree.elements[tree.root];
  if (!rootElement) return null;

  return (
    <ElementRenderer
      element={rootElement}
      tree={tree}
      registry={registry}
      fallback={fallback}
    />
  );
}

/**
 * Creates a pre-bound Renderer from a Catalog and type-safe registry.
 * Enforces that registry components match catalog schema definitions.
 */
export function createRendererFromCatalog<
  TComponents extends Record<string, ComponentDefinition>,
>(
  _catalog: Catalog<TComponents>,
  registry: RegistryFromCatalog<TComponents>,
  fallback?: ComponentRenderer
): ComponentType<{ tree: UITree | null }> {
  return function CatalogRenderer({ tree }) {
    return (
      <Renderer
        tree={tree}
        registry={registry as ComponentRegistry}
        fallback={fallback}
      />
    );
  };
}
