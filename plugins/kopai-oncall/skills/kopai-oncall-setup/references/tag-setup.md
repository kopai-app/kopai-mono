<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Modified for Kopai, 2026: rewritten around Kopai's onboarding: the
     Slack target, an agent token in a Bearer custom connector, the `kopai`
     bundle, the channel setup and the test message; keeps the admin
     message, the verification and the gotchas. -->

# Getting Claude Tag ready for Kopai on-call

Claude Tag is @Claude living in your Slack channels. This page is the
whole onboarding: what a **Kopai owner or admin** does, what only a
**Claude admin** can do, and the two steps anyone does in the channel.

## Connect Kopai with an agent token, not by signing in

Anthropic's guidance for every tool Claude Tag reaches:

> The credential you connect is Claude's account in that tool, not yours.
> Anyone in a channel where the connector applies can use it through
> Claude, so connect a dedicated identity you control rather than your
> personal login.

If a Claude admin connects Kopai by signing in (the **MCP Connector**
credential type), everyone in the channel queries Kopai as that admin,
with their role. Connect Kopai with an **`agent` token** instead: a Kopai
workspace token made for Claude, which can read and never change anything
unless an owner gives it one grant (below). The plugin points at
`https://api.kopai.app/v2/mcp` and holds no credential; never paste a
token into Slack.

## The steps

1. **Kopai › Alerting › Slack** (a Kopai owner or admin): **Add to Slack**,
   choosing the alert channel. Kopai posts its alerts there.
2. **Kopai › Tokens** (a Kopai owner or admin): create an **`agent` token**
   for Claude Tag. Only if the team wants Claude to create rules a person
   approved in the thread, a Kopai **owner** switches on **"may create
   alert rules"** on it. Claude can never change, pause or delete a rule
   with it, and Kopai caps its creations per workspace per day.
3. **Claude › Organization settings › Claude Tag › Bundles** (a Claude org
   **Owner**, or a **Claude Tag Admin** on Enterprise): create a bundle
   named **`kopai`** with:
   - a **Custom connector → Bearer**, Allowed websites `api.kopai.app`,
     holding the agent token. If someone else holds the token, use **Copy
     setup link for another admin**: they paste it into Claude's form and
     you approve it under **Notifications → Requests**. Don't add a path
     prefix: setup links don't carry one.
   - the **`kopai-oncall` plugin** (see "Getting the plugin" below);
   - **Instructions**, with this text:

     > Kopai is this team's observability backend (traces, logs, metrics,
     > alerts) at api.kopai.app; authentication is already set up. Kopai
     > alert posts in this channel come from Kopai's Slack app. Use the
     > kopai-oncall skills for anything about alerts, alert rules or
     > telemetry. Never create or change an alert rule without a person's
     > approval of that exact rule in the thread.

   - **Where it applies:** the alert channel.
4. **Slack, the alert channel** (anyone): `/invite @Claude` if it isn't
   there yet, then post a **top-level** message: `@Claude set up Kopai
on-call here`. Claude checks it can reach Kopai, proposes the watch
   routine, and creates it when you say yes.
5. **Kopai › Alerting › Slack** (anyone with access): press **Send test
   message**. Claude answers it in its thread with a health check: the
   identity in use, the alert rules it sees, the last alert, and that the
   watch is running. That reply means onboarding worked.

Without steps 3–5 the plugin still works on request: anyone with their own
Kopai connector can ask `@Claude triage this` in a thread. Routines use
only the channel's own access, so nothing is triaged on its own until the
`kopai` bundle applies.

## Getting the plugin

- **Preferred:** from the Claude Directory listing (Kopai's connector and
  plugin), then add `kopai-oncall` to the `kopai` bundle.
- **Fallback:** upload the plugin's folder (`plugins/kopai-oncall` in
  `kopai-app/kopai-mono`) as a zip from the console.

## Don't

