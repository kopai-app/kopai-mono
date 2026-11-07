#!/usr/bin/env node
/* global console, process, URL, Buffer, fetch */
/**
 * Service Map demo data: sends OTLP/JSON traces of a small online shop to a
 * Kopai collector, so the Service map tab has something to draw.
 *
 *   node scripts/service-map-demo.mjs [--services 20] [--rate 5] [--once]
 *     [--endpoint http://localhost:4318/v1/traces] [--seed 1]
 *     [--chunk-spans 1000] [--gap-ms 20] [--backfill-minutes 60]
 *
 * It first backfills the last `--backfill-minutes` (traces spread across the
 * window at `--rate` traces per second). With `--once` it then exits;
 * otherwise it keeps streaming `--rate` traces per second, each starting
 * within the last couple of seconds, until interrupted.
 *
 * The shop (20 services at the default size):
 *   web-frontend -> api-gateway -> user-auth / catalog / cart / checkout /
 *   search / recommendations / reviews; checkout -> cart / inventory /
 *   pricing / payments / shipping and a kafka PRODUCER (order-events) whose
 *   CONSUMER is notifications-worker; payments -> fraud-detection and
 *   api.stripe.com; notifications-worker -> api.sendgrid.com; databases are
 *   postgresql, redis and elasticsearch. report-cron, nightly-export and
 *   legacy-billing are never connected to the rest.
 * Internal HTTP/gRPC CLIENT spans carry a realistic `server.address` naming
 * the callee (`cart:8080`, `cart.default.svc.cluster.local`, `cart`), so the
 * map must not show an `ext:` twin of an internal service.
 * `--services N` (N > 20) adds generated domain services in tiers below
 * api-gateway. Values below 20 are raised to 20.
 *
 * The collector's body limit is 1 MiB, so spans are sent in chunks of about
 * `--chunk-spans` spans (each body under 900 KiB; a bigger one is split in
 * half until it fits), one POST at a time with `--gap-ms` between them. Any
 * non-2xx response or network error exits the script with status 1.
 *
 * No dependencies: Node 24 built-ins only.
 */
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

// ------------------------------------------------------------------- flags

const USAGE = `Usage: node scripts/service-map-demo.mjs [options]
  --services N          services to simulate (default 20, minimum 20)
  --rate R              traces per second (default 5)
  --once                backfill, then exit (default: backfill, then stream)
  --endpoint URL        OTLP/HTTP traces endpoint (default http://localhost:4318/v1/traces)
  --seed S              random seed (default 1)
  --chunk-spans N       spans per POST (default 1000, max 1500)
  --gap-ms MS           pause between POSTs (default 20)
  --backfill-minutes M  minutes of history to backfill (default 60, 0 = none)
  --help                show this help`;

const MAX_BODY_BYTES = 900 * 1024;
const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 };
const STATUS_ERROR = 2;

function fail(message) {
  console.error(`service-map-demo: ${message}`);
  process.exit(1);
}

function parseFlags(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        services: { type: "string", default: "20" },
        rate: { type: "string", default: "5" },
        once: { type: "boolean", default: false },
        endpoint: {
          type: "string",
          default: "http://localhost:4318/v1/traces",
        },
        seed: { type: "string", default: "1" },
        "chunk-spans": { type: "string", default: "1000" },
        "gap-ms": { type: "string", default: "20" },
        "backfill-minutes": { type: "string", default: "60" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }).values;
  } catch (err) {
    fail(`${err.message}\n${USAGE}`);
  }
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const num = (name, min, max) => {
    const v = Number(parsed[name]);
    if (!Number.isFinite(v) || v < min || v > max) {
      fail(`--${name} must be a number between ${min} and ${max}`);
    }
    return v;
  };
  let endpoint;
  try {
    endpoint = new URL(parsed.endpoint).href;
  } catch {
    fail(`--endpoint is not a URL: ${parsed.endpoint}`);
  }
  return {
    services: Math.max(20, Math.floor(num("services", 1, 5000))),
    rate: num("rate", 0.01, 1000),
    once: parsed.once,
    endpoint,
    seed: Math.floor(num("seed", 0, 2 ** 31)),
    chunkSpans: Math.floor(num("chunk-spans", 1, 1500)),
    gapMs: num("gap-ms", 0, 60_000),
    backfillMinutes: num("backfill-minutes", 0, 24 * 60),
  };
}

