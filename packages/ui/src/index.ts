// DOM-only page composition — stays here.
export { default as ObservabilityPage } from "./pages/observability.js";

// Back-compat re-exports — original DOM-free symbols now live in @kopai/ui-core.
// Additive: earlier versions of @kopai/ui exposed only a subset of these.
export {
  observabilityCatalog,
  generatePromptInstructions,
  createRendererFromCatalog,
  Renderer,
  createCatalog,
  KopaiSDKProvider,
  useKopaiSDK,
  queryClient,
  useKopaiData,
  useLiveLogs,
  LogBuffer,
  type RendererComponentProps,
  type UITree,
  type ComponentRenderer,
  type ComponentRenderProps,
  type ComponentRenderPropsBase,
  type ComponentRenderPropsWithData,
  type CatalogueComponentProps,
  type ComponentDefinition,
  type DataSource,
  type InferProps,
  type KopaiClient,
  type UseKopaiDataResult,
  type UseLiveLogsOptions,
  type UseLiveLogsResult,
} from "@kopai/ui-core";
