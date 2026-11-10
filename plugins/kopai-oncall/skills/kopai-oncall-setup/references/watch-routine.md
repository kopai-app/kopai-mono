# The Kopai watch routine

The kopai-oncall-setup skill proposes this text, with the channel's name
filled in, and creates it on a person's yes. The skills hold the method;
the routine only says when and where.

## The watch

```
Watch {{#alert-channel}}. When a new post from Kopai's Slack app lands
there, run the kopai-triage skill on it and answer in that post's own
thread:
- 🔴 FIRING: a short triage — what fired, since when, the likely cause,
  what to look at first, and the incident link.
- 🟢 RESOLVED: one line in the original alert's thread, if you triaged it.
- A message starting "TEST · Kopai alert target check": the health check
  from the skill — the identity in use, how many alert rules are
  visible, when the last alert fired, and that this watch is running.
If several alerts land together, triage them as one batch. Propose fixes
only. Never create, change or disable an alert rule unless a person asks
in the thread and approves that exact rule there.
```

## Polling fallback (only if the watch proves unreliable)

If the watch misses Kopai alerts, reacts too late, or cannot reply in each
alert's own thread, replace it with a poll. Ten minutes is the shortest
interval a routine allows.

```
Every 10 minutes: call Kopai's alerts_list with changed_since set to 15
minutes ago (the interval plus overlap), skip each event whose Kopai alert
post in {{#alert-channel}} already has your triage in its thread, and run
the kopai-triage skill on each new FIRING, answering in the thread of its
Kopai alert post. If the result says truncated, say how many arrived and
link Kopai's alert history. Post nothing when there is nothing new.
```

## Keep the alert channel quiet

Claude Tag may stop reading a channel where many top-level posts pass
without a Claude post or a mention, until someone mentions `@Claude`
there. Keep the alert channel for Kopai's posts and their threads, and
talk elsewhere.
