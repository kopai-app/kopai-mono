---
name: kopai-verify-fix
description: >
  After a human deploys a fix or mitigation, check with Kopai whether the
  incident's signal is back to normal: re-run the incident's own queries at
  three bounded checkpoints, compare with the service's baseline, and post
  "back to baseline", "not yet" or "partial verification". Use when someone
  says a fix, rollback, flag change or scale-up is out ("rolled back, can
  you check?", "is it fixed?", "verify the fix"), or when kopai-triage hands
  over after a fix lands.
license: Apache-2.0
---

<!-- Copyright 2026 Anthropic PBC; Copyright 2026 Kopai -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Expands step 9 of the On-Call Kit's triage skill ("watch it land")
     into its own skill for Kopai. See NOTICE. -->

# Verify a fix with Kopai

Standing rules in `ONCALL-RULES.md` apply — especially: never mark an
incident resolved (rule 2); every claim carries evidence (rule 4); a
missing signal is never a green signal (rule 18). You report what the
data shows. A human closes the incident.

Use the Kopai `query` tool (its prefix depends on how Kopai is connected)
and follow its schema.

## Inputs

Collect these from the incident thread or from kopai-triage's handoff. If
any is missing, ask once, then work with what you have and say what was
missing.

- **The symptom signal**: the exact measure that showed the incident
  (for example `ERROR_RATE` of `checkout` server spans, `P95` of
  `Duration` on `POST /pay`, span `COUNT` from `payments`)
- **Onset time** and **fix time** (when the human said the fix was out)
- **The baseline**: that service's normal range from `BASELINES.md` in the
  team's on-call repo, or, if there is none, the same hours of the
  previous day measured with the same query
- **Expected resolution window**: from the playbook or reference used in
  triage; default 15 minutes if none names one

## Procedure

1. **Verify through the same door the failure came in.** Re-run the query
   that detected or diagnosed the incident, with the same filters and
   grouping. Never swap in a proxy: "overall error rate is fine" does not
   verify one failing route. If you cannot re-run the original query (the
   service stopped reporting, access changed), the verification is
   partial; say what you cannot see.

2. **Three checkpoints, not a polling loop.** Check at half the expected
   resolution window, at the full window, and at double it. Each check is
   one `timeSeries` at `1m` (or `5m` for windows over 2h), `absolute`, from
   15 minutes before the fix to now. Do not poll in between unless a human
   asks for tighter watching.

   In Claude Tag, the later checks can be one-off follow-ups in this
   thread ("check again at 14:25"). Say in the thread exactly when each
   will run. They end once they fire, so they are not standing work and
   need no entry in the routine registry. In a local session, tell the
   human when to ask again rather than waiting in a loop.

3. **Judge each checkpoint against the baseline:**

   | Result                                                    | Meaning                                                                                          |
   | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
   | The last 3 complete buckets are inside the baseline range | **Back to baseline**                                                                             |
   | Clearly lower than at onset, still above baseline         | **Improving, not yet back**                                                                      |
   | No better than before the fix                             | **Not working**: say so plainly                                                                  |
   | Fewer rows or less volume than baseline                   | **Cannot confirm**: a quiet signal is not a healthy one. Check span `COUNT` before anything else |

   Use only complete buckets: the current minute is still filling. A
   time series has no row for a minute with no data, so a series that
   simply stops looks like healthy old buckets: check that the last
   `bucket_start` is within one granularity of now before trusting
   "the last 3 buckets".
   Volume matters too: an error rate back to normal on a tenth of the
   usual traffic means the service may not be serving.

4. **Post each checkpoint in the incident thread**, short:

   > **Fix check 2 of 3 (14:20):** checkout error rate 0.4% over the last
   > 3 minutes, inside its 0.2–0.8% baseline; traffic back to 1,150
   > spans/min (baseline 900–1,400). Back to baseline.
   > Evidence: {{query or Kopai UI link}}.
   > Next check 14:30. A human closes the incident.

   Never post "resolved" or "fixed". Post "back to baseline", and let a
   human close it.

5. **At the final checkpoint:**
   - Back to baseline → say so, list the evidence, and hand over to the
     human to close. Then append the verification to the incident's
     `lessons.md` entry (rule 8).
   - Not back by double the window → the fix hypothesis is probably wrong.
     Say so, escalate per `ONCALL.md`'s routing tree, and suggest
     returning to kopai-triage with the fix ruled out.
   - Partial verification → name exactly what you could and could not
     see, and who could check the rest.
