| title            | impact | tags                  |
| ---------------- | ------ | --------------------- |
| No Data Received | HIGH   | troubleshoot, no-data |

# No Data Received

Nothing arrived at all. Work down this list in order — each step rules out one layer, so
skipping ahead wastes time on the wrong layer.

## 1. Did anything actually run?

The most common cause of "no data" is no traffic. Confirm you drove the app in this run —
`drive-traffic.md` — before debugging the pipeline.

## 2. Is the collector accepting OTLP?

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'
```

Not 2xx → Kopai isn't running. `npx @kopai/app start` (`setup-backend.md`).

## 3. Is the app pointed at the right port?

```bash
echo "$OTEL_EXPORTER_OTLP_ENDPOINT"     # must be http://localhost:4318, not 8000
```

Port 8000 is the query API and does not accept OTLP — `troubleshoot-wrong-port.md`.

Check this in the shell that **launched the app**, not the one you're typing in. Exports
made after the process started never reach it.

## 4. Wrong protocol?

Go and Java SDKs default to gRPC on 4317. Kopai is HTTP-only:

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Symptom: connection refused or a hanging exporter, logged by the app at startup.

## 5. Did the process exit before flushing?

Short-lived processes routinely exit with a full buffer. Indistinguishable from a broken
pipeline until you check.

```bash
export OTEL_BSP_SCHEDULE_DELAY=500
```

Stop servers with SIGTERM (`kill $PID`), never SIGKILL, and `sleep 2` before asserting.
Full detail in `validate-shutdown.md`.

## 6. Did the SDK initialise at all?

Read the app's own startup output. SDK init failures are usually logged and then
swallowed, so the app runs perfectly while emitting nothing.

```bash
export OTEL_LOG_LEVEL=debug      # most SDKs; Node.js also honours OTEL_LOG_LEVEL=all
```

Look for exporter errors, a missing endpoint, or an SDK that never started. In Node.js
specifically, confirm the instrumentation file is loaded _before_ the app —
`node --import ./instrumentation.mjs server.mjs`, not `require` from inside `server.mjs`.

## 7. Is a sampler dropping everything?

```bash
echo "$OTEL_TRACES_SAMPLER"     # always_off or a tiny ratio explains total silence
export OTEL_TRACES_SAMPLER=always_on
```

## 8. Search without any filter

Rule out a filter typo before concluding nothing arrived:

```bash
npx @kopai/cli traces search --limit 50 --json | jq 'length'
```

Rows here but none for your `--resource-attr "validation.run_id=$RUN_ID"` means the run
tag never reached the process — re-export `OTEL_RESOURCE_ATTRIBUTES` and restart the app.

## Still nothing

Data exists but not the spans you expected → `troubleshoot-missing-spans.md`.
Spans exist but are bare → `troubleshoot-missing-attrs.md`.