// ------------------------------------------------------------------ random

/** mulberry32: a small seeded PRNG, so `--seed` repeats the same traffic mix. */
function createRandom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// IDs come from crypto, not the seed: two runs must never collide.
const hexId = (bytes) => randomBytes(bytes).toString("hex");

// -------------------------------------------------------------- attributes

function attr(key, value) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

const toAttributes = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => attr(k, v));

// ------------------------------------------------------------------ tracer

const MS_NS = 1_000_000n;

/**
 * Builds the spans of one trace. Each span is `{svc, span}` where `span` is
 * an OTLP/JSON span; resource grouping happens when a chunk is encoded.
 */
class TraceBuilder {
  constructor(rnd, startNs) {
    this.rnd = rnd;
    this.traceId = hexId(16);
    this.startNs = startNs;
    this.spans = [];
  }

  /**
   * Adds a span and runs `body(ctx)` to add its children. Children start
   * after the parent and the parent ends after its last child, so the
   * timing nests the way real instrumentation does.
   * Returns `{error}` so callers can propagate failures upward.
   */
  span(svc, parent, opts, body) {
    const rnd = this.rnd;
    const spanId = hexId(8);
    const startNs = parent
      ? parent.cursorNs + (BigInt(rnd.int(1, 3)) * MS_NS) / 4n
      : this.startNs;
    const ctx = {
      svc,
      spanId,
      cursorNs: startNs + BigInt(rnd.int(100, 900)) * 1000n,
      error: false,
    };
    if (body) body(ctx);
    const selfMs = opts.selfMs ?? rnd.int(1, 12);
    const endNs = ctx.cursorNs + BigInt(selfMs) * MS_NS;
    const error =
      ctx.error && rnd.chance(0.7) ? true : rnd.chance(opts.errorRate ?? 0.02);
    const span = {
      traceId: this.traceId,
      spanId,
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      name: opts.name,
      kind: opts.kind,
      startTimeUnixNano: startNs.toString(),
      endTimeUnixNano: endNs.toString(),
      attributes: toAttributes(opts.attrs ?? {}),
      status: error
        ? { code: STATUS_ERROR, message: opts.errorMessage ?? "request failed" }
        : { code: 0 },
    };
    this.spans.push({ svc, span });
    if (parent) {
      parent.cursorNs = endNs;
      if (error) parent.error = true;
    }
    return { error };
  }
}

// --------------------------------------------------------------- topology

const HOST_FORMS = [
  (svc) => ({ address: `${svc}:8080`, port: 8080 }),
  (svc) => ({ address: `${svc}.default.svc.cluster.local`, port: 8080 }),
  (svc) => ({ address: svc, port: 80 }),
];

/**
 * An HTTP call from `ctx` to service `callee`: a CLIENT span in the caller
 * with a realistic `server.address`, and the callee's SERVER span below it.
 */
function httpCall(t, ctx, callee, route, opts = {}, body) {
  const rnd = t.rnd;
  const method = opts.method ?? "GET";
  const form = rnd.pick(HOST_FORMS)(callee);
  const authority = form.address.includes(":")
    ? form.address
    : `${form.address}:${form.port}`;
  t.span(
    ctx.svc,
    ctx,
    {
      name: `${method} ${route}`,
      kind: KIND.CLIENT,
      selfMs: 0,
      errorRate: 0,
      attrs: {
        "http.request.method": method,
        "server.address": form.address,
        "server.port": form.port,
        "url.full": `http://${authority}${route.replace(/:(\w+)/g, (_, k) => `${k}-${rnd.int(1, 999)}`)}`,
        "peer.service": opts.peerService ? callee : undefined,
      },
    },
    (client) => {
      t.span(
        callee,
        client,
        {
          name: `${method} ${route}`,
          kind: KIND.SERVER,
          errorRate: opts.errorRate,
          attrs: {
            "http.request.method": method,
            "http.route": route,
            "url.path": route,
          },
        },
        body
      );
    }
  );
}

