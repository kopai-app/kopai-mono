import { DEFAULT_CONFIG, type EngineConfig } from "./config.js";
import { ScanRun, type ScanStats } from "./scheduler.js";
import type { Clock, ServiceMapClient, ServiceMapSnapshot } from "./types.js";

export interface ServiceMapEngineOptions {
  client: ServiceMapClient;
  clock: Clock;
  config?: Partial<EngineConfig>;
  /** Receives at most one snapshot per `snapshotMs` (750 ms). */
  onSnapshot: (snapshot: ServiceMapSnapshot) => void;
}

export interface ServiceMapEngine {
  /** Starts the scan once; later calls do nothing. */
  start(): void;
  /** Stops new requests (the in-flight one finishes). */
  pause(): void;
  /** Continues; after a pause longer than M the session restarts (A8). */
  resume(): void;
  /** Retries a failed request now instead of waiting for the backoff. */
  retry(): void;
  /** Throws the session state away and scans again from the seed. */
  restart(): void;
  /** Aborts the in-flight request and every timer. Final. */
  stop(): void;
  /** The last emitted snapshot. */
  getSnapshot(): ServiceMapSnapshot | null;
  /** Internal sizes (tests, diagnostics). */
  stats(): ScanStats;
}

/**
 * Engine facade (A8): owns one `ScanRun`, throttles snapshots through the
 * injected clock, and handles pause / resume / restart / stop. It has no DOM
 * or Worker dependency, so the worker shell and the in-process session use
 * the same code.
 */
export function createServiceMapEngine(
  opts: ServiceMapEngineOptions
): ServiceMapEngine {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const { client, clock, onSnapshot } = opts;

  let run: ScanRun | null = null;
  let started = false;
  let stopped = false;
  let paused = false;
  let pausedAtMs = 0;
  let seq = 0;
  let last: ServiceMapSnapshot | null = null;
  let lastEmitMs = Number.NEGATIVE_INFINITY;
  let timer: AbortController | null = null;

  function newRun(): ScanRun {
    return new ScanRun({ client, clock, config, onChange: notify });
  }

  function emit(): void {
    if (stopped || !run) return;
    lastEmitMs = clock.now();
    last = run.snapshot(++seq);
    onSnapshot(last);
  }

  /** Throttle: emit now if the last emit is ≥ snapshotMs old, else once at the slot. */
  function notify(): void {
    if (stopped || timer) return;
    const due = lastEmitMs + config.snapshotMs;
    const now = clock.now();
    if (now >= due) {
      emit();
      return;
    }
    const ctl = new AbortController();
    timer = ctl;
    clock.sleep(due - now, ctl.signal).then(
      () => {
        if (timer === ctl) timer = null;
        emit();
      },
      () => {
        if (timer === ctl) timer = null;
      }
    );
  }

  function launch(): void {
    run = newRun();
    if (paused) run.pause();
    const r = run;
    void r.start();
    notify();
  }

  function restart(): void {
    if (stopped) return;
    run?.abort();
    started = true;
    launch();
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      launch();
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      pausedAtMs = clock.now();
      run?.pause();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      if (started && clock.now() - pausedAtMs > config.windowMs) {
        // Hidden longer than M: nothing of the old session is in the window.
        restart();
        return;
      }
      run?.resume();
    },
    retry() {
      run?.retry();
    },
    restart,
    stop() {
      if (stopped) return;
      stopped = true;
      run?.abort();
      timer?.abort();
      timer = null;
    },
    getSnapshot: () => last,
    stats: () =>
      run?.stats() ?? {
        phase: "idle",
        joinSize: 0,
        nodes: 0,
        edges: 0,
        boundary: 0,
        probedTraces: 0,
        scanRequests: 0,
        inFlight: false,
      },
  };
}

/**
 * Header text for the actual coverage (R2-1): "covers 6 of 60 min". A scan
 * that reached the bottom of the window (coverage / no-more-data) and a live
 * poll that is not behind cover the whole window: the last 30 s are read with
 * a fixed delay by design (R2-4), so they do not make it "59 of 60".
 */
export function formatCoverage(snapshot: ServiceMapSnapshot): string {
  const total = Math.round(snapshot.coverage.windowMs / 60_000);
  const { fromMs, toMs } = snapshot.coverage;
  const { stopReason, behindMs } = snapshot.scan;
  let covered: number;
  if (fromMs === null || toMs === null) covered = 0;
  else if (
    (stopReason === "coverage" || stopReason === "no-more-data") &&
    behindMs === 0
  )
    covered = total;
  else covered = Math.round((toMs - fromMs) / 60_000);
  return `covers ${Math.min(total, Math.max(0, covered))} of ${total} min`;
}

/** The real clock: `Date.now` and an abortable `setTimeout`. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(id);
        reject(abortError());
      };
      const id = setTimeout(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.max(0, ms)
      );
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}
