/**
 * Service Map engine constants (plan §2.1). Every structure the engine keeps
 * has a cap here that does not depend on how long the tab stays open (Q2).
 */

/** Window M: the map shows the past 60 minutes (R2-1). Fixed. */
export const M_MS = 3_600_000;
/** Forward poll reads up to `now − DELAY_MS` (R2-4). */
export const DELAY_MS = 30_000;
/** Forward poll interval (R2-4). */
export const POLL_MS = 10_000;
/** Spans per page (Q11). */
export const PAGE_LIMIT = 1000;
/** Minimum gap between two requests (Q11). */
export const GAP_MS = 100;
/**
 * Shared request budget before the session goes live (Q11). 50 requests read
 * at most ~37k spans: enough for a mental picture of the system.
 */
export const SCAN_MAX_REQUESTS = 50;
/** Pairing horizon H (Q9). */
export const H_MS = 120_000;
/** Clock-skew pad between parent and child start times. */
export const SKEW_MS = 5_000;
/** Join buffer cap: seen entries + every pending child (A3). */
export const JOIN_CAP = 50_000;
/** Internal node safety cap (Q16). */
export const NODE_CAP = 2000;
/** Edge cap; each real edge owns a 61-minute bucket ring (PD-5). */
export const EDGE_CAP = 2500;
/** Snapshot throttle (A8). */
export const SNAPSHOT_MS = 750;
/** Seed refresh interval during the live phase (PD-2). */
export const SEED_REFRESH_MS = 300_000;
/** At most this many unconnected services are probed (PD-1). */
export const PROBE_MAX_SERVICES = 50;
/** Requests kept back from the backward scan for probes (PD-8). */
export const PROBE_RESERVE = 15;
/** Pages per forward tick (PD-3). */
export const FWD_MAX_PAGES = 20;
/** Virtual targets per source service before folding into `other` (PD-9). */
export const VIRTUAL_PER_SOURCE = 20;
/** Row limit of each seed aggregate; a full result means it was truncated. */
export const SEED_LIMIT = 10_000;
/** Minutes in a bucket ring: the M window plus the current minute (A7). */
export const RING_MINUTES = Math.floor(M_MS / 60_000) + 1;

export interface EngineConfig {
  windowMs: number;
  delayMs: number;
  pollMs: number;
  pageLimit: number;
  gapMs: number;
  scanMaxRequests: number;
  horizonMs: number;
  skewMs: number;
  joinCap: number;
  nodeCap: number;
  edgeCap: number;
  snapshotMs: number;
  seedRefreshMs: number;
  probeMaxServices: number;
  probeReserve: number;
  fwdMaxPages: number;
  virtualPerSource: number;
}

export const DEFAULT_CONFIG: Readonly<EngineConfig> = Object.freeze({
  windowMs: M_MS,
  delayMs: DELAY_MS,
  pollMs: POLL_MS,
  pageLimit: PAGE_LIMIT,
  gapMs: GAP_MS,
  scanMaxRequests: SCAN_MAX_REQUESTS,
  horizonMs: H_MS,
  skewMs: SKEW_MS,
  joinCap: JOIN_CAP,
  nodeCap: NODE_CAP,
  edgeCap: EDGE_CAP,
  snapshotMs: SNAPSHOT_MS,
  seedRefreshMs: SEED_REFRESH_MS,
  probeMaxServices: PROBE_MAX_SERVICES,
  probeReserve: PROBE_RESERVE,
  fwdMaxPages: FWD_MAX_PAGES,
  virtualPerSource: VIRTUAL_PER_SOURCE,
});
