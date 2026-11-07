import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ServiceMapClient, ServiceMapSnapshot } from "../engine/types.js";
import type { LayoutSlot } from "../components/ServiceMap.js";
import {
  acquire,
  peekLayoutSlot,
  peekSnapshot,
  retrySession,
  stableJson,
  type AcquireOptions,
} from "./session-manager.js";

export interface UseServiceMapOptions {
  /** A custom client: the engine runs in-process with it (PD-7). */
  client?: ServiceMapClient;
  /** Server for the worker's own client; relative URLs are made absolute. */
  baseUrl?: string;
  headers?: Record<string, string>;
  token?: string;
}

export interface UseServiceMapResult {
  /** Null until the engine's first snapshot. */
  snapshot: ServiceMapSnapshot | null;
  /** Retries a failed request now instead of waiting for the backoff. */
  retry(): void;
  /** The session's layout cache (undefined before the session exists). */
  layoutSlot: LayoutSlot | undefined;
}

/**
 * Subscribes to the tab's shared Service Map session (R2-7). The session is
 * acquired in `subscribe` and released when React unsubscribes, so a
 * StrictMode double mount re-acquires within the 1 s grace period and keeps
 * the same engine. Options are compared by value (headers by stable JSON,
 * the client by identity).
 */
export function useServiceMap(
  options: UseServiceMapOptions = {}
): UseServiceMapResult {
  const { client, baseUrl, token } = options;
  const headersKey = options.headers ? stableJson(options.headers) : "";
  const opts = useMemo<AcquireOptions>(
    () => ({
      client,
      baseUrl,
      token,
      headers: headersKey
        ? (JSON.parse(headersKey) as Record<string, string>)
        : undefined,
    }),
    [client, baseUrl, token, headersKey]
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      const handle = acquire(opts);
      const unsubscribe = handle.subscribe(onChange);
      return () => {
        unsubscribe();
        handle.release();
      };
    },
    [opts]
  );
  const getSnapshot = useCallback(() => peekSnapshot(opts), [opts]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const retry = useCallback(() => retrySession(opts), [opts]);
  // Read after the snapshot: a session that has a snapshot exists already.
  const layoutSlot = snapshot ? peekLayoutSlot(opts) : undefined;
  return { snapshot, retry, layoutSlot };
}
