<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Modified for Kopai, 2026: example entries rewritten for service
     telemetry in Kopai. -->

# lessons.md — the living incident log

<!-- Seeded by kopai-oncall-setup Phase 1 from your incident history; appended by
     Claude after every incident without asking (ONCALL-RULES.md rule 8); pruned
     by humans whenever. Newest first, below the status banner. -->

Status: {{one line, kept current — e.g. "quiet week; watching payments
p95 after the pool-size change in INC-example; next: promote
#dependency-failure (3 recurrences)"}}

<!-- The banner is the resume point: anyone (or any session) picking this
     file up reads the first five lines and knows where things stand.
     Claude updates it whenever it appends an entry. -->

## Entry formats — three kinds

**Incident entry** (the default — a resolved incident or a died hypothesis):

```
## {{date}} · {{one-line title}} · #{{failure-class-tag}} · {{INC-nnn or thread link}}
- What happened: {{one fresh-reader sentence}}
- Root cause: {{mechanism, with evidence link}}
- Fix: {{what resolved it, who decided}}
- Gotcha / rule: {{the reusable lesson — the reason this file exists}}
```

**Investigation entry** (a long or inconclusive investigation worth its
trail — so no future session re-walks the same dead ends):

```
## {{date}} · Investigation: {{what}} · #{{tag}} · {{thread link}}
| step | result |
|---|---|
| {{check run}} | {{✅/❌ + link}} |
- Checked out on paper: {{everything that SHOULD make it work, each
  verified ✅ — the signature move before declaring a mystery}}
- Could not verify: {{what, why, and the exact one-line command the owner
  should run — hand the human a grep, not a mystery}}
- Rabbit holes eliminated: {{hypothesis → the evidence that killed it}}
- Confidence: {{~N%, and what the remaining % is, named}}
```

**GOTCHA one-liner** (a tool or environment surprise, not an incident):

```
- GOTCHA ({{date}}): {{the surprise, and the rule it implies — one line}}
```

## Graduation

When a tag accumulates **3 entries with the same mechanism**, or an entry
stops being a story and becomes a _procedure_ (a checklist someone could
follow cold), promote it into that class's playbook (`playbooks/<class>.md`) by PR
(ONCALL-RULES.md rule 9) and replace the entries with one pointer line. Record
the promotion itself as an entry — the playbook's provenance points
back here.

---

## 2026-06-30 · Example: checkout 500s after a config deploy · #error-spike · INC-example

- What happened: checkout's error rate went from 0.3% to 9% within two
  minutes of a deploy; other services were flat.
- Root cause: the deploy shipped a payments client timeout of 200 ms
  (it was 2 s). Evidence: Kopai error rate by `service.name` and
  `http.route` (link), error spans all `POST /checkout` with
  `StatusMessage` "context deadline exceeded" on the payments client span
  (trace link), deploy timestamp 14:02 vs onset 14:03.
- Fix: a human rolled back the config; error rate back to 0.3% within
  10 minutes (verified with the same Kopai query).
- Gotcha / rule: when one route spikes right after a deploy, compare the
  failing span's own attributes with the previous deploy before reading
  any logs. The span already says which call timed out.

## 2026-06-22 · Example investigation: payments traces went quiet, error rate flat · #telemetry-gap · thread-link

| step                                          | result                                          |
| --------------------------------------------- | ----------------------------------------------- |
| payments still serving (load balancer health) | ✅ (link)                                       |
| span volume from payments in Kopai            | ❌ down 92% since 09:40 (link)                  |
| error rate on the spans that did arrive       | ✅ flat (link)                                  |
| exporter errors in payments' own logs         | ❌ no logs from payments in Kopai either (link) |

- Checked: the service was serving, and what little telemetry arrived
  looked healthy, which is exactly why no alert fired.
- Could not verify: whether the collector was dropping data or payments
  stopped exporting. The owner should check: {{the collector's own
  dropped-spans metric, drafted}}.
- Rabbit holes eliminated: "payments got quieter" → request volume at the
  load balancer unchanged (link).
- Confidence: medium that payments' exporter lost its endpoint after the
  09:38 config change; the one thing that would change my mind is
  collector-side drops at 09:40. (Graduated into `playbooks/telemetry-gap.md`.)

## 2026-06-14 · Example: theorized from config instead of checking metrics · #process · thread-link

- What happened: an hour spent on a plausible config theory the metrics
  didn't support.
- Root cause: config review before data review.
- Fix: n/a (process lesson).
- Gotcha / rule: query the data first, then theorize. Config tells you what
  _could_ go wrong; metrics tell you what _did_. (Promoted to ONCALL-RULES.md
  rule 5.)

- GOTCHA (2026-06-08, example): the team's code-search tool silently
  treats files containing multibyte UTF-8 as binary and returns no
  matches — an hour lost to phantom "reverted" code. When evidence says
  something impossible, suspect the measuring instrument first.
