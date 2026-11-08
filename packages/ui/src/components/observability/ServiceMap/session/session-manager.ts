import { KopaiClient } from "@kopai/sdk";
import { M_MS } from "../engine/config.js";
import { createServiceMapEngine, systemClock } from "../engine/engine.js";
import type { LayoutSlot } from "../components/ServiceMap.js";
import type { ServiceMapClient, ServiceMapSnapshot } from "../engine/types.js";
import { createServiceMapWorker } from "../worker/create-worker.js";
import {
  applyCommand,
  type EngineCommand,
  type MainToWorker,
  type WorkerInit,
  type WorkerToMain,
} from "../worker/protocol.js";

/**
 * One Service Map session per tab per key (R2-7, PD-7, plan §3).
 *
 * - Without a custom `client`, the engine runs in a Web Worker that builds
 *   its own `KopaiClient` from `{baseUrl, headers, token}`. Such sessions are
 *   keyed by the absolute base URL plus the auth, so views that talk to the
 *   same server with the same auth share one worker.
 * - With a custom `client` (its base URL and headers are private and cannot
 *   cross to a worker), the engine runs in-process with that client. Those
 *   sessions are keyed by the client instance.
 * - When `Worker` is missing, or the worker cannot be created or dies, the
 *   session falls back to the in-process engine (same engine, same snapshots).
 *
 * A refcount with a 1 s grace period keeps a React StrictMode
 * mount → unmount → mount from starting a second scan. When no view uses a
 * session any more it is paused, not stopped: the graph and the layout stay
 * in the worker and the session, so switching to another tab and back shows
 * the map at once and the scan continues where it was. A session nobody
 * comes back to within M is stopped (resuming it would rebuild from scratch
 * anyway). While the document is hidden every session is paused; the engine
 * restarts itself on resume when the gap was longer than M (A8).
 */

export interface AcquireOptions extends Partial<WorkerInit> {
  /** A custom client: the engine then runs in-process with it. */
  client?: ServiceMapClient;
}

export type TransportKind = "pending" | "worker" | "in-process";

export interface ServiceMapSessionHandle {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ServiceMapSnapshot | null;
  retry(): void;
  /** Which transport runs the engine (diagnostics, tests). */
  transport(): TransportKind;
  /** Drops this handle's reference. Idempotent. */
  release(): void;
  /** The session's layout cache, kept while the session lives. */
  layoutSlot: LayoutSlot;
}

export const RELEASE_GRACE_MS = 1000;
/** An unused (paused) session is stopped after this long: the window M. */
export const IDLE_STOP_MS = M_MS;

// ------------------------------------------------------------------ keys

/** `new URL(baseUrl || "/", location.href)` without a trailing slash. */
export function absoluteBaseUrl(baseUrl: string | undefined): string {
  const here = globalThis.location?.href ?? "http://localhost/";
  return new URL(baseUrl || "/", here).href.replace(/\/$/, "");
}

/** JSON with sorted object keys, so equal auth gives an equal key. */
export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

/** Worker session key: absolute base URL + stable JSON of the auth (PD-7). */
export function workerKey(init: Partial<WorkerInit>): string {
  return (
    absoluteBaseUrl(init.baseUrl) +
    "\n" +
    stableJson({ headers: init.headers ?? {}, token: init.token ?? null })
  );
}

// ------------------------------------------------------------- transports

interface Transport {
  send(cmd: EngineCommand): void;
  terminate(): void;
}

function inProcessTransport(
  client: ServiceMapClient,
  onSnapshot: (s: ServiceMapSnapshot) => void,
  paused: boolean
): Transport {
  const engine = createServiceMapEngine({
    client,
    clock: systemClock,
    onSnapshot,
  });
  // Paused before the first request can leave (hidden document, unused).
  if (paused) engine.pause();
  engine.start();
  return {
    send: (cmd) => applyCommand(engine, cmd),
    terminate: () => engine.stop(),
  };
}

// ---------------------------------------------------------------- session

class Session {
  refs = 0;
  snapshot: ServiceMapSnapshot | null = null;
  kind: TransportKind = "pending";
  private readonly listeners = new Set<() => void>();
  private transport: Transport | null = null;
  private worker: Worker | null = null;
  /** Commands sent while the worker is still loading. */
  private queued: EngineCommand[] = [];
  private hidden = false;
  /** No view uses the session: paused until one acquires it again. */
  private idle = false;
  private disposed = false;
  graceTimer: ReturnType<typeof setTimeout> | null = null;
  idleTimer: ReturnType<typeof setTimeout> | null = null;
  readonly layoutSlot: LayoutSlot = { current: null };

  private get paused(): boolean {
    return this.hidden || this.idle;
  }

  constructor(
    readonly key: string,
    readonly opts: {
      client?: ServiceMapClient;
      init?: WorkerInit;
    }
  ) {}

  start(hidden: boolean): void {
    this.hidden = hidden;
    const { client, init } = this.opts;
    if (client) {
      this.startInProcess(client);
      return;
    }
    if (!init) throw new Error("session needs a client or a worker init");
    if (typeof Worker === "undefined") {
      this.startInProcess(clientFromInit(init));
      return;
    }
    createServiceMapWorker().then(
      (w) => this.attachWorker(w, init),
      () => this.fallback(init)
    );
  }

  private startInProcess(client: ServiceMapClient): void {
    if (this.disposed) return;
    this.kind = "in-process";
    this.transport = inProcessTransport(
      client,
      (s) => this.publish(s),
      this.paused
    );
  }

