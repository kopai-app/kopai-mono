<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Structure from the On-Call Kit's triage references; content written
     for Kopai. See NOTICE. -->

# Triage reference: deploy regression

> A Kopai default reference. The team's own `playbooks/` take precedence.
> Rows marked `(Kopai default)` are hypotheses, not this team's history.

## Symptoms

- Errors or latency moved within minutes of a deploy, flag flip or config
  change
- "It started after the release"
- A canary looks different from the rest of the fleet

## First checks (in order — stop when the timeline explains the symptom)

1. **Line up onset and change.** Pin the onset minute from a `1m`
   `timeSeries` (see `error-spike.md` or `latency-regression.md`), then
   list every change in the hour before it from `deploys`, `code` and
   `flags`. The onset minute is the most discriminating fact you have.
2. **Did the version change with the symptom?** If services report
   `service.version`, split the symptom by version over the window:

   ```json
   {
     "signal": "traces",
     "mode": "aggregate",
     "measures": [
       { "op": "ERROR_RATE", "as": "error_rate" },
       { "op": "COUNT", "as": "spans" }
     ],
     "dimensions": ["service.version"],
     "filters": [
       { "column": "service.name", "op": "eq", "value": "<service>" }
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

   The new version failing while the old one is healthy, side by side in
   the same buckets, is close to proof. Kubernetes columns
   (`k8s.deployment.name`, `container.image.tag`) work the same way.

3. **What exactly differs?** Compare a failing span from the new version
   with a healthy one from the old: attributes, child spans,
   `StatusMessage`. Then look at the diff for the matching code path.
4. **Is it still happening?** Before naming the deploy as the live cause,
   confirm the symptom is in the latest complete buckets (rule 5a). A
   rollback or forward fix may already have landed.

## Correlation table

| If you see                                         | And                                              | It usually means                                                          | Then                                                                       |
| -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| New `service.version` fails, old one healthy       | onset matches the rollout                        | the release is the cause                                                  | propose rollback; verify per version _(Kopai default)_                     |
| Symptom starts at a flag change, version unchanged | only requests with the flag on fail              | the flagged code path                                                     | propose turning the flag off, for a human to do _(Kopai default)_          |
| Symptom starts at the deploy but on every version  | the deploy also changed config or infrastructure | a shared config change, not the code                                      | look at config and infra diffs in the same deploy _(Kopai default)_        |
| Telemetry from the service drops at the deploy     | —                                                | the new version doesn't export telemetry (missing config, exporter error) | switch to `telemetry-gap.md`; the service may be healthy _(Kopai default)_ |

## Known causes

Check `lessons.md` for entries tagged `#deploy-regression`.

## Escalation

- Route to the owner of the change (the deploy's author or the owning team
  per the routing tree), with the version comparison as evidence
- Expected resolution window after a rollback: one rollout duration plus
  ~5 min. Verify per version: the old version's traffic share should rise
  and the new version's errors stop.
