<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Structure from the On-Call Kit's triage references; content written
     for Kopai. See NOTICE. -->

# Triage reference: error spike (worked example)

> A Kopai default reference, and the structure every team playbook copies:
> symptoms, first checks, a correlation table, known causes, escalation.
> The team's own `playbooks/` (drafted by kopai-oncall-setup from its
> incident history) take precedence over this file. Rows here are marked
> `(Kopai default)`: they come from how services commonly fail, not from
> this team's history, so treat them as hypotheses to check.

## Symptoms

- An error-rate alert fired for one or more services
- People report 5xx responses, failed checkouts, "something is broken"
- Error-level logs jumped for a service
- A downstream team says calls to this service fail

## First checks (in order — stop when the timeline explains the symptom)

Windows below are `absolute`, from about 2h before onset to now. Replace
`<start>` and `<end>` with ISO datetimes.

1. **Scope it.** Which services, how bad, since when? Rank by error rate,
   but only over services with real traffic (the `havings` line), so a
   service with one failed span out of three doesn't top the list:

   ```json
   {
     "signal": "traces",
     "mode": "aggregate",
     "measures": [
       { "op": "COUNT", "as": "spans" },
       { "op": "ERROR_RATE", "as": "error_rate" }
     ],
     "dimensions": ["service.name"],
     "timeDimension": {
       "type": "absolute",
       "startTime": "<start>",
       "endTime": "<end>"
     },
     "havings": [{ "measure": "spans", "op": "gte", "value": 50 }],
     "output": { "type": "summary" },
     "orderBy": [
       { "type": "measure", "alias": "error_rate", "direction": "desc" }
     ],
     "limit": 20
   }
   ```

   Compare each service's `error_rate` (a fraction, 0–1) with its range in
   `BASELINES.md`. One service or many? Many at once points at a shared
   dependency (see `dependency-failure.md`).

2. **Pin the onset.** `ERROR_RATE` as a `timeSeries` at `1m`, filtered to
   the affected services with `in`. The first bucket clearly above
   baseline is the onset. If the earliest bucket in the window is already
   elevated, widen the window: the onset is earlier.
3. **Timeline.** Everything that changed in the hour before onset: deploys
   (`deploys`/`code`, and a change in `service.version` in Kopai), flag and
   config changes. A change within a few minutes of onset is the first
   hypothesis (see `deploy-regression.md`).
4. **Where in the service.** Group the failing service's errors by
   `http.route` (or `rpc.method`, `SpanName`) and by
   `http.response.status_code`. One route or all of them? 500s or 503s?
5. **Read one failure honestly.** Pull 5 raw error spans
   (`StatusCode` `eq` `"Error"`), then the full trace of one by `TraceId`,
   and its logs by the same `TraceId`. Read `StatusMessage` and the
   earliest error in the chain. A client span that failed (`SpanKind`
   `Client`) means the cause is downstream of this service.

## Correlation table

| If you see                                                 | And                                                | It usually means                                                            | Then                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Errors on one service, starting within minutes of a deploy | a new `service.version` appears at onset           | the deploy introduced the regression                                        | propose rollback; verify error rate returns to baseline _(Kopai default)_              |
| Errors on one route only                                   | its error spans are client calls to one dependency | that dependency is failing or timing out                                    | switch to `dependency-failure.md` for the dependency _(Kopai default)_                 |
| Errors on many services at once                            | they share a database, cache or queue              | shared dependency outage                                                    | find the shared dependency's own spans; route to its owner _(Kopai default)_           |
| Error rate up but span count down sharply                  | —                                                  | the service is failing fast or partly down; the rate understates the outage | check telemetry volume (`telemetry-gap.md`) and load-balancer health _(Kopai default)_ |
| 503s / 429s only                                           | no deploy in the window                            | overload or rate limiting upstream                                          | check throughput (`COUNT` timeSeries) for a traffic surge _(Kopai default)_            |

## Known causes

Check `lessons.md` for entries tagged `#error-spike` before theorizing.

## Escalation

- Customer-facing service above its paging threshold in `ONCALL.md` → page
  per the routing tree
- One internal service, low volume → business-hours ping to its owner
- Expected resolution window after a rollback: ~10 min. If the error rate
  isn't back inside its baseline by then, the deploy hypothesis is wrong —
  go back to check 4 with the deploy ruled out.
