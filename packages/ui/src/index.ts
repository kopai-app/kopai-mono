export { default as ObservabilityPage } from "./pages/observability.js";
export { observabilityCatalog } from "./lib/observability-catalog.js";
export { generatePromptInstructions } from "./lib/generate-prompt-instructions.js";

export {
  createRendererFromCatalog,
  type RendererComponentProps,
  type UITree,
} from "./lib/renderer.js";
export { createCatalog } from "./lib/component-catalog.js";
export {
  KopaiSDKProvider,
  type KopaiClient,
} from "./providers/kopai-provider.js";
