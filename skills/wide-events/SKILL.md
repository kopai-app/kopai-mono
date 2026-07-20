---
name: wide-events
description: Wide events (canonical log lines) over OpenTelemetry — one context-rich log record per unit of work, emitted in the unit's span context so trace and span ids correlate logs to traces with zero plumbing. Use when implementing wide-event logging on a traced app, connecting logs to spans/traces, deciding which context belongs on spans vs log records, or consolidating scattered per-request log lines into one queryable event. Tracing must exist first — set it up with otel-instrumentation.
license: Apache-2.0
metadata:
  author: kopai
  version: "0.1.0"
---

# Wide Events over OpenTelemetry

The wide event is the log-side twin of the unit-of-work span. The span owns
timing, hierarchy, and step-level detail; the wide event owns the
high-cardinality business record — emitted exactly once per unit of work
(RPC procedure execution, job attempt) through the OTel Logs API, inside the
unit's span context, so `trace_id` and `span_id` land on the record
automatically. Cross-service correlation rides W3C trace propagation;
hand-rolled request-id plumbing is retired.

## Quick Reference

```bash
# One event per unit, joined to its trace
npx @kopai/cli logs search --service my-service --json
npx @kopai/cli logs search --trace-id <traceId> --json

# Select by producer class, then by event type (rule 7)
npx @kopai/cli logs search --log-attr "log_source=wide_event" --json
npx @kopai/cli logs search --log-attr "event.name=job.attempt" --json

# Prove dimensionality: query by a business field
npx @kopai/cli logs search --log-attr "user.subscription=premium" --json
```

## Workflow

1. **Confirm the trace baseline** — every unit of work you intend to log
   already has a span (server span, RPC span, job span). Missing spans → run
   `otel-instrumentation` first. Done when each unit's span appears in
   `traces search`.
2. **Define the units of work and the envelope** — enumerate the business
   operations (rule 1), then fix the envelope and naming (rules 5–6). Done
   when the schema exists as typed code, not a convention doc.
3. **Build the carrier and emitter** — the event rides the OTel Context
   (rule 3); one emitter per service, severity derived from outcome.
4. **Wrap each unit of work** — the wrapper opens the event where the unit's
   span begins, handlers and services enrich it, and the wrapper emits once in
   `finally` (rule 4).
5. **Consolidate** — retire the per-unit log lines and framework sinks the
   event supersedes (rule 8). Done when a unit of work produces one wide
   event, not N lines.
6. **Validate with Kopai against live traffic** — unit tests prove emission;
   only production-shaped data proves the attributes tell the truth (both
   attribute lies found in first use — a framework's explicit-zero default and
   a scheduler-inflated queue wait — passed every unit test). Done when all of:
   - a batched request yields N events sharing one trace id;
   - a failing unit yields one ERROR event with its error code, stack on the
     span only;
   - `logs search --trace-id <id>` returns the unit's events, and the trace's
     spans show the unit with its children;
   - the discriminator queries return disjoint, complete sets;
   - a query by a business attribute finds the event;
   - the sinks you retired produce zero new records, and excluded units
     (health checks) stay silent.

## Core Rules

### 1. One event per unit of work, not per request (CRITICAL)

The unit of work is the business operation a human would ask about — an RPC
procedure execution, a job attempt — never the transport envelope. A batched
RPC request yields N wide events sharing one trace; a retried job yields one
event per attempt. Health checks and telemetry plumbing get no events: they
would dominate volume with zero business context. Failures that never enter a
unit (a request to a nonexistent RPC path) are the narrative logger's job —
keep the framework's error hook logging there, because no event will exist.

### 2. Span vs wide event (CRITICAL)

The span answers "where did time go, what called what"; the wide event answers
"what happened, to whom". Cardinality is not the dividing line — a user id on
a span is fine. The real span constraints are bulk (attribute limits) and
sampling exposure (span attributes vanish for sampled-out traces; log records
survive). So: identity join keys (user id, operation name, job id) live
deliberately on both signals, keeping each independently queryable; bulk
business context lives only on the wide event; stack traces live only on the
span's exception event. Nothing moves off existing spans when the event
arrives.

### 3. Carry the event in the telemetry context (CRITICAL)

