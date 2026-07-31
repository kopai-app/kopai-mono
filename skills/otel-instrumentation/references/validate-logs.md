| title         | impact | tags                        |
| ------------- | ------ | --------------------------- |
| Validate Logs | HIGH   | validate, logs, correlation |

# Validate Logs

A log that isn't correlated to a trace is a log you'll read in isolation at 3am. The
point of routing logs through OTel is that each record carries the trace context of the
work that produced it. These assertions prove that it does.

Run these only if the service emits logs through OTel. If it doesn't yet, that is a gap
worth raising — see `layered-telemetry.md` for when logs earn their place.

## L1 — Logs arrived for this run

```bash
npx @kopai/cli logs search --service "$OTEL_SERVICE_NAME" --json | jq 'length'
```

**Pass:** greater than zero.
**Fail:** the log bridge isn't wired. The SDK log exporter is separate from the trace
exporter in most languages — installing tracing does not give you logs. See
`references/lang-<language>.md`.

## L2 — Logs carry trace context

Take a trace ID from the run and ask for its logs:

```bash
TRACE_ID=$(npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --limit 1 --json | jq -r '.[0].TraceId')

npx @kopai/cli logs search --trace-id "$TRACE_ID" --json | jq 'length'
```

**Pass:** greater than zero. Logs emitted during a request resolve back to that request.
**Fail:** the log records were created outside an active span context, or the bridge
isn't injecting context. Two usual causes:

- The logger is called before the SDK initialises, or on a thread the context didn't
  reach — see `context-propagation.md`
- The bridge is installed but the app still writes through the raw logger it bypassed

## L3 — Severity survives the bridge

```bash
npx @kopai/cli logs search --service "$OTEL_SERVICE_NAME" --severity-text ERROR --json \
  | jq 'length'
```

**Pass:** matches the failures you drove in `drive-traffic.md`.
**Fail:** severity is being flattened. Every record arriving as `INFO` means the bridge
isn't mapping your library's levels onto OTel severity numbers, so you can never filter
for real problems.

## L4 — Failures actually say what failed

```bash
npx @kopai/cli logs search --service "$OTEL_SERVICE_NAME" --severity-text ERROR --json \
  | jq -r '.[] | .Body' | head -20
```

**Pass:** each body identifies the operation and the reason. Structured fields beat
interpolated strings — `{"op":"charge","err":"card_declined"}` is queryable,
`"charge failed: card_declined"` is a substring search.
**Fail:** printf-style messages. Convert to structured logging; it is tedious but
mechanical, and it is the difference between grep and `GROUP BY`.

## L5 — Logs go to both places

Check the app's own stdout/stderr while it runs.

**Pass:** log lines appear locally _and_ in Kopai. You want both: stderr for the tight
feedback loop while developing, OTel for correlation.
**Fail:** if the bridge replaced local output entirely, developers lose their debugging
loop and will route around the bridge. Use a fan-out handler that writes to both.

## Done when

L1–L5 pass for `$OTEL_SERVICE_NAME` on this run. Then `validate-metrics.md`.

## Reference

[Kopai CLI](../references/cli-reference.md) · [Kopai CLI source](https://github.com/kopai-app/kopai-mono/tree/main/packages/cli)
