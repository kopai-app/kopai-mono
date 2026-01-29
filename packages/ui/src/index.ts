export const name = "@kopai/ui";
export { uiPlugin } from "./plugin.js";
export * as Dashboard from "./pages/dashboard.js";
export {
  Renderer,
  type ComponentRenderProps,
  type ComponentRegistry,
} from "./lib/renderer.js";
export { KopaiSDKProvider, useKopaiSDK } from "./lib/kopai-provider.js";
