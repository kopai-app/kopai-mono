---
name: kopai-oncall-setup
description: >
  Connect a Slack alert channel to Kopai on-call in one run: check where it
  was asked, check that Kopai is reachable and as whom, check for an
  existing watch, propose the watch routine that triages Kopai's alert
  posts and create it after a person's yes, then hand over to Kopai's
  "Send test message". Use when someone asks to "set up Kopai on-call
  here", "set up Kopai on-call", "connect Kopai to this channel" or "watch
  this channel for Kopai alerts". For playbooks mined from past incidents
  and an on-call repo, use kopai-oncall-playbooks afterwards.
---

# Kopai on-call setup (one channel)

This connects one Slack alert channel to Kopai: after it, Claude triages
every Kopai alert posted there. It takes one run and writes nothing but a
routine, and only after a person says yes.

It assumes the admins have done their part (`references/tag-setup.md`):
Kopai's Slack target posts to this channel, and a bundle named `kopai`
with the Kopai connector and this plugin applies here. When something is
missing, say exactly what and point at that guide.

**Never ask for, accept or print a token.** Kopai's credential lives in
the bundle and is added to each request outside this session. If someone
pastes a token, don't repeat it: ask them to delete the message and to
have a Kopai owner revoke that token and make a new one.

## 1. Check where it was asked

A routine reports where it was created, so setup only works from a
**top-level message in the alert channel**:

- **In a thread:** a routine created there would report into that thread.
- **In a DM:** a DM routine belongs to that person and runs on their
  account, not the channel's.
- **In Claude Code, not Slack:** there are no routines to create; say this
  skill is for a Slack channel, and offer the kopai-triage skill for
  alerts or kopai-oncall-playbooks for an on-call repo.

In any of these, stop and ask them to post `@Claude set up Kopai on-call
here` as a top-level message in the alert channel.

## 2. Check access

Call `alert_rules_list` (no arguments) and read `caller` from the result.
Then call `alerts_list` with `limit` 1 for the last alert.

- **Kopai is not reachable** (no Kopai tools, a blocked host, 401 or 403):
  stop and say what is missing. In this setup it is almost always the
  `kopai` bundle not applying to this channel. Give the recipe: in
  Organization settings → Claude Tag → Bundles, the bundle `kopai` holds a
  Custom connector of type Bearer with Allowed websites `api.kopai.app`
  and the Kopai agent token, plus the `kopai-oncall` plugin, and its
  **Where it applies** includes this channel. Don't guess beyond that.
- **Only `query` and `metrics_discover`, no alert tools:** Kopai is
  reachable but this workspace is not on Kopai alerting. Say so and stop:
  there are no Kopai alerts to watch.
- **`caller.kind` is `agent`:** the expected case.
- **`caller.kind` is `person`:** Kopai answered through someone's own
  connector, so this channel may have no agent credential. Warn that
  routines use only the channel's own access, never a person's
  connector: without the `kopai` bundle the watch cannot reach Kopai, and
  alerts get triaged only when someone asks. If `role` is `owner` or
  `admin`, also give the warning in the kopai-triage skill's
  `references/kopai-alert.md` section 3.

## 3. Check for an existing watch

List this channel's routines (`@Claude !scheduled` shows them to anyone).
If one already watches this channel for Kopai alerts, show it and stop:
never install a second. Replace it only if a person asks, and then show
both texts first.

## 4. Propose the watch, create it on a yes

Post the routine text from `references/watch-routine.md`, word for word,
with this channel's name filled in. Say what it does in one sentence, and
that anyone in the channel can list or disable it later. Then wait for an
explicit yes from a person in this conversation.

On the yes, create the routine in this channel, at the top level, with
exactly that text. If you cannot create routines here, say so and ask the
person to post the text as a top-level message themselves.

## 5. Summarise and hand over

Finish with one short message:

- the identity in use (`caller`: the channel's agent token, or whose
  connector);
- how many alert rules are visible, and the last alert (rule name,
  transition and time), or "no alerts yet";
- that the watch is installed;
- the next step: "In Kopai, open **Alerting › Slack** and press **Send test
  message**. I'll answer it in its thread."

Optional next steps, one line each: everyone who wants to write rules as
themselves connects Kopai on claude.ai; a team that wants playbooks from
its own incidents runs the kopai-oncall-playbooks skill.

## Must not

- create or change alert rules;
- ask for, accept or handle tokens;
- change channel settings, invite anyone, or post outside this channel.
