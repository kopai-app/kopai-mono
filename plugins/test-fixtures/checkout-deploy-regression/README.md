# Fixture: checkout-deploy-regression

A dry run of the kopai-oncall plugin against real telemetry in a local
Kopai, with no Slack, pager or code host. It sends a fictional shop's
traces and logs to Kopai, with one incident in them, and gives you an
alert to paste and an answer key to grade the diagnosis.

Use it to test the kopai-triage and kopai-verify-fix skills locally, and
as a regression test when you change them.

## Run it

You need Node 20 or later and Claude Code.

1. **Start a local Kopai** (in-memory, so every restart is a clean slate):

   ```bash
   npx @kopai/app start
   ```

2. **Send the fixture's telemetry** (90 minutes of history ending now):

   ```bash
   node plugins/test-fixtures/checkout-deploy-regression/generate.mjs
   ```

   Note the alert time it prints. Re-running without restarting Kopai
   duplicates the data, so restart Kopai first.

3. **Make a scratch on-call repo** from this folder's `oncall-repo/`, plus
   the plugin's standing rules:

   ```bash
   cp -r plugins/test-fixtures/checkout-deploy-regression/oncall-repo /tmp/kopai-oncall-dry-run
   cp plugins/kopai-oncall/skills/kopai-oncall-setup/templates/ONCALL-RULES.md /tmp/kopai-oncall-dry-run/
   ```

4. **Open Claude Code there with the plugin and the local Kopai:**

   ```bash
   cd /tmp/kopai-oncall-dry-run
   git init -q && git add -A && git commit -qm fixture   # so you can diff what Claude writes
   echo '{"mcpServers":{"kopai-local":{"type":"http","url":"http://localhost:8000/mcp"}}}' > mcp.json
   claude --plugin-dir <path to kopai-mono>/plugins/kopai-oncall \
     --mcp-config mcp.json --strict-mcp-config
   ```

   The plugin's own `.mcp.json` points at hosted Kopai
   (`api.kopai.app`); `--strict-mcp-config` keeps this dry run on the
   local one. The skills work with any Kopai `query` tool.

   To run it unattended (for example as a regression check), pass the
   alert with `-p "<alert text>"` and allow the tools up front:
   `--allowedTools "mcp__kopai-local__query,mcp__kopai-local__metrics_discover,Read,Glob,Grep,Skill,Edit,Write"`.

5. **Paste the alert** from `ALERT.md`, with the alert time filled in.

6. **Grade the diagnosis** against `ANSWER-KEY.md`. Don't show the session
   `ANSWER-KEY.md`, `generate.mjs` or this README: they give the answer
   away.

7. **Optional: test kopai-verify-fix.** Tell the session you rolled back
   checkout to 1.4.2 at a time about 10 minutes before the generator
   finished. The fixture has no rollback in it: the data after that time
   is still 1.5.0 and still failing, and no 1.4.2 spans appear. The
   session should report "not working" or "cannot confirm", and never
   "resolved".

## What's in here

| File            | What it is                                                                       |
| --------------- | -------------------------------------------------------------------------------- |
| `generate.mjs`  | Sends the telemetry over OTLP/HTTP JSON. No dependencies. Seeded, so runs match. |
| `oncall-repo/`  | A minimal on-call repo: `ONCALL.md`, `STACK.md`, `BASELINES.md`, `lessons.md`    |
| `ALERT.md`      | The message to paste                                                             |
| `ANSWER-KEY.md` | The cause, what a correct diagnosis contains, and the traps                      |

The numbers in `BASELINES.md` were measured from the fixture's
pre-incident hour with the default seed. If you change the generator,
re-measure them.
