<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Structure from the On-Call Kit's triage references; content written
     for Kopai. See NOTICE. -->

# Triage reference: telemetry gap

> A Kopai default reference. The team's own `playbooks/` take precedence.
> Rows marked `(Kopai default)` are hypotheses, not this team's history.

A missing signal is never a green signal (ONCALL-RULES.md rule 18). When
telemetry goes quiet, every dashboard looks calm, which is why this class
is easy to miss and expensive when it is real.

## Symptoms

- A dashboard or query is empty for a service that should be busy
- Span or log volume from a service dropped sharply
- An alert fired on volume, or a person says "we see no data"
- Errors look better at the same moment users report problems

## First checks (in order — stop when the timeline explains the symptom)

1. **Rule out the query.** Re-run with `service.name` (dotted, exact
   value from the service inventory in `STACK.md`), a wide window, and no
   other filters. Most "no data" reports are a wrong column, value or
   window.
2. **Volume over time, per signal.** Span `COUNT` by `service.name` as a
   `timeSeries` at `5m`, then the same for logs:

   ```json
   {
     "signal": "traces",
     "mode": "aggregate",
     "measures": [{ "op": "COUNT", "as": "spans" }],
     "dimensions": ["service.name"],
     "filters": [
       { "column": "service.name", "op": "in", "values": ["<service>"] }
     ],
     "timeDimension": {
       "type": "absolute",
       "startTime": "<start>",
       "endTime": "<end>"
     },
     "output": { "type": "timeSeries", "granularity": "5m" },
     "limit": 500
   }
   ```

   A time series has no row for a bucket with no data, so a service that
   went silent shows a series that just stops: compare the last
   `bucket_start` with the window end. Compare with `BASELINES.md`. Did one
   signal stop, or all of them? One service, or every service?

3. **Is the service actually serving?** Check outside Kopai: load
   balancer health, callers' client spans to it (do callers still see
   successful calls?), the pager, user reports. Callers' client spans in
   Kopai are the best evidence: they come from a different exporter.
4. **Timeline.** Deploys and config changes to the service, the
   collector, or the export path (endpoints, keys, sampling settings) in
   the hour before the drop.

## Correlation table

| If you see                                    | And                                      | It usually means                                 | Then                                                                                           |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| One service's spans stop                      | callers still see successful calls to it | its exporter broke (endpoint, auth, crashed SDK) | route to its owner; the service is up but blind _(Kopai default)_                              |
| One service's spans stop                      | callers' calls to it fail                | the service is down                              | page-severity: this is an outage, not a telemetry issue _(Kopai default)_                      |
| Every service drops at once                   | —                                        | the collector or the ingest path is failing      | route to whoever runs the collector; nothing else can be trusted until fixed _(Kopai default)_ |
| Volume drops by a fixed fraction              | at a config change                       | a sampling setting changed                       | confirm the sampling config; rates are still valid, counts are not _(Kopai default)_           |
| Traces present, logs missing (or the reverse) | —                                        | one signal's exporter or pipeline broke          | route to the owner of that signal's pipeline _(Kopai default)_                                 |

## Known causes

Check `lessons.md` for entries tagged `#telemetry-gap`. For instrumentation
fixes, Kopai's otel-instrumentation skill (`npx skills add kopai-app/kopai-mono`)
has the troubleshooting guides for missing spans, missing attributes and no data.

## Escalation

- Service down → page per `ONCALL.md`
- Service up but not reporting → business-hours ping to its owner, unless
  `ONCALL.md` treats loss of visibility on a critical service as a page
- Expected resolution window: ~10 min after the exporter or collector is
  fixed. Verify by volume returning to its baseline, not by errors staying
  low.
