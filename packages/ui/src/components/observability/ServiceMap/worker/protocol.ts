import type { ServiceMapEngine } from "../engine/engine.js";
import type { ServiceMapSnapshot } from "../engine/types.js";

/**
 * How the worker reaches the Kopai API. `baseUrl` must be absolute: relative
 * URLs cannot resolve against a `blob:` worker (plan §3).
 */
export interface WorkerInit {
  baseUrl: string;
  headers?: Record<string, string>;
  token?: string;
}

/** A command that drives one engine, in a worker or in-process. */
export type EngineCommand =
  { type: "pause" } | { type: "resume" } | { type: "retry" } | { type: "stop" };

/** main → worker */
export type MainToWorker = ({ type: "init" } & WorkerInit) | EngineCommand;

/** worker → main */
export type WorkerToMain =
  | { type: "snapshot"; snapshot: ServiceMapSnapshot }
  | { type: "fatal"; message: string };

/**
 * Applies a command to an engine. The worker shell and the in-process
 * transport both use it, so both paths behave the same. A hidden gap longer
 * than M is handled by `engine.resume()`, which restarts the session (A8).
 */
export function applyCommand(
  engine: ServiceMapEngine,
  cmd: EngineCommand
): void {
  switch (cmd.type) {
    case "pause":
      engine.pause();
      break;
    case "resume":
      engine.resume();
      break;
    case "retry":
      engine.retry();
      break;
    case "stop":
      engine.stop();
      break;
  }
}

/** True for a message the worker can act on (guards against stray posts). */
export function isMainToWorker(m: unknown): m is MainToWorker {
  if (typeof m !== "object" || m === null) return false;
  const t = (m as { type?: unknown }).type;
  if (t === "init")
    return typeof (m as { baseUrl?: unknown }).baseUrl === "string";
  return t === "pause" || t === "resume" || t === "retry" || t === "stop";
}
