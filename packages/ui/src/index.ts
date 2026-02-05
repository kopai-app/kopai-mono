export const name = "@kopai/ui";
export { uiPlugin } from "./plugin.js";
export * as Dashboard from "./pages/dashboard.js";
export { default as ExamplePage } from "./pages/example.js";
export {
  Renderer,
  createRendererFromCatalog,
  type ComponentRenderProps,
  type ComponentRenderer,
} from "./lib/renderer.js";
export {
  createRegistry,
  type RegistryFromCatalog,
} from "./lib/create-registry.js";
export {
  KopaiSDKProvider,
  useKopaiSDK,
  type KopaiClient,
} from "./lib/kopai-provider.js";
