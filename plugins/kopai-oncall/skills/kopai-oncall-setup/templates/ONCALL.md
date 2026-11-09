<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Modified for Kopai, 2026: examples rewritten for a service team whose
     telemetry is in Kopai; paging criteria are written as Kopai queries. -->

# ONCALL.md — standing on-call policy

<!-- Copy to your repo root. Every {{...}} is filled during kopai-oncall-setup
     Phase 2 (Interview). Mined suggestions may appear as comments; a human
     sets every policy value. This file is policy: changes go by PR. -->

## What this covers

{{one paragraph: the system this on-call owns, in fresh-reader language, and
the channel it runs in}}

Incident severity levels, incident command, and stakeholder communications
remain your team's existing incident-management process — this plugin plugs
into that process and does not replace it: {{link to your incident
process / severity definitions}}. Claude never runs an incident and never
communicates to stakeholders beyond this channel.

## Incident records

An incident exists when a human declares one: {{how, e.g. "start a thread
here beginning 🔴 INC:" / "tag the pager incident checkout" — must match
the `incidents` binding in STACK.md}}. Claude may propose that something
deserves an incident; it never declares one itself.

## Incident lifecycle

Four states. `active` and `stale` are the open pair — stale means "this
looks abandoned: fixed-but-never-closed, or genuinely dropped," a
nobody's-watching alarm, not a closure. `mitigated` (fix in, still
watching) and `resolved` (done) are the closed pair; keep them distinct.
An archived or deleted incident channel/thread means resolved regardless
of what its frozen text says — nobody works an incident in a place that
no longer exists. Claude never changes a state (rule 2); it applies these
rules when deciding what to _report_:

- **Stale takes three legs, never silence alone:** (1) the record/thread
  quiet ≥ {{24h}}; (2) nothing in the alert channels naming it in the last
  hour; (3) its specific symptom absent from current data — and leg 3
  only counts if the relevant time window is complete (a bucket still
  filling proves nothing). If your checks can't see the incident's
  actual symptom, don't call it stale — a healthy proxy covers only the
  path it measures ("checkouts are flowing" proves the checkout path, not
  the whole payment provider). Every "looks stale" nudge carries its
  one-line evidence ("thread quiet 26h; checkouts flowing; no related
  alerts").
- **Promotions climb a ladder; demotions don't.** Suggesting a stale or
  closed incident is live again requires evidence **newer than the
  verdict it would overturn** — and your own earlier posts, or re-reading
  an unchanged status line, never count as activity (or your sweep keeps
  every zombie alive forever). Treating an incident as _quieter_ may rest
  on older evidence: a wrong "quieter" is cheap to fix; a wrong
  resurrection is the failure mode this ladder exists to prevent.
- **No verdict is a verdict.** "Mitigated?" with a question mark,
  "duplicate of INC-…", an unparseable status line: none of these changes
  what you report. Absent evidence never moves state. And someone
  _asking_ "any update?" is a question, not an update — don't let it
  reset the quiet clock.
- **Zombie sweep:** the morning sitrep lists every open incident with no
  update in {{24h}}, and the weekly handoff lists those quiet {{72h}} —
  "record still says active, thread silent since yesterday: close it or
  update it."

## Paging policy

Deterministic alerts page humans directly — always. Claude is never in
the detection path. These criteria serve two purposes: they are the
values Claude uses when **proposing** deterministic rules (starter rules
for new services, tuning proposals after incidents), and they define
page-severity for **Claude's own findings** during triage (a correlation
discovery, an unalerted symptom) — with every page/no-page decision
logged per ONCALL-RULES.md rule 3a. Written in plain English on purpose —
judgment clauses like "not during a known deploy window" are allowed.

**New services** get conservative starter rules before launch — proposed
by Claude by analogy to the closest existing service, installed by a
human — never a monitoring routine. Coarse rules that cannot die
silently beat clever monitoring that can.

| Signal                       | Page when | Sustain   | Exempt when                                 |
| ---------------------------- | --------- | --------- | ------------------------------------------- |
| {{e.g. checkout error rate}} | {{> N%}}  | {{M min}} | {{known deploy window; see Deploy windows}} |
| {{…}}                        | {{…}}     | {{…}}     | {{…}}                                       |

Each signal is written so a Kopai query can evaluate it: {{signal (traces /
logs / metrics), measure, filter, window}}. The baseline each threshold
was set against is in `BASELINES.md`.