- **Don't put the connector on the Connectors tab.** A credential there
  is on in every channel; the bundle limits it to the alert channel.
- **Don't use an MCP Connector sign-in** for Kopai in these channels: it
  shares the signer's Kopai role with everyone in them. Remove any that
  applies. The one sanctioned sign-in is a dedicated, non-admin Kopai user
  for Claude (for example `claude@yourcompany`), used _instead of_ the
  token, never alongside it.
- **Don't use a Slack Connect channel** (shared with another
  organization): it is not supported.

**Incident channels (optional).** An Owner can also apply the `kopai`
bundle to your incident channels' name prefix (for example `inc-`) with a
channel rule, so Kopai stays reachable when an alert becomes an incident
channel. Recommend it only when the token is read-only (no "may create
alert rules" grant). Keep those channels private: anything Claude
publishes there, evidence pages included, is visible to anyone who can
read the channel.

## The message to send your admins

> Hi — we'd like Claude to triage our Kopai alerts in **#{{alert
> channel}}**, with Kopai's on-call plugin for Claude (kopai-oncall). It
> needs two one-time steps:
>
> **Kopai (an owner or admin):** Alerting › Slack › Add to Slack, choosing #{{alert channel}}; then Tokens › create an `agent` token for Claude Tag.
> {{Leave "may create alert rules" off. / Switch on "may create alert
> rules" (owner only).}}
>
> **Claude (Organization settings › Claude Tag › Bundles, an Owner or
> Claude Tag Admin):** create a bundle `kopai` with a Custom connector
> (Bearer, Allowed websites `api.kopai.app`, the token — use "Copy setup
> link for another admin" so the Kopai admin pastes it directly), the
> `kopai-oncall` plugin, the Instructions text from the plugin's setup
> guide, and Where it applies: #{{alert channel}}.
>
> Please don't connect Kopai by signing in: everyone in the channel would
> act as you. Claude only reads and proposes; {{it never creates alert
> rules / it creates a new alert rule only after an explicit yes in the
> thread}}.

## Verifying it worked

The test message in step 5 is the check. If Claude doesn't answer it:

1. `@Claude what can you access from this channel?` — Kopai should be in
   the list.
2. `@Claude list our Kopai alert rules` — it should answer as the agent
   token. If it warns that Kopai is connected with someone's own login,
   the admin used a sign-in: fix it as above.
3. `@Claude what routines are set up here?` — the Kopai watch should be
   there; if not, repeat step 4.

Send the admin the specific gap, not the whole checklist again.

## Known limits

Anthropic does not document these yet; the plugin is built so each has a
fallback.

- **How fast the watch reacts** to a post, and **whether it can reply in
  each alert's own thread** rather than under its own run. If either
  fails, the setup skill's `references/watch-routine.md` has a polling
  routine (every 10 minutes).
- **Whether the watch pauses** after many top-level posts without a Claude
  post or a mention, or after about 10 quiet days. Keep the alert channel
  for alerts.
- **A revoked or expired token** (401/403): Claude says Kopai refused the
  token; a Claude admin re-adds the connector with a new one.
- **Which parts of a Slack post Claude reads.** Claude looks for the
  Kopai incident link in the post's text and its attachment, and falls
  back to Kopai's alert list when it finds neither.
- **Which connector a page calls** when Claude publishes one from Slack.
  So evidence pages from the channel are snapshots: the numbers are baked
  in and viewing calls nothing.
- **Which Kopai tools a session uses** when the bundle's connection and a
  person's own Kopai connector are both present. Kopai checks every call
  against the credential that made it, either way.

## Two gotchas worth knowing up front

- **DMs are different.** A DM with Claude runs on _your_ claude.ai seat
  with your connectors, not the channel's setup. Do on-call work in the
  channel, where the connections and audit trail live.
- **Access follows the channel, not the person.** What Claude can reach is
  decided by which channel you're in. If something fails in a thread,
  you're probably in a channel outside the bundle's **Where it applies**.
