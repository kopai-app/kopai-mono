import { ExampleObservabilityCatalog } from "./custom-observability-catalog.js";
import { ExampleWithDynamicData } from "./dynamic-kopai-data.js";
import { ExampleWithStaticData } from "./static-data.js";

export function App() {
  return (
    <div>
      <ExampleWithStaticData />
      <ExampleWithDynamicData />
      <ExampleObservabilityCatalog />
    </div>
  );
}
