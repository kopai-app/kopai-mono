---
name: kopai-evidence-page
description: >
  Publish a snapshot evidence page for one incident or alert: the Kopai
  query results already gathered in the thread, charted, stamped with the
  capture time and each query's window, and linked to the Kopai incident
  page. Use only when someone asks for a page or a chart ("@Claude make a
  page", "show me a chart", "put the evidence on a page"). Never publish
  one unasked: by default the reply plus the incident link is the
  evidence. Snapshot only; for a page that refreshes from the viewer's own
  Kopai connector, use create-live-page.
---

# Kopai evidence page (snapshot, on request)

Kopai is the source of truth for an incident; the reply in the thread and
its incident link are the default evidence. A page is a deliberate
record someone asked for. It shows the thread's audience only what the
thread already established, with the numbers baked in: viewing it calls
nothing.

**Why never live.** A page that queries Kopai at view time would use a
connector, and in Claude Tag it is undocumented which one: the viewer's
(then the page adds nothing over the incident link), the channel's
`agent` token (then every channel member could read live workspace data
without a Kopai login), or none. A snapshot avoids the question.

## Workflow

### 1. Confirm the ask and the scope

Publish only when a person asked, in this thread, for a page or a chart.
The page covers one incident: the alert or symptom this thread is about.
If the thread has no investigation yet, run the kopai-triage skill first;
a page is never a substitute for the reply.

### 2. Gather what the thread established

- The alert, if it is a Kopai alert: `alert_get` gives the rule, the
  `observed` and `threshold` texts, the window and the `incident_url`.
- The queries you ran for the findings you posted, with their results and
  their **absolute** windows. Prefer the results you already have. If a
  chart needs a query you did not run, run it with the same absolute
  window, and only aggregates (`summary` or `timeSeries`).
- Write down the capture time (UTC) once; every number on the page is as
  of then.

Never put raw log bodies or span attributes beyond `service.name`, routes
and TraceIds on the page: they can carry customer data, and the page is
readable by the whole channel.

### 3. Build the page

One self-contained page, no runtime capabilities, no network calls: the
data is written into the page.

1. **Header:** the incident in one line (rule name or symptom, service),
   the window, and the stamp: "Snapshot taken {{time}} UTC. The numbers
   are as Kopai returned them then; viewing this page queries nothing."
2. **Source of truth:** "Full evidence in Kopai (workspace login
   required): {{incident_url}}". Without an incident link, say the page is
   the only record and list the queries (step 5).
3. **The alert, if any:** state and duration, `observed.text` against
   `threshold.text`, quoted exactly.
4. **One section per finding,** in the order the thread gave them, each
   with an anchor (`#finding-1`, `#finding-2`, …) so a reply can link to
   it: one sentence, the chart or table behind it, the number it rests
   on, and its query window. Mark onset, the fix (if any) and now on
   time charts.
5. **The queries,** collapsed: each query's JSON exactly as sent to the
   `query` tool, with its window, so anyone with a Kopai connection can
   re-run it.
6. **Retention:** "This page keeps these numbers after the workspace's
   telemetry retention ends. After that, the incident page and the queries
   above return no data for this window."

Charts follow the display rules (below). Use the `dataviz` skill when it is
available; otherwise inline SVG or a plain table. A table is always fine.

### 4. Publish and link

Publish with the page or artifact tool this session has. If there is
none, put the same content in a Slack canvas in this channel, or, failing
that, post the tables in the thread. Then post one line in the thread:
"Evidence page (snapshot at {{time}} UTC): {{link}}".

A later ask in the same thread updates the same page and re-stamps it,
with the change named at the top ("Updated {{time}}: added the payments
latency finding"). Never publish a second page for one incident.

## Display rules

For every number on the page, from an alert tool or from `query`:

- the value only: never `_low`, `_high`, `_coarsened` or "buckets";
- in the metric's unit: histograms record seconds, so write "480 ms";
  a histogram quantile is an estimate, so write "≈ 480 ms";
- "> 430 ms" when `_high` is null (the open-ended last bucket), "≤ 430 ms"
  when `_low` is null;
- "no data (reason)" when `_error` is set, and a gap in a chart, never 0.

## Visibility

Anyone who can read the channel can open the page. The alert and incident
channels are private (`kopai-oncall-setup/references/tag-setup.md`); in
a public channel, say so and ask before publishing.
