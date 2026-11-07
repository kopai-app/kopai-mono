import { KopaiClient } from "@kopai/sdk";
import { createServiceMapEngine, systemClock } from "../engine/engine.js";
import type { ServiceMapEngine } from "../engine/engine.js";
import { applyCommand, isMainToWorker, type WorkerToMain } from "./protocol.js";

/** Build check marker (plan Unit 6): present only in the worker bundle. */
const MARKER = "kopai-service-map-worker";

/** The part of a worker's global scope the shell uses (lib has no WebWorker). */
export interface WorkerScope {
  postMessage(m: WorkerToMain): void;
  addEventListener(type: "message", l: (e: { data: unknown }) => void): void;
}

const engines = new WeakMap<WorkerScope, ServiceMapEngine>();

/** Thin shell (A8): builds the client and engine on `init`, relays the rest. */
export function handleMessage(scope: WorkerScope, msg: unknown): void {
  if (!isMainToWorker(msg)) return;
  try {
    if (msg.type !== "init") {
      const engine = engines.get(scope);
      if (engine) applyCommand(engine, msg);
      return;
    }
    if (engines.has(scope)) return;
    const baseUrl = new URL(msg.baseUrl).href.replace(/\/$/, "");
    const client = new KopaiClient({
      baseUrl,
      headers: msg.headers,
      token: msg.token,
    });
    const engine = createServiceMapEngine({
      client,
      clock: systemClock,
      onSnapshot: (snapshot) =>
        scope.postMessage({ type: "snapshot", snapshot }),
    });
    engines.set(scope, engine);
    console.debug(`[${MARKER}] started`);
    engine.start();
  } catch (e) {
    scope.postMessage({
      type: "fatal",
      message: String((e as Error)?.message ?? e),
    });
  }
}

const g = globalThis as { WorkerGlobalScope?: unknown };
if (typeof g.WorkerGlobalScope !== "undefined") {
  const scope = globalThis as unknown as WorkerScope;
  scope.addEventListener("message", (e) => handleMessage(scope, e.data));
}
