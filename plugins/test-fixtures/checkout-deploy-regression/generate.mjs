#!/usr/bin/env node
// Sends a fictional incident's telemetry to a Kopai collector over OTLP/HTTP
// (JSON), so the kopai-oncall skills can be tested against real queries.
//
// Scenario (the answer is in ANSWER-KEY.md; don't read it before testing):
// a small shop with frontend, checkout, payments, inventory and search
// services. 90 minutes of history ending now; something goes wrong partway
// through.
//
// Usage:
//   node generate.mjs [--endpoint http://localhost:4318] [--minutes 90]
//                     [--incident-at 25] [--seed 7]
//
// --incident-at is how many minutes before now the incident starts.
// No dependencies; Node 20 or later.

import console from "node:console";
import process from "node:process";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    endpoint: { type: "string", default: "http://localhost:4318" },
    minutes: { type: "string", default: "90" },
    "incident-at": { type: "string", default: "25" },
    seed: { type: "string", default: "7" },
  },
});

const ENDPOINT = args.endpoint.replace(/\/$/, "");
const MINUTES = Number(args.minutes);
const INCIDENT_AT = Number(args["incident-at"]);

// Seeded PRNG (mulberry32), so every run produces the same shape.
let seed = Number(args.seed) >>> 0;
function random() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + random() * (max - min);
const hex = (bytes) =>
  Array.from({ length: bytes }, () =>
    Math.floor(random() * 256)
      .toString(16)
      .padStart(2, "0")
  ).join("");

const MS = 1_000_000n; // nanoseconds per millisecond
const nanos = (ms) => (BigInt(Math.round(ms * 1000)) * MS) / 1000n;
const str = (key, value) => ({ key, value: { stringValue: String(value) } });
const int = (key, value) => ({ key, value: { intValue: String(value) } });

const SERVER = 2;
const CLIENT = 3;
const STATUS_ERROR = 2;

const now = Date.now();
const windowStart = now - MINUTES * 60_000;
const incidentStart = now - INCIDENT_AT * 60_000;

/** Spans and logs grouped by resource (service + version). */
const batches = new Map();
function resourceKey(service, version) {
  return `${service}@${version}`;
}
function batch(service, version) {
  const key = resourceKey(service, version);
  if (!batches.has(key)) {
    batches.set(key, { service, version, spans: [], logs: [] });
  }
  return batches.get(key);
}

function span(service, version, s) {
  batch(service, version).spans.push({
    traceId: s.traceId,
    spanId: s.spanId,
    ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
    name: s.name,
    kind: s.kind,
    startTimeUnixNano: String(nanos(s.start)),
    endTimeUnixNano: String(nanos(s.start + s.duration)),
    attributes: s.attributes,
    status: s.error
      ? { code: STATUS_ERROR, message: s.statusMessage ?? "" }
      : { code: 0 },
  });
}

function log(service, version, l) {
  batch(service, version).logs.push({
    timeUnixNano: String(nanos(l.time)),
    observedTimeUnixNano: String(nanos(l.time)),
    severityNumber: l.severityNumber,
    severityText: l.severityText,
    body: { stringValue: l.body },
    ...(l.traceId ? { traceId: l.traceId, spanId: l.spanId } : {}),
    attributes: l.attributes ?? [],
  });
}

function checkoutVersion(t) {
  return t >= incidentStart ? "1.5.0" : "1.4.2";
}

