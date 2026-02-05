export const name = "@kopai/ui";
export { uiPlugin } from "./plugin.js";
export { createCatalog } from "./lib/component-catalog.js";
export { generatePromptInstructions } from "./lib/generate-prompt-instructions.js";
export {
  Renderer,
  createRendererFromCatalog,
  type RendererComponentProps,
  type ComponentRenderProps,
  type ComponentRenderer,
} from "./lib/renderer.js";
export {
  KopaiSDKProvider,
  useKopaiSDK,
  type KopaiClient,
} from "./providers/kopai-provider.js";
