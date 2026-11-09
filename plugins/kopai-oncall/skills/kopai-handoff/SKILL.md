---
name: kopai-handoff
description: >
  Write the weekly on-call handoff with Kopai telemetry: everything the
  incoming on-call needs, triage-ready, posted to the channel at shift
  boundary, including each key service's week-over-week error rate,
  latency and volume from Kopai. Use when the weekly routine fires, or when
  someone asks for a handoff / shift summary / "catch the next on-call up".
---

<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Modified for Kopai, 2026: renamed from handoff; the metrics sweep and a
     "Service health" section come from Kopai queries; the drift check
     covers BASELINES.md. See NOTICE. -->

# Kopai handoff

Standing rules in `ONCALL-RULES.md` apply — especially rules 10 and 11: fresh
reader, lead with what to do. The incoming on-call missed everything; this
document is their entire week's context, and it must arrive as **work they
can start**, not "here's what happened".

## Sources — sweep all of them

Fan out across every capability in `STACK.md` for the shift window
(default: the week since the last handoff):

- `pager` — every page and incident: state, severity, resolution
- `alert-channels` — what fired, what people said, what never got a thread
- `code` — merges/PRs touching on-call-relevant paths; reverts; deploys
- `metrics` / `traces` in Kopai — week-over-week trend of the health
  signals in `ONCALL.md`. For each service with a paging criterion, query
  this week and last week with the same measures (`ERROR_RATE`, latency as
  `STACK.md` allows, span `COUNT`), as `summary` per week and a
  `timeSeries` at `6h` for the shape (a week at `1h` is 169 buckets per
  service, and the 500-row aggregate cap is refused, not truncated). Use
  `absolute` windows aligned to the shift boundaries, never `relative`.
- `paging-log.md` — every page and no-page decision this shift: the
  source for the on-call health and intake health numbers
- `lessons.md` — every entry appended this shift
- each incident record's history over the shift window

Cross-reference: an alert with no thread, a lessons entry with no incident,
a metric trending wrong with no alert — these orphans are usually the "watch
this week" items.

## Format

Post to the channel as a message with the exec summary, full doc attached or
linked:

> 📋 **On-call handoff — week of {{date}}**
>
> **Exec summary:** N incidents (n resolved, n monitoring). N pages.
> Anything systemic in one clause.
> **On-call health:** the required weekly metric — incidents and pages
> vs. last week, split by business-hours / off-hours, false pages, the
> **rubber-stamp fraction** (diagnoses acted on with no recorded
> verification step — the early warning that humans stopped
> cross-examining; see eval/replay.md), and whether the trend is up or
> down. This section is how the whole setup is
> measured over time (see eval/replay.md), so never omit it and never
> soften it.
> **Intake health:** median and worst time from symptom onset to incident
> declared this week (onset from the alert/thread timeline; declaration
> from the incident record). If incidents routinely run 40 minutes before
> anyone declares one, that's the process finding of the week — you can't
> fix an intake path you don't measure.
> **Service health:** one line per key service: error rate, latency and
> volume this week vs. last week and vs. `BASELINES.md`, with the
> direction. Name the measure ("p95" only where percentiles are
> available). Services with no data this week are listed as "no data",
> never as healthy (ONCALL-RULES.md rule 18).
> **Watch this week:** the 1–3 things most likely to page you, each with
> why and a link to its pattern (`lessons.md` tag or playbook in `playbooks/`).
> **Start here:** the single highest-priority open item, with its current
> state and next action.
> **Full doc:** [link] · New to this channel? Read `ONBOARD.md` — how to
> read a diagnosis, challenge one, or silence a routine.

The full doc, per incident: **what happened** (one fresh-reader sentence,
links) · **what it means** (pattern or one-off? systemic risk?) · **what you
should do** (nothing / monitor / action, with the action named).

Then: open items ranked by "will this page you?", not by age. Preventable
repeats called out as playbook gaps with proposed `playbooks/` amendments
(rule 9 — fix the playbook, not just the incident).

## Drift check (required section)

The ground moves between incidents; this is where the plugin notices. Each
week, flag:

- any `STACK.md` binding that failed or 403'd during the week's work
- any playbook whose first checks cite a tool or query that no
  longer responds, including Kopai queries that now return no rows
  because a service was renamed or stopped reporting
- `BASELINES.md` older than about a month, or services in Kopai's
  inventory that are missing from it: propose re-running the baseline
  step of kopai-oncall-setup
- anything in the `deploys` feed or announcement channels suggesting the
  infrastructure changed under the playbooks — a migration completed, a
  tool replaced, a service renamed
- the routine registry vs. reality: does the "Standing work" canvas match
  the channel's actual routines? Fix the registry; flag any routine that
  exists but was never registered
- open incidents with no update in >{{72h}} — the zombie list, each with
  its three-leg staleness evidence per ONCALL.md's lifecycle section,
  framed as "close it or update it", never closed by Claude (rule 2)

Each flag arrives as a proposal, never an edit (rule 9): "re-run Discover
for this binding," a `playbooks/` amendment PR, or "re-run the replay
against post-change incidents" (see eval/replay.md's re-validation
triggers). A quiet week with no drift gets one line: "no drift detected."

## Discipline

- "Here's what happened" without "start here" is a diary, not a handoff —
  the priorities are the point.
- Never soften a preventable repeat. Write it plainly: "2 rollbacks,
  both preventable."
- If the week was quiet, say so in two lines and stop. Padding a quiet week
  erodes trust in loud ones.
