export const name = "@kopai/ui";
export { uiPlugin } from "./plugin.js";
export * as Dashboard from "./pages/dashboard.js";
export { default as ExamplePage } from "./pages/example.js";
export {
  Renderer,
  createRendererFromCatalog,
  type ComponentRenderProps,
  type ComponentRegistry,
  type RegistryFromCatalog,
} from "./lib/renderer.js";
export {
  KopaiSDKProvider,
  useKopaiSDK,
  type KopaiClient,
} from "./lib/kopai-provider.js";
