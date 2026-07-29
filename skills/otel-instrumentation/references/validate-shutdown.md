| title             | impact | tags                      |
| ----------------- | ------ | ------------------------- |
| Validate Shutdown | HIGH   | validate, shutdown, flush |

# Validate Shutdown

The batch processor buffers. A process that exits without flushing drops everything it
was holding — typically the last few seconds, which is exactly the window containing the
crash you wanted to debug.

This failure is invisible during normal development: long-running servers flush on their
interval and look fine, while short-lived jobs and crashed processes silently lose their
tail. Assert on it once, explicitly.

## S1 — The final batch lands

```bash
RUN_ID=$(uuidgen); export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID"
# start the app, drive one request, then:
kill "$APP_PID"        # SIGTERM — never kill -9
sleep 5

npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json | jq 'length'
```

**Pass:** the spans from just before the signal are present.
**Fail:** shutdown isn't flushing. Three usual causes:

- No signal handler is registered, so the process exits immediately
- The handler calls `exit()` before `shutdown()` resolves — it must be awaited
- The shutdown timeout is shorter than the export takes; give it 10–30s

Each language's setup in `references/lang-<language>.md` shows the shutdown hook. Verify it
exists in your code rather than assuming the SDK installed one — most SDKs do not.

## S2 — Short-lived processes flush too

For CLI tools, jobs, serverless handlers, and test runs, the process may finish before
the first scheduled export ever fires.

**Pass:** a one-shot invocation produces spans in Kopai.
**Fail:** the run ended before the batch interval. Two fixes, in order of preference:

1. Call `forceFlush()` (or the language equivalent) before exiting — correct and explicit
2. Set `OTEL_BSP_SCHEDULE_DELAY=500` — a blunt instrument that shortens the window but
   never closes it

For serverless, flushing before returning is mandatory, not an optimisation: the runtime
freezes the process the moment your handler returns, and the buffer freezes with it.

## S3 — Telemetry failure never breaks the app

Stop Kopai, then start the app:

```bash
# with the Kopai backend stopped
<start your app>
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/"
```

**Pass:** the app starts and serves traffic normally. Export errors may be logged; that
is fine.
**Fail:** the app refuses to start, hangs, or 500s because it can't reach the collector.
Instrumentation must never be load-bearing. Wrap SDK init so a failure logs and continues
— an observability outage that takes production down with it is worse than no
observability.

## Done when

S1–S3 pass. That closes the loop: the telemetry is correct, complete, survives shutdown,
and cannot take the service down. Report what you instrumented, which assertions you ran,
and the `$RUN_ID` they were green against.
