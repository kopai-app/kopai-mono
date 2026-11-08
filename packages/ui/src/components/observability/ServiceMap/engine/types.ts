import type { KopaiClient } from "@kopai/sdk";

/** The only client methods the engine uses (no new endpoint, no new SDK method). */
export type ServiceMapClient = Pick<
  KopaiClient,
  "searchTracesPage" | "queryTracesAggregate" | "getTrace" | "getServices"
>;

/** Injectable clock, so the engine runs under a fake clock in tests. */
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** Which scan read a span: the backward DESC scan or the forward poll. */
export type Region = "back" | "fwd";

export type NodeKind = "service" | "database" | "messaging" | "external";
export type VirtualKind = Exclude<NodeKind, "service">;

/**
 * The only per-span data the engine keeps (Q2: never retain span rows).
 * `parentId` is "" for a root span.
 */
export interface SpanTuple {
  spanId: string;
  parentId: string;
  svc: string;
  kind: string;
  tsMs: number;
  endMs: number;
  err: boolean;
}

/** A cross-service parent/child pair, counted once on the child (A2). */
export interface Pair {
  source: string;
  target: string;
  /** Child start time; the edge's minute bucket. */
  tsMs: number;
  err: boolean;
}

/** One service from the A1 nodes aggregate (kinds summed). */
export interface SeedNode {
  id: string;
  spans: number;
  errors: number;
  errorRate: number;
}

/** A db/mq/ext node inferred from the A1 virtual-edge aggregate. */
export interface SeedVirtualNode {
  id: string;
  label: string;
  kind: VirtualKind;
}

/** A virtual edge from the A1 aggregate (service → target, or mq → service). */
export interface SeedEdge {
  source: string;
  target: string;
  calls: number;
  errors: number;
}

export interface ParsedSeed {
  nodes: SeedNode[];
  virtualNodes: SeedVirtualNode[];
  edges: SeedEdge[];
  truncated: boolean;
  /** Client/Producer rows with no usable peer attribute. */
  clientNoPeer: number;
}

export interface SnapshotNode {
  id: string;
  label: string;
  kind: NodeKind;
  spans: number;
  errorRate: number;
  active: boolean;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
  calls: number;
  errors: number;
  active: boolean;
  virtual: boolean;
}

export type ScanPhase =
  "idle" | "seeding" | "scanning" | "probing" | "live" | "paused" | "error";

export type StopReason = "coverage" | "budget" | "no-more-data" | "error";

export interface ScanState {
  state: ScanPhase;
  stopReason: StopReason | null;
  requests: number;
  maxRequests: number;
  behindMs: number;
}

export interface Diagnostics {
  dropped: number;
  lateUnpaired: number;
  dupes: number;
  badTimestamp: number;
  selfCalls: number;
  clientNoPeer: number;
  nodeCapHit: boolean;
  edgesDropped: number;
  seedTruncated: boolean;
}

export interface Coverage {
  fromMs: number | null;
  toMs: number | null;
  /** Always M. */
  windowMs: number;
}

export interface ServiceMapSnapshot {
  seq: number;
  hub: string | null;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  coverage: Coverage;
  spansInWindow: number;
  scan: ScanState;
  diagnostics: Diagnostics;
  /** Last error; the graph is kept (last good graph). */
  error: string | null;
}
