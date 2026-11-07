/**
 * Service Map (standalone view). Loaded lazily by the observability page, so
 * the engine, layout and inline worker only download when the map opens.
 */
export {
  ServiceMap,
  ServiceMapView,
  type ServiceMapProps,
  type ServiceMapViewProps,
} from "./components/ServiceMap.js";
export { ServiceMapCanvas } from "./components/ServiceMapCanvas.js";
export { ServiceMapHeader } from "./components/ServiceMapHeader.js";
export { Legend as ServiceMapLegend } from "./components/Legend.js";
export type { ServiceMapSnapshot } from "./engine/types.js";
export { ServiceMap as default } from "./components/ServiceMap.js";
