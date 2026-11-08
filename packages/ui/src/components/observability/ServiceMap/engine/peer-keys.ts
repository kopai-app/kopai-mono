import type { VirtualKind } from "./types.js";

/**
 * Peer attributes of one Client/Producer aggregate row (A1). Values come
 * straight from the aggregate, so any of them may be null or empty.
 */
export interface PeerAttrs {
  peerService?: string | null;
  dbSystem?: string | null;
  dbNamespace?: string | null;
  messagingSystem?: string | null;
  messagingDestination?: string | null;
  messagingOperation?: string | null;
  serverAddress?: string | null;
}

/**
 * `out`: service → target (a call). `in`: target → service, used for a
 * messaging `receive` (R1-D6), which is a CLIENT span that points the wrong way.
 */
export type PeerDirection = "out" | "in";

export interface VirtualTarget {
  id: string;
  label: string;
  kind: VirtualKind;
  direction: PeerDirection;
}

export type PeerResult =
  | { type: "target"; target: VirtualTarget }
  /** No peer attribute at all: counted as `clientNoPeer`. */
  | { type: "no-peer" }
  /** The peer is a known service: span pairing covers it (R1-D3a). */
  | { type: "known-service" }
  /** A messaging `settle` (ack) span: not topology (R1-D6). */
  | { type: "ignored" };

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Host normalisation (plan §2.1 step 1): lower-case, strip the brackets and
 * port of `[v6]:port`, strip a `:port` suffix, strip trailing dots.
 * `Cart:8080` → `cart`; `cart.default.svc.cluster.local.` → `cart.default.svc.cluster.local`.
 */
export function normaliseHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]*)\](?::\d+)?$/.exec(h);
  if (bracketed) {
    h = bracketed[1] ?? "";
  } else {
    const colons = h.split(":").length - 1;
    // Exactly one colon is host:port. More is a bare IPv6 literal: keep it.
    if (colons === 1) {
      const m = /^(.*):(\d*)$/.exec(h);
      if (m) h = m[1] ?? "";
    }
  }
  return h.replace(/\.+$/, "");
}

/** True for an IPv4 or IPv6 literal (already normalised). */
export function isIpLiteral(host: string): boolean {
  return IPV4.test(host) || host.includes(":");
}

/**
 * The set of known service names, for the R1-D3a same-name drop. Matching
 * is case-insensitive, on the normalised full host or its first DNS label;
 * an IP literal is only ever matched as a whole.
 */
export class KnownServices {
  private readonly names = new Set<string>();

  constructor(names: Iterable<string> = []) {
    for (const n of names) this.add(n);
  }

  add(name: string): void {
    const n = name.trim().toLowerCase();
    if (n) this.names.add(n);
  }

  /** `host` may be raw; it is normalised here. */
  matches(host: string): boolean {
    const h = normaliseHost(host);
    if (!h) return false;
    if (this.names.has(h)) return true;
    if (isIpLiteral(h)) return false;
    const dot = h.indexOf(".");
    return dot > 0 && this.names.has(h.slice(0, dot));
  }
}

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * R1-D3/D4/D6 priority list: `peer.service` → `db.system.name` (+namespace)
 * → `messaging.*` → `server.address`. The id comes from the highest-priority
 * name; the kind comes from the attribute family (R1-D3 note).
 */
export function classifyPeer(
  attrs: PeerAttrs,
  known: KnownServices
): PeerResult {
  const peer = clean(attrs.peerService);
  const dbSystem = clean(attrs.dbSystem);
  const dbNs = clean(attrs.dbNamespace);
  const mqSystem = clean(attrs.messagingSystem);
  const mqDest = clean(attrs.messagingDestination);
  const op = clean(attrs.messagingOperation).toLowerCase();
  const address = clean(attrs.serverAddress);

  if (op === "settle") return { type: "ignored" };
  const direction: PeerDirection = op === "receive" ? "in" : "out";
  const isDb = dbSystem !== "";
  const isMq = !isDb && (mqSystem !== "" || mqDest !== "");

  if (peer) {
    if (known.matches(peer)) return { type: "known-service" };
    if (isDb) {
      return target(`db:${peer}`, `${peer} (${dbSystem})`, "database", "out");
    }
    if (isMq) {
      const label = mqSystem ? `${peer} (${mqSystem})` : peer;
      return target(`mq:${peer}`, label, "messaging", direction);
    }
    return target(`ext:${peer}`, peer, "external", "out");
  }
  if (isDb) {
    return dbNs
      ? target(
          `db:${dbSystem}/${dbNs}`,
          `${dbNs} (${dbSystem})`,
          "database",
          "out"
        )
      : target(`db:${dbSystem}`, dbSystem, "database", "out");
  }
  if (isMq) {
    const system = mqSystem || "messaging";
    return mqDest
      ? target(
          `mq:${system}/${mqDest}`,
          `${mqDest} (${system})`,
          "messaging",
          direction
        )
      : target(`mq:${system}`, system, "messaging", direction);
  }
  if (address) {
    const host = normaliseHost(address);
    if (!host) return { type: "no-peer" };
    if (known.matches(host)) return { type: "known-service" };
    return target(`ext:${host}`, host, "external", "out");
  }
  return { type: "no-peer" };
}

function target(
  id: string,
  label: string,
  kind: VirtualKind,
  direction: PeerDirection
): PeerResult {
  return { type: "target", target: { id, label, kind, direction } };
}

/** The virtual target of a peer row, or null when there is none. */
export function virtualTarget(
  attrs: PeerAttrs,
  known: KnownServices
): VirtualTarget | null {
  const r = classifyPeer(attrs, known);
  return r.type === "target" ? r.target : null;
}