/** A gRPC call: same shape as HTTP, with rpc.* attributes. */
function grpcCall(t, ctx, callee, method, opts = {}, body) {
  const form = t.rnd.pick(HOST_FORMS)(callee);
  const service = `shop.${callee.replace(/-/g, "_")}.v1.Service`;
  t.span(
    ctx.svc,
    ctx,
    {
      name: `${service}/${method}`,
      kind: KIND.CLIENT,
      selfMs: 0,
      errorRate: 0,
      attrs: {
        "rpc.system": "grpc",
        "rpc.service": service,
        "rpc.method": method,
        "server.address": form.address,
        "server.port": 50051,
        "peer.service": opts.peerService ? callee : undefined,
      },
    },
    (client) => {
      t.span(
        callee,
        client,
        {
          name: `${service}/${method}`,
          kind: KIND.SERVER,
          errorRate: opts.errorRate,
          attrs: {
            "rpc.system": "grpc",
            "rpc.service": service,
            "rpc.method": method,
          },
        },
        body
      );
    }
  );
}

const DBS = {
  postgres: {
    system: "postgresql",
    address: "postgres.default.svc.cluster.local",
    port: 5432,
  },
  redis: { system: "redis", address: "redis-master", port: 6379 },
  elasticsearch: {
    system: "elasticsearch",
    address: "elasticsearch-es-http",
    port: 9200,
  },
};

/** A database CLIENT span (no SERVER child: databases are not instrumented). */
function dbCall(t, ctx, db, namespace, operation, opts = {}) {
  const d = DBS[db];
  t.span(ctx.svc, ctx, {
    name: `${operation} ${namespace}`,
    kind: KIND.CLIENT,
    selfMs: t.rnd.int(1, opts.slowMs ?? 8),
    errorRate: opts.errorRate ?? 0.005,
    errorMessage: "connection reset by peer",
    attrs: {
      "db.system.name": d.system,
      "db.namespace": namespace,
      "db.operation.name": operation,
      "server.address": opts.address ?? d.address,
      "server.port": d.port,
    },
  });
}

/** A call to a third-party API: only the CLIENT span exists. */
function externalCall(t, ctx, host, route, opts = {}) {
  t.span(ctx.svc, ctx, {
    name: `${opts.method ?? "POST"}`,
    kind: KIND.CLIENT,
    selfMs: t.rnd.int(40, 250),
    errorRate: opts.errorRate ?? 0.02,
    errorMessage: "upstream returned 503",
    attrs: {
      "http.request.method": opts.method ?? "POST",
      "server.address": host,
      "server.port": 443,
      "url.full": `https://${host}${route}`,
      "peer.service": opts.peerService,
    },
  });
}

function internal(t, ctx, name, attrs) {
  t.span(ctx.svc, ctx, { name, kind: KIND.INTERNAL, errorRate: 0.002, attrs });
}

// ------------------------------------------------------------- shop flows

function authCheck(t, gw) {
  grpcCall(t, gw, "user-auth", "VerifyToken", {}, (auth) => {
    dbCall(t, auth, "redis", "0", "GET");
    if (t.rnd.chance(0.1)) dbCall(t, auth, "postgres", "shop", "SELECT");
  });
}

function priceLookup(t, ctx) {
  grpcCall(t, ctx, "pricing", "GetPrice", {}, (pricing) => {
    dbCall(t, pricing, "redis", "0", "HGET");
    if (t.rnd.chance(0.4)) {
      httpCall(t, pricing, "currency", "/convert", {}, (cur) =>
        internal(t, cur, "convert", { "currency.code": "EUR" })
      );
    }
  });
}

function catalogGet(t, ctx) {
  httpCall(t, ctx, "catalog", "/products/:id", {}, (cat) => {
    dbCall(t, cat, "redis", "0", "GET");
    if (t.rnd.chance(0.5)) dbCall(t, cat, "postgres", "shop", "SELECT");
    priceLookup(t, cat);
  });
}

function browse(t, gw) {
  catalogGet(t, gw);
  if (t.rnd.chance(0.7)) {
    httpCall(t, gw, "recommendations", "/recommendations", {}, (rec) => {
      dbCall(t, rec, "redis", "0", "ZRANGE");
      if (t.rnd.chance(0.5)) catalogGet(t, rec);
    });
  }
  if (t.rnd.chance(0.3)) {
    httpCall(t, gw, "reviews", "/products/:id/reviews", {}, (rev) =>
      dbCall(t, rev, "postgres", "shop", "SELECT")
    );
  }
}

