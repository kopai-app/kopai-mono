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
import type { KopaiClient } from "../providers/kopai-provider.js";

type RegistryFromCatalog<
  C extends { components: Record<string, ComponentDefinition> },
> = {
  [K in keyof C["components"]]: ComponentType<
    RendererComponentProps<C["components"][K]>
  >;
};

type Catalog = ReturnType<typeof createCatalog>;

export type UITree = z.infer<Catalog["uiTreeSchema"]>;

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

/** Derives the SDK response type for a given client method. */
type SDKResponseFor<M extends keyof KopaiClient> = Awaited<
  ReturnType<KopaiClient[M]>
>;

/** Infers the data type from a component definition's `acceptsDataFrom`. */
type InferData<CD> = CD extends { acceptsDataFrom: readonly (infer M)[] }
  ? M extends keyof KopaiClient
    ? SDKResponseFor<M>
    : unknown
  : unknown;

type WithData<D = unknown> = {
  hasData: true;
  response: D | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  updateParams: (params: Record<string, unknown>) => void;
};

type WithoutData = {
  hasData: false;
};

/** Distributes WithData over a union: WithData<A | B> → WithData<A> | WithData<B> */
type DistributeWithData<D> = D extends unknown ? WithData<D> : never;

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
          } & DistributeWithData<InferData<CD>>)
    : CD extends { props: infer P }
      ?
          | ({ element: BaseElement<InferProps<P>> } & WithoutData)
          | ({ element: BaseElement<InferProps<P>> } & DistributeWithData<
              InferData<CD>
            >)
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
  response: unknown;
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

/** Map from component type name to the dataSource methods it accepts. */
type AcceptsDataFromByType = Record<string, readonly string[] | undefined>;

/**
 * Creates a typed Renderer component bound to a catalog and component implementations.
 *
 * @param catalog - The catalog created via createCatalog (used for type inference and runtime acceptsDataFrom check)
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
>(catalog: C, components: RegistryFromCatalog<C>) {
  const acceptsDataFromByType: AcceptsDataFromByType = Object.fromEntries(
    Object.entries(catalog.components).map(([name, def]) => [
      name,
      def.acceptsDataFrom,
    ])
  );
  return function CatalogRenderer({
    tree,
    fallback,
  }: {
    tree: UITree | null;
    fallback?: ComponentRenderer;
  }) {
    return (
      <Renderer
        tree={tree}
        registry={components}
        fallback={fallback}
        acceptsDataFromByType={acceptsDataFromByType}
      />
    );
  };
}

/**
 * Wrapper component for elements with dataSource.
 *
 * Validates that the element's dataSource.method is one of the methods
 * the component declared via `acceptsDataFrom`. This guards against tree
 * persistence / authoring bugs where a component ends up bound to a
 * dataSource method it wasn't designed to consume. Without this, the
 * renderer would silently pass mismatched data to the component and
 * produce confusing runtime failures deep inside the component.
 */
function DataSourceElement({
  element,
  Component,
  acceptsDataFrom,
  children,
}: {
  element: UIElement;
  Component: ComponentRenderer;
  acceptsDataFrom: readonly string[] | undefined;
  children?: ReactNode;
}) {
  const [paramsOverride, setParamsOverride] = useState<Record<string, unknown>>(
    {}
  );

  const methodIsAccepted =
    !element.dataSource ||
    (acceptsDataFrom?.includes(element.dataSource.method) ?? false);

  const effectiveDataSource = useMemo(() => {
    if (!element.dataSource || !methodIsAccepted) return undefined;
    const merged = {
      ...element.dataSource,
      params: { ...element.dataSource.params, ...paramsOverride },
    };
    return merged as DataSource;
  }, [element.dataSource, paramsOverride, methodIsAccepted]);

  const { data, loading, error, refetch } = useKopaiData(effectiveDataSource);

  if (!methodIsAccepted && element.dataSource) {
    const accepted = acceptsDataFrom?.length
      ? acceptsDataFrom.join(", ")
      : "none";
    return (
      <div style={{ padding: 24, color: "var(--destructive, #ef4444)" }}>
        Component <code>{element.type}</code> does not accept dataSource method{" "}
        <code>{element.dataSource.method}</code>. Accepted methods: {accepted}.
      </div>
    );
  }

  const updateParams = useCallback((params: Record<string, unknown>) => {
    setParamsOverride((prev) => ({ ...prev, ...params }));
  }, []);

  return (
    <Component
      element={element}
      hasData={true}
      response={data}
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
  acceptsDataFromByType,
}: {
  element: UIElement;
  tree: UITree;
  registry: ComponentRegistry;
  fallback?: ComponentRenderer;
  acceptsDataFromByType: AcceptsDataFromByType;
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
        acceptsDataFromByType={acceptsDataFromByType}
      />
    );
  });

  // If element has dataSource, wrap with data fetching
  if (element.dataSource) {
    return (
      <DataSourceElement
        element={element}
        Component={Component}
        acceptsDataFrom={acceptsDataFromByType[element.type]}
      >
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
  acceptsDataFromByType = {},
}: {
  tree: z.infer<ReturnType<typeof createCatalog>["uiTreeSchema"]> | null;
  registry: RegistryFromCatalog<C>;
  fallback?: ComponentRenderer;
  acceptsDataFromByType?: AcceptsDataFromByType;
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
      acceptsDataFromByType={acceptsDataFromByType}
    />
  );
}