<!-- Worked example (a fictional shop's service team) — replace every value:
| Signal | Page when | Sustain | Exempt when |
|---|---|---|---|
| checkout error rate (traces, ERROR_RATE, service.name = checkout) | >2% | 5 min | inside a posted deploy window (see Deploy windows) |
| payments latency (traces, P95 of Duration, service.name = payments) | >1.5 s | 10 min | never |
| error-level logs, any service (logs, COUNT, SeverityNumber gte 17) | >3× the hour's baseline in BASELINES.md | 10 min | load test announced in #perf |
| span volume from a production service | drops >50% vs baseline | 10 min | never: telemetry going quiet is an incident until proven otherwise |
Everything below these lines → lessons.md for the morning sitrep.
Note the volume row: a missing signal is never a green signal
(ONCALL-RULES.md rule 18). Fewer spans with a flat error rate can mean the
service stopped serving, not that it got healthier. -->

Anything observed that does **not** trip these criteria: log to `lessons.md`
for the morning sitrep instead (ONCALL-RULES.md rule 3).

## Severity norms

- **Page** (any hour): {{definition}}
- **Business-hours ping**: {{definition}}
- **Morning log line**: everything else

## Deploy windows

How to check whether a deploy is in progress: {{the `deploys` capability
binding, a channel, a calendar — name it}}

## Routing tree

<!-- Drafted by Mine phase from CODEOWNERS × who-actually-responded;
     conflicts resolved in Interview. Group handles must be real. -->

| Failure class             | Owner           | Notes                |
| ------------------------- | --------------- | -------------------- |
| {{error-spike}}           | {{@group}}      | {{…}}                |
| {{latency-regression}}    | {{@group}}      | {{…}}                |
| {{dependency-failure}}    | {{@group}}      | {{…}}                |
| Anything company-blocking | {{@escalation}} | escalate immediately |

Claude mentions an owner only when this tree names one for the diagnosed
class (ONCALL-RULES.md rule 12).

**Escalation timeout:** a page-severity finding with no human
acknowledgment within {{N minutes}} escalates to {{next handle up the
ladder}}. An acknowledgment is an explicit affirmative from a person
("ack", "on it", or {{designated reaction}}) — bot posts, alert traffic,
and passive emoji don't count. One escalation only — never a loop.
**Terminal step** if the escalation also goes unacked: {{repeat-page via
the pager's escalation policy / post to #wider-channel / accepted
"unattended until morning" posture — the team chose deliberately}}.

The ladder has more states than "paged" and "resolved" — each gets a
`paging-log.md` line:

- **Ack-then-silence:** acked, then nothing for {{30 min}} while the page
  condition persists → one (and only one) in-thread nudge naming the
  still-firing signal. Never re-page an acked incident on your own.
- **Re-fire after ack:** the signal cleared and tripped again → a _new_
  paging decision with a new log entry; the old ack doesn't cover a new
  firing.
- **Page unconfirmed:** the page call returned success but the pager
  shows no incident within {{2 min}} → treat as page-failed and take the
  fallback path, noting both in the log.
- **Two page-severity findings at once:** two pages, two entries — unless
  correlation says one cause, in which case one page naming both symptoms
  (triage step 3b).

**Fallback alerting:** if a page-severity finding cannot page (no pager
bound, or the page call fails), Claude instead {{@-mentions @escalation
in this channel / posts to #always-watched-channel / holds for the
morning log}}. Chosen in the Interview; never improvised mid-incident.
Known limitation the team accepted: Slack @-mentions don't penetrate
Do-Not-Disturb — an @-mention fallback is business-hours-grade coverage.

**Out-of-band path (Slack itself down):** {{human-owned note: where the
team coordinates when Slack is unavailable — e.g., the pager's own
incident notes + a video-call bridge. Claude can't help here; this line
exists so the team decides this before an outage, not during one.}}

## Alert-rule proposals

Format: proposals are paste-ready {{monitor JSON / Terraform / PromQL /
UI steps}} for {{alerting tool}} — never prose.
Install mode: {{**human installs** (default — Claude drafts, a human
pastes; the plugin stays fully read-only) / **alert-editor extension** (opt-in:
Claude may CREATE new rules after per-rule approval in the channel;
additive only — never modify, delete, or silence an existing rule; every
write logged to lessons.md; credential noted in STACK.md)}}.

## Read-only guarantee

This agent never changes the state of any monitored system. Its only
outputs are: messages in the channel; entries in this repo's log and
record files (`lessons.md`, `paging-log.md`, `eval/shadow-log.md`,
`alert-coverage.md`, and the setup-owned `STACK.md` and `BASELINES.md`);
updates to the
bound weather report page (only if opted in above); proposed diffs as
PRs; and (where a pager is bound) pages. There is no allowlist
and nothing to configure in this section — it exists so every reader of
this policy knows the contract. All mitigation is performed by humans.

## Status on demand — and the optional weather report

Default: no standing status service. When someone asks for status, answer
from the open incident records plus these health signals: {{e.g.
error rate and p95 latency of the top services in Kopai, open incidents}}.
Fresh-reader rules apply (ONCALL-RULES.md rule 10).

Opt-in: the `kopai-weather` skill (routine 6 in the plugin's routines template, which setup filled in for this repo) — an
event-gated standing report. {{not opted in (default) / opted in on
{{date}}; report page: {{canvas link / repo file}}; cadence targets set
in Interview}}.

If opted in, the mood tier boundaries — set in Interview, read by the
weather skill, never invented by it (ONCALL-RULES.md rule 15):

| Tier          | {{base signal 1, e.g. worst key service error rate vs. baseline}} | {{base signal 2, e.g. worst key service latency vs. baseline}} |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| sunny         | {{all within baseline}}                                           | {{all within baseline}}                                        |
| partly_cloudy | {{one service above baseline < 30 min}}                           | {{one service above baseline < 30 min}}                        |
| overcast      | {{above baseline 30 min–2h, or two services}}                     | {{above baseline 30 min–2h, or two services}}                  |
| stormy        | {{above its paging threshold}}                                    | {{above its paging threshold}}                                 |

Open incidents are not a base signal: the weather skill applies them last,
as a bounded modifier.

## Handoff and sitreps

Weekly handoff cadence: {{e.g. Mondays 8am ET}} · Posted to: {{channel}}
Morning sitrep: {{off (default) / weekdays {{8:30am TZ}}}} — reads
`paging-log.md`, `lessons.md`, and the open incident records; posts
nothing when there is genuinely nothing.