function search(t, gw) {
  httpCall(t, gw, "search", "/search", {}, (s) => {
    dbCall(t, s, "elasticsearch", "products", "search", { slowMs: 30 });
    if (t.rnd.chance(0.6)) catalogGet(t, s);
  });
}

function cart(t, gw) {
  httpCall(t, gw, "cart", "/cart", { method: "POST" }, (c) => {
    dbCall(t, c, "redis", "0", "HSET");
    priceLookup(t, c);
  });
}

function checkout(t, gw) {
  httpCall(
    t,
    gw,
    "checkout",
    "/checkout",
    { method: "POST", peerService: true },
    (co) => {
      httpCall(t, co, "cart", "/cart", {}, (c) =>
        dbCall(t, c, "redis", "0", "HGETALL")
      );
      grpcCall(t, co, "inventory", "Reserve", {}, (inv) =>
        dbCall(t, inv, "postgres", "shop", "UPDATE")
      );
      priceLookup(t, co);
      grpcCall(
        t,
        co,
        "payments",
        "Charge",
        { peerService: true, errorRate: 0.06 },
        (pay) => {
          grpcCall(t, pay, "fraud-detection", "Score", {}, (fd) =>
            dbCall(t, fd, "redis", "0", "GET")
          );
          externalCall(t, pay, "api.stripe.com", "/v1/payment_intents", {
            errorRate: 0.05,
          });
          dbCall(t, pay, "postgres", "payments", "INSERT");
        }
      );
      httpCall(t, co, "shipping", "/quotes", { method: "POST" }, (sh) => {
        dbCall(t, sh, "postgres", "shop", "SELECT");
        externalCall(t, sh, "api.shipengine.com", "/v1/rates", {
          peerService: "shipengine",
        });
      });
      // The order event: a kafka PRODUCER in checkout, consumed in the
      // same trace by notifications-worker, which emails the customer.
      t.span(
        co.svc,
        co,
        {
          name: "order-events publish",
          kind: KIND.PRODUCER,
          selfMs: 1,
          errorRate: 0.002,
          attrs: {
            "messaging.system": "kafka",
            "messaging.destination.name": "order-events",
            "messaging.operation.type": "send",
            "server.address": "kafka-0.kafka-headless",
            "server.port": 9092,
          },
        },
        (producer) => {
          t.span(
            "notifications-worker",
            producer,
            {
              name: "order-events process",
              kind: KIND.CONSUMER,
              attrs: {
                "messaging.system": "kafka",
                "messaging.destination.name": "order-events",
                "messaging.operation.type": "process",
                "messaging.consumer.group.name": "notifications",
              },
            },
            (nw) =>
              externalCall(t, nw, "api.sendgrid.com", "/v3/mail/send", {
                errorRate: 0.03,
              })
          );
        }
      );
    }
  );
}

const FLOWS = [
  { weight: 40, path: "/product/:id", run: browse },
  { weight: 20, path: "/search", run: search },
  { weight: 20, path: "/cart", run: cart },
  { weight: 12, path: "/checkout", run: checkout },
];

// ------------------------------------------------- generated domain tiers

const DOMAIN_WORDS = [
  "account",
  "audit",
  "billing",
  "coupon",
  "fulfilment",
  "geo",
  "identity",
  "invoice",
  "loyalty",
  "media",
  "order-history",
  "profile",
  "quote",
  "refund",
  "risk",
  "routing",
  "session",
  "tax",
  "tracking",
  "warehouse",
  "wishlist",
  "ledger",
  "returns",
  "promo",
];

/**
 * `extra` generated services in tiers of growing size below api-gateway:
 * tier 1 is called by the gateway, each lower-tier service has 1-2 callers
 * in the tier above. Every service owns a postgres namespace or uses redis.
 */
function buildTiers(extra, rnd) {
  const tiers = [];
  let made = 0;
  let size = Math.max(2, Math.ceil(Math.sqrt(extra)));
  while (made < extra) {
    const n = Math.min(size, extra - made);
    const tier = [];
    for (let i = 0; i < n; i++, made++) {
      const word = DOMAIN_WORDS[made % DOMAIN_WORDS.length];
      tier.push({
        name: `${word}-${String(made + 1).padStart(3, "0")}`,
        children: [],
        db: rnd.chance(0.5) ? "postgres" : "redis",
      });
    }
    const above = tiers[tiers.length - 1];
    if (above) {
      for (const s of tier) {
        rnd.pick(above).children.push(s);
        if (rnd.chance(0.3)) {
          const other = rnd.pick(above);
          if (!other.children.includes(s)) other.children.push(s);
        }
      }
    }
    tiers.push(tier);
    size = Math.ceil(size * 1.5);
  }
  return tiers;
}

