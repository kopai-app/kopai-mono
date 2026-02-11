import {
  useState,
  useMemo,
  useCallback,
  type ReactNode,
  type ComponentType,
} from "react";
import {
  createCatalog,
  type InferProps,
  type ComponentDefinition,
} from "./component-catalog.js";
import z from "zod";
import { useKopaiData } from "../hooks/use-kopai-data.js";
import type { DataSource } from "./component-catalog.js";

type RegistryFromCatalog<
  C extends { components: Record<string, ComponentDefinition> },
> = {
  [K in keyof C["components"]]: ComponentType<
    RendererComponentProps<C["components"][K]>
  >;
};

type Catalog = ReturnType<typeof createCatalog>;

type UITree = z.infer<Catalog["uiTreeSchema"]>;

type UIElement = UITree["elements"][string];

// Simplified - renderer just passes through to useKopaiData
type RendererDataSource = {
  method: string;
  params?: Record<string, unknown>;
};

type BaseElement<Props> = {
  key: string;
  type: string;
  children: string[];
  parentKey: string;
  dataSource?: RendererDataSource;
  props: Props;
};

type WithData = {
  hasData: true;
  data: unknown;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  updateParams: (params: Record<string, unknown>) => void;
};

type WithoutData = {
  hasData: false;
};

export type RendererComponentProps<CD extends ComponentDefinition> =
  CD extends {
    hasChildren: true;
    props: infer P;
  }
    ?
        | ({
            element: BaseElement<InferProps<P>>;
            children: ReactNode;
          } & WithoutData)
        | ({
            element: BaseElement<InferProps<P>>;
            children: ReactNode;
          } & WithData)
    : CD extends { props: infer P }
      ?
          | ({ element: BaseElement<InferProps<P>> } & WithoutData)
          | ({ element: BaseElement<InferProps<P>> } & WithData)
      : never;

/**
 * Base props (no dataSource)
 */
export interface ComponentRenderPropsBase {
  element: UIElement;
  children?: ReactNode;
  hasData: false;
}

/**
 * Props with dataSource
 */
export interface ComponentRenderPropsWithData {
  element: UIElement;
  children?: ReactNode;
  hasData: true;
  data: unknown;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  updateParams: (params: Record<string, unknown>) => void;
}

/**
 * Discriminated union for component render props
 */
export type ComponentRenderProps =
  | ComponentRenderPropsBase
  | ComponentRenderPropsWithData;

/**
 * Component renderer type
 */
export type ComponentRenderer = ComponentType<ComponentRenderProps>;

/**
 * Registry mapping component type names to React components
 */
type ComponentRegistry = Record<string, ComponentRenderer>;

/**
 * Creates a typed Renderer component bound to a catalog and component implementations.
 *
 * @param _catalog - The catalog created via createCatalog (used for type inference)
 * @param components - React component implementations matching catalog definitions
 * @returns A Renderer component that only needs `tree` and optional `fallback`
 *
 * @example
 * ```tsx
 * const DashboardRenderer = createRendererFromCatalog(catalog, {
 *   Card: ({ element, children }) => <div className="card">{children}</div>,
 *   Table: ({ element, data }) => <table>...</table>,
 * });
 *
 * <DashboardRenderer tree={uiTree} />
 * ```
 */
export function createRendererFromCatalog<
  C extends { components: Record<string, ComponentDefinition> },
>(_catalog: C, components: RegistryFromCatalog<C>) {
  return function CatalogRenderer({
    tree,
    fallback,
  }: {
    tree: UITree | null;
    fallback?: ComponentRenderer;
  }) {
    return <Renderer tree={tree} registry={components} fallback={fallback} />;
  };
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
  const [paramsOverride, setParamsOverride] = useState<Record<string, unknown>>(
    {}
  );

  const effectiveDataSource = useMemo(() => {
    if (!element.dataSource) return undefined;
    const merged = {
      ...element.dataSource,
      params: { ...element.dataSource.params, ...paramsOverride },
    };
    return merged as DataSource;
  }, [element.dataSource, paramsOverride]);

  const { data, loading, error, refetch } = useKopaiData(effectiveDataSource);

  const updateParams = useCallback((params: Record<string, unknown>) => {
    setParamsOverride((prev) => ({ ...prev, ...params }));
  }, []);

  return (
    <Component
      element={element}
      hasData={true}
      data={data}
      loading={loading}
      error={error}
      refetch={refetch}
      updateParams={updateParams}
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
 * Renders a UITree using a component registry.
 * Prefer using {@link createRendererFromCatalog} for type-safe rendering.
 */
export function Renderer<
  C extends { components: Record<string, ComponentDefinition> },
>({
  tree,
  registry,
  fallback,
}: {
  tree: z.infer<ReturnType<typeof createCatalog>["uiTreeSchema"]> | null;
  registry: RegistryFromCatalog<C>;
  fallback?: ComponentRenderer;
}) {
  if (!tree || !tree.root) return null;

  const rootElement = tree.elements[tree.root];
  if (!rootElement) return null;

  return (
    <ElementRenderer
      element={rootElement}
      tree={tree}
      registry={registry as ComponentRegistry}
      fallback={fallback}
    />
  );
}
