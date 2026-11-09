<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Structure from the On-Call Kit's triage references; content written
     for Kopai. See NOTICE. -->

# Triage reference: dependency failure and cascades

> A Kopai default reference. The team's own `playbooks/` take precedence.
> Rows marked `(Kopai default)` are hypotheses, not this team's history.

## Symptoms

- Several services alert at once
- One service's errors are all on calls to another service, a database,
  a cache or a queue
- Errors spread from one service to its callers over minutes

## First checks (in order — stop when the timeline explains the symptom)

1. **Find the deepest failing service.** Rank services by error rate (see
   `error-spike.md` check 1), then, for the top few, pull raw error spans
   and their full traces. In each trace, the earliest error closest to
   the leaves of the call chain is the candidate origin. Callers fail
   because of it; they are echoes.
2. **Name the dependency.** Group the failing services' client spans
   (`SpanKind` `Client`) by `server.address`, `db.system.name`,
   `rpc.service` or `messaging.destination.name`, with `ERROR_RATE`:

   ```json
   {
     "signal": "traces",
     "mode": "aggregate",
     "measures": [
       { "op": "ERROR_RATE", "as": "error_rate" },
       { "op": "COUNT", "as": "calls" }
     ],
     "dimensions": ["service.name", "server.address"],
     "filters": [{ "column": "SpanKind", "op": "eq", "value": "Client" }],
     "timeDimension": {
       "type": "absolute",
       "startTime": "<start>",
       "endTime": "<end>"
     },
     "output": { "type": "summary" },
     "orderBy": [
       { "type": "measure", "alias": "error_rate", "direction": "desc" }
     ],
     "limit": 30
   }
   ```

   One `server.address` failing from every caller is the dependency.

3. **Is the dependency in Kopai?** If it reports its own spans, check its
   server spans directly (errors, latency, volume). If it doesn't (a
   managed database, a third-party API), the client spans are all you
   have: say so, and check its provider's status page or the team's other
   tools.
4. **Timeline.** Changes to the dependency (its deploys, config, a
   provider incident), and to the callers' clients (timeouts, pool sizes,
   retry settings) in the hour before onset.

## Correlation table

| If you see                                        | And                                         | It usually means                                           | Then                                                                                         |
| ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| All callers fail on one `server.address`          | its own server spans are failing or missing | the dependency is down or degraded                         | route to its owner; the callers need no action _(Kopai default)_                             |
| All callers fail on one dependency                | its own server spans look healthy           | a network, DNS or auth problem between them                | check `StatusMessage` on client spans for TLS, DNS or 401/403 _(Kopai default)_              |
| Client spans time out at a fixed duration         | the dependency's server spans are fast      | client timeout set too low, or a connection pool exhausted | compare the timeout with the dependency's normal latency in `BASELINES.md` _(Kopai default)_ |
| Call volume to the dependency multiplied at onset | errors follow                               | a retry storm amplifying a small failure                   | propose reducing retries or adding backoff, for a human to apply _(Kopai default)_           |

## Known causes

Check `lessons.md` for entries tagged `#dependency-failure`.

## Escalation

- Route to the dependency's owner per the routing tree, not to every
  failing caller. Name the callers as blast radius.
- Third-party dependency → the team's vendor escalation path in `ONCALL.md`
- Expected resolution window: set by the dependency's recovery. Verify on
  the callers' client spans, which is where the failure was seen.
