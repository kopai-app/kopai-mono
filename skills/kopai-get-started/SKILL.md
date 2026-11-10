---
name: kopai-get-started
description: Get a project that `kopai setup` just connected to Kopai Cloud sending its first telemetry. Checks the connection, instruments the app through the otel-instrumentation skill, launches it with `kopai run` so the token stays out of sight, proves data arrived, and reports. Use when `./.kopairc` has an `otlp` block and the user says "add observability", "confirm telemetry reaches Kopai", "get started with Kopai", or pastes the prompt from the Kopai dashboard's Get started page. Do NOT use against a local `@kopai/app` backend (use otel-instrumentation), to investigate telemetry for a cause (use root-cause-analysis), or to build dashboards (use create-dashboard).
license: Apache-2.0
metadata:
  author: kopai
  version: "1.0.0"
---

# Get started with Kopai Cloud

`kopai setup` has already done the sign-in: `./.kopairc` holds the tokens, the skills are
installed, and the Kopai connector is registered in this agent. Your job is to get the
first trace, log or metric from this app into the workspace, and prove it got there. The
person watching the dashboard's Get started page sees a tick when it does.

## The one rule about secrets

`.kopairc` holds two tokens. The CLI reads them for you. **Never** `cat`, `jq`, `grep` or
open `.kopairc` for its tokens, never print a token, and never paste one into code, an
`.env` file, a commit or this chat. Everything below works without seeing a token:

| Need                                  | Do                                                       |
| ------------------------------------- | -------------------------------------------------------- |
| Know the connection works             | `npx @kopai/cli whoami`                                  |
| Launch the app so it exports to Kopai | `npx @kopai/cli run -- <command>`                        |
| Query what arrived                    | `npx @kopai/cli traces search …` (and `logs`, `metrics`) |

Run every CLI command from the directory that holds `.kopairc`. From anywhere else the
CLI falls back to a different backend and finds nothing.

## 1. Check the connection

```bash
npx @kopai/cli whoami
```

Expect both `Token is valid.` and `Backend token is valid.`. Anything else: stop and tell
the user what it printed.

| It printed                                                               | Meaning                                                | Tell the user                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `Not logged in.`, or no `OTLP endpoint:` line                            | setup has not run in this directory                    | Run the setup command from the dashboard's Get started page here, then paste the prompt again |
| `Token is invalid or expired.` or `Backend token is invalid or revoked.` | a token was revoked, or the workspace no longer exists | Run setup again with a fresh command from the dashboard                                       |
| `Could not reach …`                                                      | network, VPN, or a wrong `--api` at setup              | Check that the URL it printed is reachable from this machine                                  |

## 2. Instrument the app

Follow the **otel-instrumentation** skill in Kopai Cloud mode, from its workflow step 2.
Two things differ from a local backend, and that skill says so:

- Start nothing. The backend is Kopai Cloud.
- Launch the app through `kopai run`. It sets `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` from `.kopairc` and
  passes every other variable through unchanged:

```bash
RUN_ID=$(uuidgen)
export OTEL_SERVICE_NAME=<service name>
export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID"
export OTEL_BSP_SCHEDULE_DELAY=500
npx @kopai/cli run -- npm start        # or: node server.js | go run ./cmd/api | python -m app
```

Take the service name from the project: the package name, the module name, or the
directory. Never leave it unset; that arrives as `unknown_service`.

If the app has a browser part, instrument the server first. Browser code needs a frontend
token, which setup does not create: ask the user for one from the dashboard when you get
there, and never put the backend token in client-side code.

## 3. Prove it arrived

Drive traffic yourself (**drive-traffic** in otel-instrumentation), then:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json
```

Non-empty means the workspace is receiving telemetry; the Get started page ticks its
second step within a few seconds. Then run the assertions in **validate-traces**. Do not
report done on a red assertion.

Nothing arrives → **troubleshoot-no-data**, Kopai Cloud notes first. Two Cloud-specific
causes come before everything else:

| Symptom                               | Cause                                                           |
| ------------------------------------- | --------------------------------------------------------------- |
| App logs show `401` from the exporter | The app was not launched through `kopai run`                    |
| Spans arrive as `unknown_service`     | `OTEL_SERVICE_NAME` was not exported in the shell that launched |

## 4. Report

Tell the user, in this order:

1. Which service name is now reporting, and what you drove to prove it.
2. Which files changed, and that the tokens stayed in `.kopairc` (gitignored) and were
   never copied anywhere.
3. How to start the app with telemetry from now on: the same `kopai run` line locally,
   and the equivalent exporter variables in their deployment, which they read from
   `.kopairc` themselves.
4. One first question to ask in the dashboard, for example "Which requests were slowest
   in the last hour?"
