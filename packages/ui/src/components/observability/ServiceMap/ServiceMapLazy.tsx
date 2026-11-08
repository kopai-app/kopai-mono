/**
 * The public, standalone Service Map.
 *
 * This module stays in `@kopai/ui`'s main chunk and is deliberately small:
 * the engine, layout D, React Flow views and the inline worker live behind
 * the `import("./index.js")` below and only download when a map renders.
 *
 * Where the data comes from, first match wins:
 * 1. `client`: the engine runs in-process with that client.
 * 2. `baseUrl` / `headers` / `token`: the engine runs in a Web Worker that
 *    talks to that Kopai server (a missing `baseUrl` means the page's origin).
 * 3. The source of the nearest `ServiceMapSourceProvider`: lets a host send
 *    every map below it (dashboard tiles included) to one worker session.
 * 4. The client of the nearest `KopaiSDKProvider` (dashboards): in-process,
 *    on the main thread, because a client cannot cross to a worker.
 * 5. Nothing: a Web Worker that talks to the page's own origin.
 *
 * Every map with the same source (the same client, or the same server and
 * auth) shares one session: one scan, one graph and one layout, however many
 * maps show it. A session nobody shows is paused, and stopped after 60 min.
 */
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useOptionalKopaiSDK } from "@kopai/ui-core";
import type { UseServiceMapOptions } from "./session/use-service-map.js";
import {
  toServiceMapClient,
  type ServiceMapClientLike,
} from "./session/client-adapter.js";

const LiveServiceMap = lazy(() => import("./index.js"));

export type { ServiceMapClientLike };

/**
 * Where maps without their own source read from: a client (in-process) or a
 * Kopai server for the Web Worker (`baseUrl` "" or missing = the page's
 * origin).
 */
export type ServiceMapSource =
  | { client: ServiceMapClientLike }
  | { baseUrl?: string; headers?: Record<string, string>; token?: string };

const ServiceMapSourceContext = createContext<ServiceMapSource | null>(null);

export interface ServiceMapSourceProviderProps {
  /** Keep it referentially stable (memoise it) to avoid needless work. */
  source: ServiceMapSource;
  children?: ReactNode;
}

/**
 * Sets the source of every `ServiceMap` below it that has no `client`,
 * `baseUrl`, `headers` or `token` of its own, dashboard tiles included. Use
 * it to give dashboard maps the Web Worker (and the same session as the
 * page's own map) instead of an in-process scan with the dashboard client.
 */
export function ServiceMapSourceProvider({
  source,
  children,
}: ServiceMapSourceProviderProps) {
  return (
    <ServiceMapSourceContext.Provider value={source}>
      {children}
    </ServiceMapSourceContext.Provider>
  );
}

export interface ServiceMapProps {
  /**
   * Client to read traces with; the engine then runs in-process. Defaults
   * to the `KopaiSDKProvider` client when there is one and no `baseUrl`,
   * `headers` or `token` is given.
   */
  client?: ServiceMapClientLike;
  /**
   * Kopai server the map's Web Worker reads from (relative URLs resolve
   * against the page). Used when no `client` is given.
   */
  baseUrl?: string;
  /** Extra request headers for the worker's client. */
  headers?: Record<string, string>;
  /** Bearer token for the worker's client. */
  token?: string;
  /**
   * CSS height of the map canvas (default 640 px), or "fill": the whole map
   * fills the rest of the window and the page never scrolls.
   */
  height?: number | string;
  /** Called with the service name when a service node is clicked. */
  onServiceClick?: (service: string) => void;
  /** Shown while the map's code loads. */
  fallback?: ReactNode;
}

/** Where a map reads from: see the module comment for the order. */
export function resolveServiceMapSource(
  props: Pick<ServiceMapProps, "client" | "baseUrl" | "headers" | "token">,
  contextClient: ServiceMapClientLike | null,
  contextSource: ServiceMapSource | null = null
): UseServiceMapOptions {
  const { client, baseUrl, headers, token } = props;
  if (client) return { client: toServiceMapClient(client) };
  const own = baseUrl !== undefined || !!headers || !!token;
  if (!own && contextSource) {
    if ("client" in contextSource) {
      return { client: toServiceMapClient(contextSource.client) };
    }
    return {
      baseUrl: contextSource.baseUrl ?? "",
      headers: contextSource.headers,
      token: contextSource.token,
    };
  }
  if (!own && contextClient) {
    return { client: toServiceMapClient(contextClient) };
  }
  return { baseUrl: baseUrl ?? "", headers, token };
}

const DEFAULT_FALLBACK = (
  <p className="text-muted-foreground text-sm" role="status">
    Loading service map…
  </p>
);

/**
 * Which services call each other in the past 60 minutes, plus the
 * databases, queues and external APIs they use. Fetches its own data.
 */
export function ServiceMap({
  client,
  baseUrl,
  headers,
  token,
  height,
  onServiceClick,
  fallback = DEFAULT_FALLBACK,
}: ServiceMapProps) {
  const contextClient = useOptionalKopaiSDK();
  const contextSource = useContext(ServiceMapSourceContext);
  const source = useMemo(
    () =>
      resolveServiceMapSource(
        { client, baseUrl, headers, token },
        contextClient,
        contextSource
      ),
    [client, baseUrl, headers, token, contextClient, contextSource]
  );
  return (
    <Suspense fallback={fallback}>
      <LiveServiceMap
        {...source}
        height={height}
        onServiceClick={onServiceClick}
      />
    </Suspense>
  );
}