function runTierService(t, ctx, svc, depth) {
  const call = t.rnd.chance(0.5) ? httpCall : grpcCall;
  call(t, ctx, svc.name, depth === 0 ? "/v1/handle" : "Handle", {}, (s) => {
    if (svc.db === "postgres") dbCall(t, s, "postgres", svc.name, "SELECT");
    else dbCall(t, s, "redis", "0", "GET");
    if (svc.children.length === 0 || depth >= 6) return;
    const fanOut = Math.min(svc.children.length, t.rnd.int(1, 2));
    for (let i = 0; i < fanOut; i++) {
      runTierService(t, s, t.rnd.pick(svc.children), depth + 1);
    }
  });
}

// ---------------------------------------------------------- unconnected

function reportCron(t) {
  t.span(
    "report-cron",
    null,
    { name: "daily-revenue-report", kind: KIND.INTERNAL, errorRate: 0.01 },
    (job) => {
      dbCall(t, job, "postgres", "reporting", "SELECT", {
        slowMs: 400,
        address: "reporting-db.internal",
      });
    }
  );
}

function nightlyExport(t) {
  t.span("nightly-export", null, {
    name: "export-orders-csv",
    kind: KIND.INTERNAL,
    selfMs: t.rnd.int(200, 900),
    errorRate: 0.01,
  });
}

function legacyBilling(t) {
  t.span(
    "legacy-billing",
    null,
    { name: "reconcile", kind: KIND.INTERNAL, errorRate: 0.03 },
    (job) => internal(t, job, "compute-totals")
  );
}

// ----------------------------------------------------------------- traces

function createShop(services, rnd) {
  const tiers = services > 20 ? buildTiers(services - 20, rnd) : [];
  const flows = [...FLOWS];
  if (tiers.length > 0) {
    // Enough traffic to touch most generated services within a few minutes.
    flows.push({
      weight: 20 + Math.min(80, tiers.flat().length / 4),
      path: "/api/domain",
      run: (t, gw) => runTierService(t, gw, t.rnd.pick(tiers[0]), 0),
    });
  }
  const total = flows.reduce((a, f) => a + f.weight, 0);

  /** One trace starting at `startNs`; returns its `{svc, span}` list. */
  return function makeTrace(startNs) {
    const t = new TraceBuilder(rnd, startNs);
    const roll = rnd.next();
    // Background jobs: rare, never connected to the shop.
    if (roll < 0.01) reportCron(t);
    else if (roll < 0.015) nightlyExport(t);
    else if (roll < 0.02) legacyBilling(t);
    else {
      let pick = rnd.next() * total;
      const flow = flows.find((f) => (pick -= f.weight) < 0) ?? flows[0];
      t.span(
        "web-frontend",
        null,
        {
          name: `GET ${flow.path}`,
          kind: KIND.SERVER,
          attrs: { "http.request.method": "GET", "http.route": flow.path },
        },
        (fe) => {
          httpCall(t, fe, "api-gateway", `/api${flow.path}`, {}, (gw) => {
            internal(t, gw, "rate-limit");
            authCheck(t, gw);
            flow.run(t, gw);
          });
        }
      );
    }
    return t.spans;
  };
}

// ------------------------------------------------------------------- send

function encode(entries) {
  const bySvc = new Map();
  for (const { svc, span } of entries) {
    let list = bySvc.get(svc);
    if (!list) bySvc.set(svc, (list = []));
    list.push(span);
  }
  return JSON.stringify({
    resourceSpans: [...bySvc].map(([svc, spans]) => ({
      resource: {
        attributes: toAttributes({
          "service.name": svc,
          "service.namespace": "shop",
          "service.version": "1.4.2",
          "deployment.environment.name": "demo",
        }),
      },
      scopeSpans: [
        {
          scope: { name: "service-map-demo", version: "1.0.0" },
          spans,
        },
      ],
    })),
  });
}

