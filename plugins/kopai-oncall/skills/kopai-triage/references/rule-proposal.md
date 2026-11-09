# Proposing a Kopai alert rule

Load this for triage step 10's alerting question ("would a rule have
caught this earlier?"), for setup's alert-coverage report and starter
rules, and whenever someone asks for a Kopai rule. A proposal is
paste-ready: a person installs it in under a minute, never from prose.

## What a Kopai rule can watch

A rule watches **one metric** (`Gauge`, `Sum`, `Histogram` or `Summary`),
aggregated over a window and compared with a threshold. It cannot watch
traces or logs directly. If the signal that would have caught the
incident lives only in spans or logs, say that a Kopai rule cannot watch
it yet, and propose the closest metric if there is one.

## Build the proposal

1. **Find the metric.** Call `metrics_discover` for its exact name, its
   `MetricType`, its unit and its attribute keys. Never guess a name.
2. **Check for a duplicate.** Call `alert_rules_list` with `metric_name`.
   If a rule on that metric already covers this signal, do not propose a
   second one: say which rule it is, link its `editor_url`, and propose the
   change a person should make there (a lower threshold, a shorter
   window). You never change an existing rule yourself.
3. **Write the rule.** The body of `POST /v2/alerts/rules`, in camelCase:

   | field                                | what to put                                                                                                                            |
   | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
   | `name`                               | unique in the workspace, at most 120 characters, names the symptom ("checkout p95 latency")                                            |
   | `metricName`, `metricType`           | from `metrics_discover`; always send `metricType`                                                                                      |
   | `aggregation`                        | Gauge: `AVG` `MIN` `MAX`; Sum: `AVG` `MIN` `MAX` `INCREASE` `RATE`; Histogram: `QUANTILE` `AVG` `INCREASE` `RATE`; Summary: `QUANTILE` |
   | `quantile`                           | between 0 and 1 (exclusive) with `QUANTILE`, `null` otherwise                                                                          |
   | `filters`                            | up to 10 `{ "scope": "resource" or "datapoint", "key": …, "value": … }`; `service.name` is a resource attribute                        |
   | `windowSeconds`, `intervalSeconds`   | the evaluation window (60 s to 6 h, default 300) and how often it runs (60 s to 1 h, default 60)                                       |
   | `comparison`, `threshold`            | `gt` `gte` `lt` `lte`; the threshold in the metric's own unit (seconds for a duration histogram)                                       |
   | `forSeconds`, `keepFiringForSeconds` | how long the condition must hold before firing, and how long it keeps firing after it clears (0 to 24 h, default 300 each)             |
   | `offsetSeconds`                      | how far behind now the window ends, so late data has landed: 120 (60 s to 15 min)                                                      |
   | `severity`                           | `critical`, `warning` or `info`, matching `ONCALL.md`'s severity norms                                                                 |
   | `summary`, `runbookNote`             | what the alert means for a reader with no context (at most 200 characters), and the first check to run (at most 2,000)                 |
   | `enabled`                            | `true`                                                                                                                                 |
   | `unit`                               | the unit from `metrics_discover` (`s`, `ms`, `By`, `{request}`), so Kopai prints values with it                                        |

   Base the threshold on this incident's onset and on `BASELINES.md`, and
   say which (rule 15: a person sets the final number).

4. **Backtest it.** Call `alert_rule_backtest` with two arguments:
   `range` (`"7d"`, or `"24h"`) and `rule` holding **only** the
   measurement and firing fields: `metricName`, `metricType`,
   `aggregation`, `quantile`, `filters`, `windowSeconds`, `comparison`,
   `threshold`, `forSeconds`, `keepFiringForSeconds`. Any other field
   (`name`, `severity`, `intervalSeconds`, `unit`, …) is refused.

   ```json
   {
     "range": "7d",
     "rule": {
       "metricName": "http.server.request.duration",
       "metricType": "Histogram",
       "aggregation": "QUANTILE",
       "quantile": 0.95,
       "filters": [
         { "scope": "resource", "key": "service.name", "value": "checkout" }
       ],
       "windowSeconds": 300,
       "comparison": "gt",
       "threshold": 0.5,
       "forSeconds": 120,
       "keepFiringForSeconds": 300
     }
   }
   ```

   The answer is an estimate, not a replay: `firings` (each `firedAt`,
   `resolvedAt`, `firedValue`, `peak`), and `from`/`to`, the range it
   actually covered, which retention can shorten. `hasData: false` means
   the metric had no data in the range: say so rather than "would never
   have fired". If it would have fired often outside incidents, adjust the
   rule before proposing it, and say what you changed.