  private attachWorker(w: Worker, init: WorkerInit): void {
    if (this.disposed) {
      w.terminate();
      return;
    }
    this.worker = w;
    this.kind = "worker";
    w.addEventListener("message", (e: MessageEvent<WorkerToMain>) => {
      if (this.worker !== w) return;
      const m = e.data;
      if (m?.type === "snapshot") this.publish(m.snapshot);
      else if (m?.type === "fatal") this.fallback(init);
    });
    w.addEventListener("error", () => {
      if (this.worker === w) this.fallback(init);
    });
    const post = (m: MainToWorker) => w.postMessage(m);
    // The pause travels with the init, so the worker starts paused.
    post({ type: "init", ...init, ...(this.paused ? { paused: true } : {}) });
    for (const cmd of this.queued) if (cmd.type === "retry") post(cmd);
    this.queued = [];
    this.transport = { send: post, terminate: () => w.terminate() };
  }

  /** The worker could not start or died: run the same engine in-process. */
  private fallback(init: WorkerInit): void {
    if (this.disposed) return;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.transport = null;
    this.queued = [];
    this.startInProcess(clientFromInit(init));
  }

  private publish(s: ServiceMapSnapshot): void {
    if (this.disposed) return;
    this.snapshot = s;
    for (const l of [...this.listeners]) l();
  }

  private send(cmd: EngineCommand): void {
    if (this.disposed) return;
    if (this.transport) this.transport.send(cmd);
    else this.queued.push(cmd);
  }

  setHidden(hidden: boolean): void {
    this.setPaused(() => (this.hidden = hidden));
  }

  setIdle(idle: boolean): void {
    this.setPaused(() => (this.idle = idle));
  }

  private setPaused(change: () => void): void {
    const was = this.paused;
    change();
    const now = this.paused;
    // While the worker loads, `start`'s attach applies the latest state.
    if (was !== now && this.transport) {
      this.send({ type: now ? "pause" : "resume" });
    }
  }

  retry(): void {
    this.send({ type: "retry" });
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.layoutSlot.current = null;
    this.transport?.send({ type: "stop" });
    this.transport?.terminate();
    this.disposed = true;
    this.transport = null;
    this.worker = null;
    this.listeners.clear();
  }
}

function clientFromInit(init: WorkerInit): ServiceMapClient {
  return new KopaiClient({
    baseUrl: init.baseUrl,
    headers: init.headers,
    token: init.token,
  });
}

// ---------------------------------------------------------------- registry

const workerSessions = new Map<string, Session>();
const clientSessions = new WeakMap<ServiceMapClient, Session>();
/** Every live session (the WeakMap cannot be iterated). */
const live = new Set<Session>();
let visibilityHooked = false;

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

function onVisibilityChange(): void {
  const hidden = isHidden();
  for (const s of live) s.setHidden(hidden);
}

function hookVisibility(): void {
  if (visibilityHooked || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", onVisibilityChange);
  visibilityHooked = true;
}

function unhookVisibility(): void {
  if (!visibilityHooked || live.size > 0) return;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  visibilityHooked = false;
}

function lookup(opts: AcquireOptions): Session | undefined {
  const s = opts.client
    ? clientSessions.get(opts.client)
    : workerSessions.get(workerKey(opts));
  return s && live.has(s) ? s : undefined;
}

function destroy(s: Session): void {
  s.dispose();
  live.delete(s);
  if (workerSessions.get(s.key) === s) workerSessions.delete(s.key);
  const { client } = s.opts;
  if (client && clientSessions.get(client) === s) clientSessions.delete(client);
  unhookVisibility();
}

/** Takes a reference to the session for these options, creating it if needed. */
export function acquire(opts: AcquireOptions): ServiceMapSessionHandle {
  let s = lookup(opts);
  if (!s) {
    if (opts.client) {
      s = new Session("client", { client: opts.client });
      clientSessions.set(opts.client, s);
    } else {
      const init: WorkerInit = {
        baseUrl: absoluteBaseUrl(opts.baseUrl),
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(opts.token ? { token: opts.token } : {}),
      };
      s = new Session(workerKey(opts), { init });
      workerSessions.set(s.key, s);
    }
    live.add(s);
    hookVisibility();
    s.start(isHidden());
  }
  const session = s;
  if (session.graceTimer) {
    clearTimeout(session.graceTimer);
    session.graceTimer = null;
  }
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
  session.setIdle(false);
  session.refs++;
  let released = false;
  return {
    subscribe: (l) => session.subscribe(l),
    getSnapshot: () => session.snapshot,
    retry: () => session.retry(),
    transport: () => session.kind,
    layoutSlot: session.layoutSlot,
    release() {
      if (released) return;
      released = true;
      if (--session.refs > 0) return;
      session.graceTimer = setTimeout(() => {
        session.graceTimer = null;
        if (session.refs > 0) return;
        // Unused: pause and keep the graph; stop only if nobody returns.
        session.setIdle(true);
        session.idleTimer = setTimeout(() => {
          session.idleTimer = null;
          if (session.refs === 0) destroy(session);
        }, IDLE_STOP_MS);
      }, RELEASE_GRACE_MS);
    },
  };
}

/** The current snapshot of an existing session, without taking a reference. */
export function peekSnapshot(opts: AcquireOptions): ServiceMapSnapshot | null {
  return lookup(opts)?.snapshot ?? null;
}

/** The layout cache of an existing session, without taking a reference. */
export function peekLayoutSlot(opts: AcquireOptions): LayoutSlot | undefined {
  return lookup(opts)?.layoutSlot;
}

/** Retries a failed request of an existing session now. */
export function retrySession(opts: AcquireOptions): void {
  lookup(opts)?.retry();
}

/** Test only: stops every session and clears every timer. */
export function __resetSessionsForTests(): void {
  for (const s of [...live]) destroy(s);
  workerSessions.clear();
  live.clear();
  unhookVisibility();
}
