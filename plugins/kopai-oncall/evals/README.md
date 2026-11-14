# kopai-oncall evals

[`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals) cases
that run the plugin's skills against mocked Kopai tools. Every case uses
one fictional incident: checkout 1.5.0, deployed at 13:58 UTC on
2026-11-09, lowered its client timeout to payments to 200 ms, and Kopai's
"checkout latency" rule fired at 14:02 UTC (event `812`).

| case                      | checks                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kopai-alert-firing`      | the event id is read from the incident link, `alert_get` is called, and the reply quotes `observed.text`, links the incident page and stands on its own |
| `kopai-alert-owner-login` | Kopai connected with an owner's own login: Claude warns once and still triages                                                                          |
| `foreign-alert`           | an Alertmanager post: no alert tools, telemetry only, and the reply says it is not a Kopai alert                                                        |
| `test-message`            | Kopai's "Send test message" gets the four-line health check in its thread, not a triage                                                                 |
| `rule-proposal`           | duplicate check by `metric_name`, a backtest, the editor link and the rule JSON; no rule is created or changed                                          |

`mocks/kopai/` answers the Kopai MCP server's tools. `query`,
`alert_rules_list` and `alert_rule_backtest` are agent mocks that answer
from the incident described in their files; the other tools return fixed
bodies. `_tools.json` holds the real tools' schemas and descriptions, so a
call production would refuse is refused here too. A case's own `mocks/` overrides
them file by file.

Run from the plugin directory (Claude Code 2.1.269 or later). Each run makes
real model calls, so start with one run per case:

```bash
claude plugin eval . --runs 1 --ablation none --allow-tools Bash --judge-model sonnet
```

`rule-proposal` needs `Bash` to encode the editor link. The `llm` graders
need a capable judge: the default background model fails correct replies. Drop
`--ablation none` to compare against a session without the plugin.
