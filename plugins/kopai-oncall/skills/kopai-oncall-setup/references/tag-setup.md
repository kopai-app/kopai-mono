<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Modified for Kopai, 2026: Kopai connects with an agent token in a
     Bearer custom connector; adds the kopai-oncall plugin, the Kopai
     admin's part, private channels and the known limits. -->

# Getting Claude Tag ready for Kopai on-call

Claude Tag is @Claude living in your Slack channels. This page spells out
what _you_ can do yourself, what a **Kopai owner or admin** does, what
only a **Claude admin** can do, and what to send them. Do this before
setup Phase 4 (setup's Phase 0 will remind you). If you want to run setup
from the channel from the start, do it before Phase 0.

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
unless an owner gives it one grant (below). The plugin's own `.mcp.json`
only points at `https://api.kopai.app/v2/mcp` and holds no credential.

The one sanctioned sign-in is a **dedicated, non-admin Kopai user** for
Claude (for example `claude@yourcompany`), used _instead of_ the token,
never alongside it. It is read-only by its role, can never create rules,
and takes a Kopai seat.

## What you need to know in one paragraph

Claude Tag is available on Claude Team and Enterprise plans. It starts
with **no access to anything**: a Claude admin gives it connections,
repositories and plugins in a **bundle**, and the bundle's **Where it
applies** decides which channels get them. Channel work bills to an org
usage balance with a spend limit, not to your seat. Full docs:
[setup overview](https://claude.com/docs/claude-tag/admins/setup-overview) ·
[custom connections](https://claude.com/docs/claude-tag/admins/connections/custom) ·
[the identity model](https://claude.com/docs/claude-tag/concepts/agent-identity).

## What you can do yourself (no admin needed)

- `/invite @Claude` into your on-call channel and each alert channel you
  want watched (once the app is installed in the workspace).
- Check what it can reach: `@Claude what can you access from this channel?`
  — or click **Configure** in the footer of any Claude reply.
- Create, list, edit, and disable routines in the channel ("what routines
  are set up here?").
- Run setup Phases 0–3 from a local Claude Code session in the on-call
  repo, with the kopai-oncall plugin enabled, before Tag is provisioned at
  all.

## What a Kopai owner or admin does

1. On Kopai's **Tokens** page, create an **`agent` token** for Claude Tag.
   Never paste it into Slack.
2. Only if the team opted into rule creation (setup Phase 2, block 6): a
   Kopai **owner** ticks **"may create alert rules"** on that token. Without
   it, Claude proposes rules as links a person saves; with it, Claude may
   create a new rule after an explicit yes in the thread. It can never
   change, pause or delete a rule, and Kopai caps its creations per
   workspace per day.

## What only a Claude admin can do

In **Organization settings → Claude Tag** (a Claude org **Owner**, or a
**Claude Tag Admin** on Enterprise), create a bundle, for example
`kopai-oncall`, and add to it:

1. **The plugin** `kopai-oncall`. Register `kopai-app/kopai-mono` as an
   organization plugin source first if it isn't listed.
2. **A custom connector** for Kopai: credential type **Bearer**, allowed
   website `api.kopai.app`, holding the `agent` token. Optionally limit it
   to the path `/v2/mcp`.
   - When the Kopai admin is someone else, use **Copy setup link for
     another admin**: the Kopai admin pastes the token into Claude's form,
     and the Claude admin approves it under **Notifications → Requests**.
     The token never passes through Slack or chat.
3. **The on-call repo**, writable, so Claude can commit log entries and
   open pull requests. Optionally your **pager** and code host, read-only
   to start ([add connections](https://claude.com/docs/claude-tag/admins/add-connections)).
4. **Where it applies:** the alert channel, plus a channel rule for your
   incident channels' name pattern (for example `inc-*`), so Kopai stays
   reachable when an alert becomes an incident channel. Channel rules also
   cover channels created later.
5. A [spend limit](https://claude.com/docs/claude-tag/admins/set-spend-limit)
   for the pilot.

**Then clean up.** No **MCP Connector** sign-in for Kopai may apply in
these channels alongside the token: Claude would hold two credentials for
`api.kopai.app`, and a sign-in shares the signer's role with the whole
channel. Remove it, or narrow its **Where it applies**. The same goes for a
Kopai connector on the **Connectors** tab: a connector there applies in
every channel.

## The channels

- The alert channel and every incident channel are **private**. Anything
  Claude publishes there, including evidence pages, is visible to anyone
  who can read the channel.
- Invite `@Claude` to the alert channel and paste the watch routine from
  `routines.md`. Kopai's alert posts never mention `@Claude`; the watch is
  what brings Claude to them.
- For follow-up questions in an alert thread, mention `@Claude`.
- Slack Connect channels (shared with another organization) are not
  supported.
- Changing or pausing a rule is always a person's act, as themselves: an
  owner or admin does it in Kopai's rule editor (Claude links the rule).
  The channel's `agent` token never can.

## The message to send your admins

Paste this to whoever owns your Claude org and your Kopai workspace,
filling the blanks:

> Hi — our team is setting up a Claude-assisted on-call in
> **#{{on-call channel}}** with Kopai's on-call plugin for Claude
> (kopai-oncall). It needs two one-time steps:
>
> **Kopai (an owner or admin):** create an `agent` token for Claude Tag on
> Kopai's Tokens page. {{Leave "may create alert rules" off. / Tick "may
> create alert rules" (owner only): we opted in.}}
>
> **Claude (Organization settings → Claude Tag, an Owner or Claude Tag
> Admin):** create a bundle `kopai-oncall` with:
>
> 1. the plugin `kopai-oncall` (plugin source: `kopai-app/kopai-mono`);
> 2. a custom connector, type **Bearer**, allowed website
>    `api.kopai.app`, holding that token. Use "Copy setup link for another
>    admin" so the Kopai admin pastes the token directly;
> 3. our on-call repo {{repo URL}}, writable, and {{pager tool}}
>    read-only;
> 4. Where it applies: **#{{alert channel}}**, **#{{on-call channel}}** and
>    channels matching **{{inc-*}}**;
> 5. a spend limit of {{amount}}. (No number yet? A few hundred dollars is
>    a common ceiling for a pilot month — the pilot itself measures the
>    real figure.)
>
> Please don't connect Kopai by signing in: everyone in the channel would
> act as you. Nothing acts autonomously: the plugin proposes, reads, and
> {{never creates alert rules / creates new alert rules only after an
> explicit yes in the thread}}; paging stays off until a two-week shadow
> period we review together. Setup guide:
> claude.com/docs/claude-tag/admins/setup-overview

## Verifying it worked

From the on-call channel:

1. `@Claude what can you access from this channel?` — the list should
   match what the admin attached.
2. `@Claude read ONCALL.md from {{repo}}` — if it can read the repo, the
   setup's Phase 4 gate can pass.
3. `@Claude run a Kopai trace summary for the last hour` — if it returns
   services, the Kopai connection works.
4. `@Claude list our Kopai alert rules` — the answer comes back as the
   `agent` token. If Claude warns that Kopai is connected with someone's
   own login, the admin used a sign-in: fix it as above.

If any of these fails, the bundle is missing that piece — send the admin
the specific gap, not the whole checklist again.

## Known limits

Anthropic does not document these yet; the plugin is built so each has a
fallback.

- **How fast the watch reacts** to a post, and whether it pauses after
  many posts without a Claude post or a mention, or after about 10 quiet
  days. Keep the alert channel low-volume. If the watch proves
  unreliable, use the polling routine in `routines.md` (every 10 min).
- **A revoked or expired token** (401/403): Claude says Kopai refused the
  token; a Claude admin re-adds the connector with a new one.
- **Which parts of a Slack post Claude reads.** Claude looks for the
  Kopai incident link in the post's text and its attachment, and falls
  back to Kopai's alert list when it finds neither.
- **Which connector a page calls** when Claude publishes one from Slack.
  So evidence pages from the channel are snapshots: the numbers are baked
  in and viewing calls nothing.
- **Which Kopai tools a session uses** when the plugin's connection and a
  person's own Kopai connector are both present. Kopai checks every call
  against the credential that made it, either way.
- **The incident link** opens only for people with a login to your Kopai
  workspace; the reply is written to stand on its own without it.

## Two gotchas worth knowing up front

- **DMs are different.** A DM with Claude runs on _your_ claude.ai seat
  with your limits and your connectors, not the channel's setup. Do
  on-call work in the channel, where the connections and audit trail live.
- **Access follows the channel, not the person.** What Claude can reach is
  decided by which channel you're in. If a probe fails in a thread, you're
  probably in a channel outside the bundle's **Where it applies**. The same
  rule applies to the optional weather routine: the channel it posts to,
  and the Slack canvas holding its report, must both be inside it.