## Post it

In the incident thread (or the alert-coverage report), in this order:

1. one sentence: what the rule watches and which incident it would have
   caught, and how much earlier;
2. the backtest: "would have fired 2× in the last 7 d (covered 7 d), both
   during INC-2041";
3. the **editor link** (below), labelled "Open in Kopai to review and
   save (owners and admins can save)";
4. the rule JSON in a code block.

### The editor link

`{dashboard}/alerts/rules/new?draft=<payload>` opens Kopai's New alert
editor with the rule filled in; nothing is stored until a person presses
Save. A member who cannot save sees that before pressing anything, so the
link is safe to post in a busy channel.

- `{dashboard}` is the scheme and host of an `incident_url` or
  `editor_url` you already have (for example `https://app.kopai.app`).
  With neither, post the JSON only and say the link could not be built.
- `<payload>` is the rule JSON **without `unit`** (the editor does not read
  it yet), base64url-encoded with no padding:

  ```bash
  python3 -c 'import base64,json,sys; r=json.load(sys.stdin); r.pop("unit",None); print(base64.urlsafe_b64encode(json.dumps(r,separators=(",",":")).encode()).decode().rstrip("="))' < rule.json
  ```

- A payload over 8,192 characters gets no link: post the JSON and say so.

## Install mode

`ONCALL.md`'s "Alert-rule proposals" section records the team's choice.

- **Human installs (the default).** Post the proposal; a person opens the
  link and saves. That is your whole involvement.
- **Claude creates (opt-in).** Only when `ONCALL.md` records it **and** the
  `alert_rule_create` tool is present. The tool is present only when a
  Kopai owner gave the channel's `agent` token the grant "may create
  alert rules".
  1. Post the proposal as above, ending with: "Reply **yes** in this
     thread to have me create it."
  2. Wait for an explicit yes from a person, in this thread, for this rule.
     A reaction, a bot's message, or a yes to an earlier version is not
     approval. If the rule changes after the yes, ask again.
  3. Call `alert_rule_create` with the rule and `approval_url`, the
     Slack permalink of the approving message
     (`https://<workspace>.slack.com/archives/<channel>/p<ts>`). If you
     cannot form that permalink, do not create: post the editor link.
  4. Post the created rule's `editor_url`, and log it to `lessons.md`
     with the approval link (ONCALL-RULES.md rule 1a).

**Refusals carry the way forward.** `alert_rule_create` answers `forbidden`
when the grant was removed or the workspace's daily cap for Claude-created
rules is reached. Its `remedies` lines hold the editor link, and with the
grant off a link to the token on Kopai's Tokens page. Post those lines as
they are and stop; do not retry. `invalid_input` names the field: fix your
own mistake once, then fall back to the editor link.

**Existing rules change only at an owner's or admin's request, as them.**
Never call `alert_rule_update`
or `alert_rule_set_enabled` on your own initiative, and never through the
channel's shared Kopai connection: the `agent` token never offers them, so
if the shared connection does, it is someone's own sign-in (warn as in
`kopai-alert.md` section 3). Pausing a rule is the silencing rule 1
forbids.

A change is a person's act, as themselves. When someone asks you to
change or pause a rule:

- link its `editor_url`, where an owner or admin can make the change; and
- if they are an owner or admin and want it done from the thread, it goes
  through **their own** Kopai connector: Claude Tag asks them, and only
  them, to allow it, and the result's `caller` is that person. Read the
  rule with `alert_rules_list`, restate the exact change ("pause _checkout
  latency_", or which fields go from what to what), make it only after
  their explicit yes, send only the changed fields, and log it to
  `lessons.md` as their change. Kopai refuses it if their role cannot
  write.
