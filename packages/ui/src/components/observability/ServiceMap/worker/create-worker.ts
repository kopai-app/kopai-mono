/**
 * Starts the Service Map worker. The dynamic import keeps the worker (an
 * inline IIFE string, see packages/ui/build/inline-worker-plugin.ts) in a lazy
 * chunk, and the explicit return type keeps the specifier out of `.d.ts`.
 */
export async function createServiceMapWorker(): Promise<Worker> {
  const { default: ServiceMapWorker } =
    await import("./service-map.worker.ts?worker&inline");
  return new ServiceMapWorker({ name: "kopai-service-map" });
}
