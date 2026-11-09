# Kopai On-Call

A Claude plugin that puts Claude on call with your team, investigating
alerts with your OpenTelemetry traces, logs and metrics in Kopai. It is
built for Claude Tag (Claude in your Slack channels) and works the same in
Claude Code.

Claude triages, proposes and verifies; people decide and act. The plugin
is read-only by design: it never changes a system it monitors.

## What's in it

| Skill                 | What it does                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `kopai-oncall-setup`  | Five gated phases: connect, baseline every service from Kopai, mine past incidents into playbooks, set policy, validate, install routines |
| `kopai-triage`        | Investigates an alert or incident with Kopai queries and posts a diagnosis with evidence and a proposed fix                               |
| `kopai-verify-fix`    | After a human ships a fix, re-runs the incident's queries at three checkpoints and reports whether the signal is back to baseline         |
| `kopai-handoff`       | The weekly on-call handoff, including each key service's week-over-week health from Kopai                                                 |
| `kopai-weather`       | An optional status report that posts only when something changes                                                                          |
| `root-cause-analysis` | Kopai's query library for investigations, by connector or SDK                                                                             |
| `create-live-page`    | A Claude page that charts Kopai data live for each viewer                                                                                 |

The plugin also declares the Kopai MCP server (`https://api.kopai.app/v2/mcp`),
which gives Claude two read-only tools: `query` and `metrics_discover`.

## Where your team's knowledge lives

The plugin ships the method. Everything specific to your team lives in an
**on-call repo** that you own, which setup fills in:

- `ONCALL-RULES.md`: the standing rules (copied from the plugin)
- `ONCALL.md`: your policy: paging thresholds, severity, routing
- `STACK.md`: which tools are connected
- `BASELINES.md`: each service's normal range, measured from Kopai
- `playbooks/`: triage playbooks mined from your own incidents
- `lessons.md` and `paging-log.md`: what Claude learns and decides

Plugin updates never touch these files, and Claude's improvements to your
playbooks arrive as pull requests to your repo.

## Set it up in Claude Tag

An Owner of your Claude organization does this once, at
`claude.ai/admin-settings/claude-tag`:

1. **Create a Kopai key for Claude.** In Kopai, create a read-only
   service-account key for Claude Tag.
2. **Add the Kopai connection** to an Access bundle: paste the key and set
   the allowed website to `api.kopai.app`.
3. **Add the plugin.** Register the Kopai plugin repository as an
   organization plugin source, then enable `kopai-oncall` in the same
   bundle's Plugins tab.
4. **Grant the on-call repo** in the bundle, with write access, so Claude
   can commit log entries and open pull requests.
5. **Scope the bundle** to your on-call channel and set a spend limit.

Then, in the channel:

```text
@Claude what can you access from this channel?
@Claude set up Kopai on-call
```

Setup runs one phase at a time and stops for your sign-off after each.
New alert-watching routines start in a two-week shadow period, posting to
a review channel, before they go live.

## Use it in Claude Code

```bash
claude plugin marketplace add kopai-app/kopai-mono
claude plugin install kopai-oncall@kopai
```

Run Claude Code in your on-call repo and ask it to set up Kopai on-call.
Claude Code connects to hosted Kopai through the plugin's MCP server and
asks you to sign in the first time.

## Test it locally

`plugins/test-fixtures/checkout-deploy-regression` in this repository
sends a fictional incident to a local Kopai and gives you an alert to
paste and an answer key. See its README.

## Credits

The setup, triage, handoff and weather skills, the templates and the
standing rules are adapted from Anthropic's
[On-Call Kit](https://github.com/anthropics/oncall-kit) (Apache-2.0). See
`NOTICE` for what changed.
