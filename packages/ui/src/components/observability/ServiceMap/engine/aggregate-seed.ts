import type { kopaiQuery } from "@kopai/core";
import { M_MS, SEED_LIMIT, VIRTUAL_PER_SOURCE } from "./config.js";
import { classifyPeer, KnownServices, type PeerAttrs } from "./peer-keys.js";
import { isoOf } from "./time.js";
import type {
  ParsedSeed,
  SeedEdge,
  SeedNode,
  SeedVirtualNode,
  VirtualKind,
} from "./types.js";

type AggregateRow = kopaiQuery.KopaiAggregateRow;

/** Result key of the `{container:"SpanAttributes", key:"peer.service"}` dimension. */
export const PEER_SERVICE_KEY = "SpanAttributes.peer.service";

export interface SeedQueries {
  nodes: kopaiQuery.TraceAggregateQuery;
  edges: kopaiQuery.TraceAggregateQuery;
}

/**
 * The two A1 aggregate bodies over `[now − M, now]` (absolute ISO window):
 * nodes by `service.name` + `SpanKind`, and Client/Producer spans grouped by
 * every peer attribute the R1-D3 priority list reads.
 */
export function buildSeedQueries(
  nowMs: number,
  windowMs: number = M_MS
): SeedQueries {
  const timeDimension = {
    type: "absolute" as const,
    startTime: isoOf(nowMs - windowMs),
    endTime: isoOf(nowMs),
  };
  return {
    nodes: {
      signal: "traces",
      mode: "aggregate",
      timeDimension,
      dimensions: ["service.name", "SpanKind"],
      measures: [
        { op: "COUNT", as: "spans" },
        { op: "ERROR_RATE", as: "errRate" },
      ],
      output: { type: "summary" },
      limit: SEED_LIMIT,
    },
    edges: {
      signal: "traces",
      mode: "aggregate",
      timeDimension,
      filters: [
        { column: "SpanKind", op: "in", values: ["Client", "Producer"] },
      ],
      dimensions: [
        "service.name",
        { container: "SpanAttributes", key: "peer.service" },
        "db.system.name",
        "db.namespace",
        "messaging.system",
        "messaging.destination.name",
        "messaging.operation.type",
        "server.address",
      ],
      measures: [
        { op: "COUNT", as: "calls" },
        { op: "ERROR_RATE", as: "errRate" },
      ],
      output: { type: "summary" },
      limit: SEED_LIMIT,
    },
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function rate(v: unknown): number {
  const n = num(v);
  return n > 1 ? 1 : n;
}

interface Agg {
  service: string;
  target: string;
  label: string;
  kind: VirtualKind;
  direction: "out" | "in";
  calls: number;
  errors: number;
}

/**
 * Parses the two A1 results. Service span counts are summed over SpanKind.
 * Peer rows go through `peer-keys` (same-name drop against the services of
 * the nodes result). Each source service keeps its top N virtual targets by
 * calls (ties by id); the rest fold into `ext:<src>/other` (PD-9).
 */
export function parseSeed(
  nodeRows: readonly AggregateRow[],
  edgeRows: readonly AggregateRow[],
  opts: { perSource?: number; limit?: number } = {}
): ParsedSeed {
  const perSource = opts.perSource ?? VIRTUAL_PER_SOURCE;
  const limit = opts.limit ?? SEED_LIMIT;

  const services = new Map<string, { spans: number; errors: number }>();
  for (const row of nodeRows) {
    const name = str(row["service.name"]);
    if (!name) continue;
    const spans = num(row.spans);
    const errors = spans * rate(row.errRate);
    const s = services.get(name);
    if (s) {
      s.spans += spans;
      s.errors += errors;
    } else services.set(name, { spans, errors });
  }
  const nodes: SeedNode[] = [...services.entries()]
    .map(([id, s]) => {
      const errors = Math.round(s.errors);
      return {
        id,
        spans: s.spans,
        errors,
        errorRate: s.spans > 0 ? errors / s.spans : 0,
      };
    })
    .sort((a, b) => cmp(a.id, b.id));

  const known = new KnownServices(services.keys());
  let clientNoPeer = 0;
  // service -> target id -> aggregate (rows that map to the same id merge)
  const bySource = new Map<string, Map<string, Agg>>();
  for (const row of edgeRows) {
    const service = str(row["service.name"]);
    if (!service) continue;
    const calls = num(row.calls);
    const attrs: PeerAttrs = {
      peerService: str(row[PEER_SERVICE_KEY]),
      dbSystem: str(row["db.system.name"]),
      dbNamespace: str(row["db.namespace"]),
      messagingSystem: str(row["messaging.system"]),
      messagingDestination: str(row["messaging.destination.name"]),
      messagingOperation: str(row["messaging.operation.type"]),
      serverAddress: str(row["server.address"]),
    };
    const r = classifyPeer(attrs, known);
    if (r.type === "no-peer") {
      clientNoPeer += calls;
      continue;
    }
    if (r.type !== "target") continue;
    const t = r.target;
    let targets = bySource.get(service);
    if (!targets) bySource.set(service, (targets = new Map()));
    const key = `${t.direction}\u0000${t.id}`;
    const a = targets.get(key);
    const errors = calls * rate(row.errRate);
    if (a) {
      a.calls += calls;
      a.errors += errors;
    } else {
      targets.set(key, {
        service,
        target: t.id,
        label: t.label,
        kind: t.kind,
        direction: t.direction,
        calls,
        errors,
      });
    }
  }

  const virtualNodes = new Map<string, SeedVirtualNode>();
  const edges: SeedEdge[] = [];
  for (const service of [...bySource.keys()].sort(cmp)) {
    const ranked = [...(bySource.get(service)?.values() ?? [])].sort(
      (a, b) => b.calls - a.calls || cmp(a.target, b.target)
    );
    const keep = ranked.slice(0, perSource);
    const rest = ranked.slice(perSource);
    for (const a of keep) {
      if (!virtualNodes.has(a.target)) {
        virtualNodes.set(a.target, {
          id: a.target,
          label: a.label,
          kind: a.kind,
        });
      }
      edges.push(
        a.direction === "in"
          ? edge(a.target, service, a.calls, a.errors)
          : edge(service, a.target, a.calls, a.errors)
      );
    }
    if (rest.length > 0) {
      const id = `ext:${service}/other`;
      virtualNodes.set(id, {
        id,
        label: `other (${rest.length} targets)`,
        kind: "external",
      });
      edges.push(
        edge(
          service,
          id,
          rest.reduce((n, a) => n + a.calls, 0),
          rest.reduce((n, a) => n + a.errors, 0)
        )
      );
    }
  }

  return {
    nodes,
    virtualNodes: [...virtualNodes.values()].sort((a, b) => cmp(a.id, b.id)),
    edges,
    truncated: nodeRows.length >= limit || edgeRows.length >= limit,
    clientNoPeer,
  };
}

function edge(
  source: string,
  target: string,
  calls: number,
  errors: number
): SeedEdge {
  return { source, target, calls, errors: Math.round(errors) };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