/** One customer checkout: frontend → checkout → inventory, payments. */
function checkoutRequest(t) {
  const traceId = hex(16);
  const version = checkoutVersion(t);
  const frontendId = hex(8);
  const checkoutId = hex(8);

  const inventoryMs = between(8, 30);
  // Payments is unchanged throughout: mostly fast, with a slow tail.
  const paymentsMs = random() < 0.15 ? between(180, 420) : between(60, 180);
  // The change that ships at the incident: checkout's client gives payments
  // only 200 ms. Before it, the timeout was 2 s and never hit.
  const timeoutMs = version === "1.5.0" ? 200 : 2000;
  const timedOut = paymentsMs > timeoutMs;
  // Rare, unrelated baseline failure before and after the incident.
  const reservationConflict = !timedOut && random() < 0.004;

  const inventoryClientId = hex(8);
  const inventoryServerId = hex(8);
  const paymentsClientId = hex(8);
  const paymentsServerId = hex(8);

  let cursor = t + between(1, 3);
  span("inventory", "2.0.1", {
    traceId,
    spanId: inventoryServerId,
    parentSpanId: inventoryClientId,
    name: "GET /stock",
    kind: SERVER,
    start: cursor + 1,
    duration: inventoryMs,
    attributes: [
      str("http.request.method", "GET"),
      str("http.route", "/stock"),
      int("http.response.status_code", reservationConflict ? 409 : 200),
    ],
  });
  span("checkout", version, {
    traceId,
    spanId: inventoryClientId,
    parentSpanId: checkoutId,
    name: "GET /stock",
    kind: CLIENT,
    start: cursor,
    duration: inventoryMs + 2,
    attributes: [
      str("http.request.method", "GET"),
      str("server.address", "inventory.internal"),
      int("http.response.status_code", reservationConflict ? 409 : 200),
    ],
  });
  cursor += inventoryMs + 3;

  if (!reservationConflict) {
    span("payments", "3.2.0", {
      traceId,
      spanId: paymentsServerId,
      parentSpanId: paymentsClientId,
      name: "POST /charge",
      kind: SERVER,
      start: cursor + 1,
      duration: paymentsMs,
      attributes: [
        str("http.request.method", "POST"),
        str("http.route", "/charge"),
        int("http.response.status_code", 200),
      ],
    });
    const paymentsClientMs = timedOut ? timeoutMs : paymentsMs + 2;
    span("checkout", version, {
      traceId,
      spanId: paymentsClientId,
      parentSpanId: checkoutId,
      name: "POST /charge",
      kind: CLIENT,
      start: cursor,
      duration: paymentsClientMs,
      error: timedOut,
      statusMessage: timedOut
        ? `context deadline exceeded (client timeout ${timeoutMs}ms)`
        : undefined,
      attributes: [
        str("http.request.method", "POST"),
        str("server.address", "payments.internal"),
        ...(timedOut ? [] : [int("http.response.status_code", 200)]),
      ],
    });
    cursor += paymentsClientMs + 1;
  }

  const failed = timedOut || reservationConflict;
  const checkoutMs = cursor - t + between(2, 6);
  span("checkout", version, {
    traceId,
    spanId: checkoutId,
    parentSpanId: frontendId,
    name: "POST /checkout",
    kind: SERVER,
    start: t + 1,
    duration: checkoutMs,
    error: failed,
    statusMessage: timedOut
      ? "payment call failed"
      : reservationConflict
        ? "inventory reservation conflict"
        : undefined,
    attributes: [
      str("http.request.method", "POST"),
      str("http.route", "/checkout"),
      int("http.response.status_code", failed ? 500 : 200),
    ],
  });
  span("frontend", "5.8.3", {
    traceId,
    spanId: frontendId,
    name: "POST /api/checkout",
    kind: SERVER,
    start: t,
    duration: checkoutMs + 4,
    error: failed,
    statusMessage: failed ? "upstream returned 500" : undefined,
    attributes: [
      str("http.request.method", "POST"),
      str("http.route", "/api/checkout"),
      int("http.response.status_code", failed ? 502 : 200),
    ],
  });

  if (timedOut) {
    log("checkout", version, {
      time: t + checkoutMs - 1,
      severityNumber: 17,
      severityText: "ERROR",
      body: `payment call failed: context deadline exceeded after ${timeoutMs}ms`,
      traceId,
      spanId: checkoutId,
      attributes: [str("peer.service", "payments")],
    });
  }
  if (reservationConflict) {
    log("checkout", version, {
      time: t + checkoutMs - 1,
      severityNumber: 17,
      severityText: "ERROR",
      body: "inventory reservation conflict, order not placed",
      traceId,
      spanId: checkoutId,
    });
  }
}

/** Search: steadily slow the whole time. Unrelated to the incident. */
function searchRequest(t) {
  const traceId = hex(16);
  const durationMs = between(250, 900);
  span("search", "1.9.0", {
    traceId,
    spanId: hex(8),
    name: "GET /search",
    kind: SERVER,
    start: t,
    duration: durationMs,
    attributes: [
      str("http.request.method", "GET"),
      str("http.route", "/search"),
      int("http.response.status_code", 200),
    ],
  });
}

/** Frontend page views. */
function pageView(t) {
  span("frontend", "5.8.3", {
    traceId: hex(16),
    spanId: hex(8),
    name: "GET /",
    kind: SERVER,
    start: t,
    duration: between(15, 60),
    attributes: [
      str("http.request.method", "GET"),
      str("http.route", "/"),
      int("http.response.status_code", 200),
    ],
  });
}

for (let minute = 0; minute < MINUTES; minute++) {
  const minuteStart = windowStart + minute * 60_000;
  const each = (perMinute, fn) => {
    for (let i = 0; i < perMinute; i++) fn(minuteStart + random() * 60_000);
  };
  each(Math.round(between(18, 26)), checkoutRequest);
  each(Math.round(between(12, 18)), searchRequest);
  each(Math.round(between(40, 55)), pageView);
}

log("checkout", "1.5.0", {
  time: incidentStart,
  severityNumber: 9,
  severityText: "INFO",
  body: "checkout 1.5.0 started (payments client: timeout 200ms)",
});
log("checkout", "1.4.2", {
  time: incidentStart - 2_000,
  severityNumber: 9,
  severityText: "INFO",
  body: "checkout 1.4.2 shutting down",
});

function resource(service, version) {
  return {
    attributes: [
      str("service.name", service),
      str("service.version", version),
      str("deployment.environment.name", "production"),
    ],
  };
}

async function post(path, body) {
  const response = await globalThis.fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `${path} answered ${response.status}: ${await response.text()}`
    );
  }
}

const CHUNK = 500;
let spanCount = 0;
let logCount = 0;
for (const { service, version, spans, logs } of batches.values()) {
  for (let i = 0; i < spans.length; i += CHUNK) {
    await post("/v1/traces", {
      resourceSpans: [
        {
          resource: resource(service, version),
          scopeSpans: [
            {
              scope: { name: "kopai-oncall-fixture" },
              spans: spans.slice(i, i + CHUNK),
            },
          ],
        },
      ],
    });
  }
  for (let i = 0; i < logs.length; i += CHUNK) {
    await post("/v1/logs", {
      resourceLogs: [
        {
          resource: resource(service, version),
          scopeLogs: [
            {
              scope: { name: "kopai-oncall-fixture" },
              logRecords: logs.slice(i, i + CHUNK),
            },
          ],
        },
      ],
    });
  }
  spanCount += spans.length;
  logCount += logs.length;
}

console.log(
  `Sent ${spanCount} spans and ${logCount} logs to ${ENDPOINT}, ` +
    `covering ${new Date(windowStart).toISOString()} to ${new Date(now).toISOString()}.`
);
console.log(
  `Alert time for ALERT.md: ${new Date(incidentStart + 6 * 60_000).toISOString()}`
);
process.exitCode = 0;
