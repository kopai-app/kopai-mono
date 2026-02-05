import type { ComponentType } from "react";
import type { ComponentDefinition } from "./component-catalog.js";
import type { RendererComponentProps } from "./renderer.js";

export type RegistryFromCatalog<
  C extends { components: Record<string, ComponentDefinition> },
> = {
  [K in keyof C["components"]]: ComponentType<
    RendererComponentProps<C["components"][K]>
  >;
};

/**
 * Creates a type-safe registry from a catalog and component implementations.
 * Ensures all catalog components are provided with correct prop types.
 *
 * @param _catalog - The catalog created via createCatalog (used for type inference)
 * @param components - React component implementations matching catalog definitions
 * @returns The components registry
 *
 * @example
 * ```tsx
 * const registry = createRegistry(catalog, {
 *   Card: ({ element, children }) => (
 *     <div className="card">{children}</div>
 *   ),
 *   Table: ({ element, data }) => (
 *     <table>{data?.map(row => <tr key={row.id} />)}</table>
 *   ),
 * });
 * ```
 */
export function createRegistry<
  C extends { components: Record<string, ComponentDefinition> },
>(_catalog: C, components: RegistryFromCatalog<C>) {
  return components;
}
