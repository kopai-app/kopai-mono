# Kopai On-Call

A Claude plugin that puts Claude on call with your team, investigating
alerts with your OpenTelemetry traces, logs and metrics in Kopai. It is
built for Claude Tag (Claude in your Slack channels) and works the same in
Claude Code.

Claude triages, proposes and verifies; people decide and act. The plugin
is read-only by design, unless you opt into rule creation: it never
changes a system it monitors, and with the opt-in it may only create new
Kopai alert rules that a person approved in the thread.

## What's in it

| Skill                 | What it does                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kopai-oncall-setup`  | Five gated phases: connect, baseline every service from Kopai, mine past incidents into playbooks, set policy, validate, install routines            |
| `kopai-triage`        | Investigates an alert or incident: reads a Kopai alert by its event id, queries Kopai, and posts a diagnosis with evidence and a proposed fix        |
| `kopai-verify-fix`    | After a human ships a fix, re-runs the incident's queries at three checkpoints and reports whether the signal is back to baseline                    |
| `kopai-handoff`       | The weekly on-call handoff, including each key service's week-over-week health from Kopai                                                            |
| `kopai-weather`       | An optional status report that posts only when something changes                                                                                     |
| `kopai-evidence-page` | On request, a snapshot page of the evidence for one incident, linked to Kopai's incident page                                                        |
| `root-cause-analysis` | Kopai's query library for investigations, by connector or SDK                                                                                        |
| `create-live-page`    | A Claude page that charts Kopai data live for each viewer, from their own claude.ai Kopai connector (not from Slack, where pages are snapshots only) |

The plugin declares the Kopai MCP server (`https://api.kopai.app/v2/mcp`).
It gives Claude:

- `query` and `metrics_discover`, for traces, logs and metrics;
- on a workspace with Kopai alerting, five read-only alert tools:
  `alerts_list`, `alert_get`, `alert_history`, `alert_rules_list` and
  `alert_rule_backtest`;
- `alert_rule_create`, only when a Kopai owner gave the channel's `agent`
  token the grant "may create alert rules".

The skills never call `alert_rule_update` or `alert_rule_set_enabled`:
changing or pausing a rule is always a person's act, in Kopai's rule
editor.

## How Claude handles a Kopai alert

1. Kopai posts a FIRING card to your private alert channel; Claude's watch
   routine picks it up.
2. Claude takes the event id from the card's incident link and reads the
   alert with `alert_get`: what fired, the value against the threshold,
   and the query behind it.
3. It investigates with Kopai queries and replies in the thread, starting
   with the state, how long it has lasted and the observed value against
   the threshold, and ending with "Full evidence in Kopai (workspace login
   required)". The reply stands on its own for people without a Kopai
   login.
4. Afterwards it asks whether a rule would have caught the incident
   earlier, and proposes one as a link to Kopai's rule editor with the
   rule pre-filled and its backtest.

Alerts from other tools (Alertmanager, Grafana, a pager) are triaged with
Kopai's telemetry too, and Claude says they did not come from Kopai.

## Where your team's knowledge lives

The plugin ships the method. Everything specific to your team lives in an
**on-call repo** that you own, which setup fills in:

- `ONCALL-RULES.md`: the standing rules (copied from the plugin)
- `ONCALL.md`: your policy: paging thresholds, severity, routing, and how
  alert rules are proposed and installed
- `STACK.md`: which tools are connected, and how Kopai is connected
- `BASELINES.md`: each service's normal range, measured from Kopai
- `playbooks/`: triage playbooks mined from your own incidents
- `lessons.md` and `paging-log.md`: what Claude learns and decides

Plugin updates never touch these files, and Claude's improvements to your
playbooks arrive as pull requests to your repo.

## Set it up in Claude Tag

**Connect Kopai with an agent token, not by signing in.** Anthropic's
guidance: "Anyone in a channel where the connector applies can use it
through Claude, so connect a dedicated identity you control rather than
your personal login." If Kopai is connected with someone's own login,
everyone in the channel acts as them, and Claude says so on its first
alert.

1. **Kopai (an owner or admin):** on the Tokens page, create an `agent`
   token for Claude Tag. To let Claude create rules a person approved, an
   owner ticks "may create alert rules" on it.
2. **Claude (an Owner, or a Claude Tag Admin):** in Organization settings →
   Claude Tag, create a bundle with:
   - the `kopai-oncall` plugin (register `kopai-app/kopai-mono` as an
     organization plugin source first);
   - a custom connector, type **Bearer**, allowed website
     `api.kopai.app`, holding the token. If the Kopai admin is someone
     else, use **Copy setup link for another admin** so they paste it
     directly; the token never goes into Slack;
   - the on-call repo, writable;
   - **Where it applies:** the alert channel and your incident channel
     pattern (for example `inc-*`).
3. **Remove** any Kopai sign-in (an MCP Connector) that applies in those
   channels.
4. Make the alert and incident channels private, `/invite @Claude`, and
   mention `@Claude` for follow-ups. Slack Connect channels are not
   supported.

Then, in the channel:

```text
@Claude what can you access from this channel?
@Claude set up Kopai on-call
```

Setup runs one phase at a time and stops for your sign-off after each.
New alert-watching routines start in a two-week shadow period, posting to
a review channel, before they go live. The full guide, including the
message to send your admins and the known limits, is
`skills/kopai-oncall-setup/references/tag-setup.md`.

## Use it in Claude Code

```bash
claude plugin marketplace add kopai-app/kopai-mono
claude plugin install kopai-oncall@kopai
```

Run Claude Code in your on-call repo and ask it to set up Kopai on-call.
Claude Code connects to hosted Kopai through the plugin's MCP server and
asks you to sign in the first time; there you act as yourself.

## Data and privacy

The plugin sends requests only to Kopai's MCP server at
`https://api.kopai.app/v2/mcp`, with the credential your admin configured.
It reads telemetry and alerts from your Kopai workspace, and writes only
to your on-call repo, your Slack channels and, with the opt-in, new Kopai
alert rules. Kopai's privacy policy: <https://kopai.app/privacy/>.

## Test it

- `evals/` holds `claude plugin eval` cases that run the skills against
  mocked Kopai tools; see `evals/README.md`.
- `plugins/test-fixtures/checkout-deploy-regression` in this repository
  sends a fictional incident to a local Kopai and gives you an alert to
  paste and an answer key. See its README.

## Credits

The setup, triage, handoff and weather skills, the templates and the
standing rules are adapted from Anthropic's
[On-Call Kit](https://github.com/anthropics/oncall-kit) (Apache-2.0). See
`NOTICE` for what changed.
