/**
 * Turns any client the public `ServiceMap` accepts into the engine's
 * `ServiceMapClient`. Kept free of runtime imports so it can live in
 * `@kopai/ui`'s main chunk next to the lazy wrapper.
 */
import type { KopaiClient as DashboardClient } from "@kopai/ui-core";
import type { ServiceMapClient } from "../engine/types.js";

/**
 * A client the map can read traces with: the SDK's `KopaiClient`, the
 * dashboards' client (`KopaiClient` from `@kopai/ui-core`, which has no
 * `queryTracesAggregate` but answers the same query through `query`), or any
 * object with the four methods the engine calls.
 */
export type ServiceMapClientLike = ServiceMapClient | DashboardClient;

function hasAggregate(c: ServiceMapClientLike): c is ServiceMapClient {
  return (
    typeof (c as Partial<ServiceMapClient>).queryTracesAggregate === "function"
  );
}

/**
 * One adapter per client instance, so a client keeps one identity and
 * therefore one shared session (sessions are keyed by client identity).
 */
const adapters = new WeakMap<object, ServiceMapClient>();

export function toServiceMapClient(c: ServiceMapClientLike): ServiceMapClient {
  if (hasAggregate(c)) return c;
  let a = adapters.get(c);
  if (!a) {
    a = {
      searchTracesPage: (filter, opts) => c.searchTracesPage(filter, opts),
      getTrace: (traceId, opts) => c.getTrace(traceId, opts),
      getServices: (opts) => c.getServices(opts),
      // `query` dispatches a trace aggregate query to queryTracesAggregate,
      // with the same result shape.
      queryTracesAggregate: ((q, opts) =>
        c.query(q, opts)) as ServiceMapClient["queryTracesAggregate"],
    };
    adapters.set(c, a);
  }
  return a;
}