The wrapper binds the event to the OTel Context and runs the unit inside
`context.with(...)` — the same async propagation spans already use — so any
code on the unit's path enriches without signature threading. Expose typed
surfaces per audience (an RPC-context helper for resolvers, an exported
`enrichWideEvent(fields)` for services); enrichment outside any unit is a
silent no-op, matching the OTel API philosophy. Apply the envelope at emit
time, after enrichment, so envelope keys cannot be clobbered.

### 4. Exactly once, in finally (CRITICAL)

Build the event through the unit's lifecycle; emit once in `finally` so
failures produce a complete event, not a truncated one. Repeat emits for the
same event are ignored.

### 5. The envelope (HIGH)

Every wide event carries: `event.name` as its type identity
(`trpc.procedure`, `job.attempt` — the schema, not the operation), `outcome`
strictly `success | error`, `duration_ms`, and on failure the error code plus
stackless `exception.type`/`exception.message`. Domain results get their own
namespaced key (`prompt.outcome: skipped_superseded` on a _succeeded_
attempt) — never overload the envelope's `outcome`. The body is a derived
human rendering ("trpc.mutation polls.vote error UNAUTHORIZED 18ms"), never
the source of truth. Environment context (service, version, deployment) comes
from the OTel Resource on every record — per-event env blocks and logger base
fields are obsolete. Severity is binary and derivable: INFO on success, ERROR
on every failure, with expected-error filtering left to attribute queries.

### 6. High cardinality, flat and consistent (HIGH)

Unique ids and many fields are the point — they answer the unknown-unknown
questions ("premium users on the new flow fail") that low-cardinality logs
cannot; business context turns "checkout failed" into "a premium customer
couldn't complete a $2,499 purchase". Keys are flat and dot-namespaced
(`user.id`, not `{user: {id}}`), one name per concept across services, OTel
semconv where a convention exists. Values are domain identifiers, counts,
flags, enums — never request inputs, outputs, or header values (same policy
as span attributes).

### 7. Differentiate producers with a discriminator attribute (HIGH)

Wide events share the log pipeline with narrative logs (framework internals,
process lifecycle bridged from the app logger). Instrumentation scope
separates them structurally, but query tools filter by attribute — so stamp
every record with one deployment-owned discriminator (e.g.
`log_source: wide_event | infra`) at the shared emission layer, plus
`event.name` on wide events as the per-type selector. Each class must be
positively selectable in one query.

### 8. Route the information, don't preserve the sink (HIGH)

Frameworks ship their own log facilities (BullMQ `job.log`, framework request
logs). Judge them on retention, queryability, and correlation — never on
convenience. The wide event must be strictly more durable and more queryable
than any sink it replaces, and every information type the old sink carried
needs a named home: step narration → child spans/span events; outcomes and
context → event fields; in-flight liveness → progress APIs and metrics. The
app logger survives, demoted to infra logs: inside a unit of work, a logger
line is a smell; outside one (lifecycle, framework internals, tooling) it is
correct. Unify at the pipeline, not at the API surface — narrative logs and
events have different shapes, and forcing structured events through a
string-shaped logger is how `"[object Object]"` records happen.

## Gotchas

- **sdk-logs processors take `{ exporter }` options objects** while
  sdk-trace-base processors are positional. A positional exporter exports to
  `undefined` and fails silently into the global error handler — zero records,
  no error. Vitest does not typecheck; run `tsc` alongside the first RED run.
- **Monorepo dual-instance hazard**: a test runner that inlines workspace
  source while consuming packages require built output loads the wide-event
  module twice — two `createContextKey` symbols, two `instanceof` identities —
  and enrichment silently misses the event. Share the context key via
  `Symbol.for` on `globalThis` (the OTel API's own global-registration
  pattern) and duck-type the carrier check instead of `instanceof`.
- **The bare `@opentelemetry/api` global ships a noop context manager**:
  `context.with` does not propagate to `context.active()` in unit tests, so
  context-carried events silently vanish. Register an
  `AsyncLocalStorageContextManager` in the test harness; production gets one
  from the SDK.

## References

- [Stripe — Canonical Log Lines](https://stripe.com/blog/canonical-log-lines)
- [Observability Wide Events 101](https://boristane.com/blog/observability-wide-events-101/)
- [OTel Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
