<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Structure from the On-Call Kit's triage references; content written
     for Kopai. See NOTICE. -->

# Triage reference: latency regression

> A Kopai default reference. The team's own `playbooks/` take precedence.
> Rows marked `(Kopai default)` are hypotheses, not this team's history.

## Symptoms

- A latency alert fired (p95/p99 or average above threshold)
- Timeouts reported by callers or users
- "The app feels slow", with no clear errors

## First checks (in order — stop when the timeline explains the symptom)

`Duration` is in nanoseconds (1 ms = 1e6, 1 s = 1e9). Use `P95`/`P99` if
`STACK.md` says percentiles are available; otherwise `AVG` and `MAX`, and
call them that in the diagnosis, never "p95".

1. **Scope it.** Latency by service over the incident window, compared
   with `BASELINES.md`:

   ```json
   {
     "signal": "traces",
     "mode": "aggregate",
     "measures": [
       { "op": "P95", "column": "Duration", "as": "p95_ns" },
       { "op": "COUNT", "as": "spans" }
     ],
     "dimensions": ["service.name"],
     "filters": [{ "column": "SpanKind", "op": "eq", "value": "Server" }],
     "timeDimension": {
       "type": "absolute",
       "startTime": "<start>",
       "endTime": "<end>"
     },
     "output": { "type": "summary" },
     "orderBy": [{ "type": "measure", "alias": "p95_ns", "direction": "desc" }],
     "limit": 20
   }
   ```

   Filtering to server spans measures what callers experience; drop the
   filter to see internal spans too.

2. **Pin the onset.** The same measure as a `timeSeries` at `1m` for the
   affected services. A step change points at a change (deploy, config);
   a slow climb points at load or a resource running out.
3. **Load or code?** `COUNT` as a `timeSeries` over the same window. Did
   throughput rise at onset? Latency that tracks traffic is saturation;
   latency that rises at flat traffic is a change or a slow dependency.
4. **Where is the time going?** Group by `http.route`, then pull the 5
   slowest raw server spans (`orderBy` `Duration` desc) and open one full
   trace by `TraceId`. Find the child span that takes most of the time:
   a database call (`db.system.name`), an outbound call (`SpanKind`
   `Client`, `server.address`), or the service's own work.
5. **Timeline.** Deploys, flags and config changes in the hour before
   onset, and changes on the slow dependency's side.

## Correlation table

| If you see                          | And                                                     | It usually means                               | Then                                                                                                  |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Step change in latency at a deploy  | the slow span is new or newly repeated (an N+1 pattern) | a code change added work per request           | propose rollback _(Kopai default)_                                                                    |
| Most of the time in one `db.*` span | `db.query.summary` is the same across slow traces       | a slow query or a missing index                | route to the owner of that query; propose a fix, never run DDL _(Kopai default)_                      |
| Most of the time in one client span | that dependency's own server spans are slow too         | the dependency is the cause                    | switch to `dependency-failure.md` _(Kopai default)_                                                   |
| Latency tracks throughput           | no deploy in the window                                 | saturation (CPU, connection pool, thread pool) | check resource metrics via `metrics_discover`; propose scaling for a human to apply _(Kopai default)_ |
| Long gaps between child spans       | no slow child span                                      | queuing or lock contention inside the service  | look for pool or lock metrics; escalate to the owner _(Kopai default)_                                |

## Known causes

Check `lessons.md` for entries tagged `#latency-regression`.

## Escalation

- Above the latency paging threshold in `ONCALL.md` on a customer-facing
  path → page per the routing tree
- Below it → business-hours ping with the slow route and span named
- Expected resolution window: ~15 min after a rollback or scale-up. Under
  saturation, latency can lag the fix while queues drain; say so rather
  than declaring the fix failed early.