function createSender(cfg) {
  let posts = 0;
  let spansSent = 0;
  let bytesSent = 0;
  let last = 0;

  async function post(entries) {
    const body = encode(entries);
    const bytes = Buffer.byteLength(body);
    if (bytes >= MAX_BODY_BYTES && entries.length > 1) {
      const mid = Math.ceil(entries.length / 2);
      await post(entries.slice(0, mid));
      await post(entries.slice(mid));
      return;
    }
    if (bytes >= MAX_BODY_BYTES) {
      fail(
        `one span encodes to ${bytes} bytes, over the ${MAX_BODY_BYTES} limit`
      );
    }
    const wait = last + cfg.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    let res;
    try {
      res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (err) {
      fail(`POST ${cfg.endpoint} failed: ${err.cause?.message ?? err.message}`);
    }
    last = Date.now();
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      fail(
        `POST ${cfg.endpoint} -> ${res.status}: ${text.slice(0, 200)} ` +
          `(${entries.length} spans, ${bytes} bytes)`
      );
    }
    posts++;
    spansSent += entries.length;
    bytesSent += bytes;
    console.log(
      `chunk ${posts}: ${entries.length} spans, ${bytes} bytes, ${res.status}`
    );
  }

  let buffer = [];
  return {
    /** Queues one trace's spans; POSTs whenever a chunk is full. */
    async add(spans) {
      for (const s of spans) buffer.push(s);
      while (buffer.length >= cfg.chunkSpans) {
        const chunk = buffer.slice(0, cfg.chunkSpans);
        buffer = buffer.slice(cfg.chunkSpans);
        await post(chunk);
      }
    },
    async flush() {
      if (buffer.length === 0) return;
      const chunk = buffer;
      buffer = [];
      await post(chunk);
    },
    totals: () => ({ posts, spans: spansSent, bytes: bytesSent }),
  };
}

const nsOfMs = (ms) =>
  BigInt(Math.floor(ms)) * MS_NS + BigInt(Math.floor((ms % 1) * 1e6));

// ------------------------------------------------------------------- main

async function main() {
  const cfg = parseFlags(process.argv.slice(2));
  const rnd = createRandom(cfg.seed);
  const makeTrace = createShop(cfg.services, rnd);
  const sender = createSender(cfg);
  const started = Date.now();

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
  });

  // Backfill [start - window, start): traces evenly spread with jitter,
  // oldest first, streamed through the chunker.
  const windowMs = cfg.backfillMinutes * 60_000;
  const backfillTraces = Math.round((windowMs / 1000) * cfg.rate);
  console.log(
    `service-map-demo: ${cfg.services} services, ${cfg.rate} traces/s, ` +
      `backfilling ${cfg.backfillMinutes} min (${backfillTraces} traces) to ${cfg.endpoint}`
  );
  const from = started - windowMs;
  for (let i = 0; i < backfillTraces && !stopping; i++) {
    const at = from + ((i + rnd.next()) * windowMs) / backfillTraces;
    await sender.add(makeTrace(nsOfMs(Math.min(at, started - 1000))));
  }
  await sender.flush();
  const backfilled = sender.totals();
  console.log(
    `backfill done: ${backfilled.spans} spans in ${backfilled.posts} POSTs ` +
      `(${(backfilled.bytes / 1024 / 1024).toFixed(1)} MiB, ${((Date.now() - started) / 1000).toFixed(1)} s)`
  );

  if (!cfg.once) {
    console.log("streaming; Ctrl+C to stop");
    // Each second, the traces due since the last tick, spread over that
    // interval (the first tick also fills the time the backfill took).
    let emittedTo = started;
    while (!stopping) {
      const now = Date.now();
      const due = ((now - emittedTo) / 1000) * cfg.rate;
      const n = Math.floor(due + rnd.next());
      for (let i = 0; i < n; i++) {
        const at = emittedTo + ((i + rnd.next()) * (now - emittedTo)) / n;
        await sender.add(makeTrace(nsOfMs(at)));
      }
      emittedTo = now;
      await sender.flush();
      await sleep(Math.max(0, 1000 - (Date.now() - now)));
    }
  }

  const total = sender.totals();
  console.log(
    `total: ${total.spans} spans in ${total.posts} POSTs, ` +
      `${(total.bytes / 1024 / 1024).toFixed(1)} MiB`
  );
}

main().catch((err) => fail(err.stack ?? String(err)));
