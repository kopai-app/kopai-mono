| title                 | impact   | tags                              |
| --------------------- | -------- | --------------------------------- |
| Configure Environment | CRITICAL | setup, env, config, run-id, cloud |

# Configure Environment

Export these in the shell that launches the app — not in the shell you run the CLI from.
The SDK reads them at startup. In Kopai Cloud mode (`./.kopairc` has an `otlp` block),
replace the first line with the two exports under [Kopai Cloud](#kopai-cloud).

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-service

# tag this validation run so assertions can read exactly its telemetry
RUN_ID=$(uuidgen)
export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID"

# flush promptly so short runs don't lose their tail
export OTEL_BSP_SCHEDULE_DELAY=500
export OTEL_METRIC_EXPORT_INTERVAL=1000
```

| Variable                      | Value                                 | Purpose                                 |
| ----------------------------- | ------------------------------------- | --------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318`               | Kopai collector                         |
| `OTEL_EXPORTER_OTLP_HEADERS`  | `Authorization=Bearer%20<otlp.token>` | Kopai Cloud only: authenticates the app |
| `OTEL_SERVICE_NAME`           | your service                          | Identifies the service in telemetry     |
| `OTEL_RESOURCE_ATTRIBUTES`    | `validation.run_id=<uuid>`            | Makes the validation loop deterministic |
| `OTEL_BSP_SCHEDULE_DELAY`     | `500`                                 | Span flush interval, ms                 |
| `OTEL_METRIC_EXPORT_INTERVAL` | `1000`                                | Metric export interval, ms              |

## Kopai Cloud

When `./.kopairc` has an `otlp` block, the endpoint and token come from it:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=$(jq -r .otlp.endpoint .kopairc)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20$(jq -r .otlp.token .kopairc)"
```

Everything else on this page applies unchanged.

- `OTEL_EXPORTER_OTLP_HEADERS` is a comma-separated list of `key=value` pairs in the W3C
  Baggage format. A space is not allowed raw, so write the one after `Bearer` as `%20`.
  Every OTel SDK decodes it before sending the header.
- The SDK sends the header with every export. Without it, Kopai Cloud answers 401 and
  nothing arrives.
- Never echo the token, paste it into code, or commit `.kopairc`.

**Run the CLI from the directory that holds `.kopairc`.** `npx @kopai/cli` reads
`./.kopairc` from the current directory, then falls back to `~/.kopairc` and finally
`http://localhost:8000`. From any other directory, the run-tag query below asks the wrong
backend and finds nothing — or fails with 401 or 403.

## The run tag

`OTEL_RESOURCE_ATTRIBUTES` is honoured by every OTel SDK and lands on the resource of
every span, log, and metric the process emits. That turns validation from a time-window
guess into an exact query:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json
```

Only this run's data comes back — no stale spans from the previous attempt, no other
services on the same backend. Mint a fresh `$RUN_ID` every time you re-drive after a fix,
so a stale pass can never be mistaken for a fresh one. See `drive-traffic.md`.

You can stack more resource attributes on the same variable, comma-separated:

```bash
export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID,deployment.environment=local,service.version=$(git rev-parse --short HEAD)"
```

`service.version` is worth setting permanently — it answers "what changed?", which is
half of every incident. See [references/attributes.md](../references/attributes.md).

## Protocol: HTTP only

Kopai accepts OTLP over **HTTP** on port 4318 (Kopai Cloud: the HTTPS endpoint in
`.kopairc`). gRPC (4317) is not supported.

Some SDKs default to gRPC. If you see connection errors, force the protocol:

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

| SDK     | Default | Action                                          |
| ------- | ------- | ----------------------------------------------- |
| Node.js | HTTP    | None                                            |
| Python  | HTTP    | None                                            |
| Go      | gRPC    | Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| Java    | gRPC    | Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| .NET    | HTTP    | None                                            |
| Rust    | HTTP    | None                                            |

## Sampling during validation

Leave sampling off while validating. `OTEL_TRACES_SAMPLER=always_on` is the default; if
anything set it otherwise, the assertions in `validate-traces.md` become probabilistic
and stop being a usable gate. Apply production sampling only after the loop is **green** —
see `sampling.md`.

## Reference

https://opentelemetry.io/docs/concepts/sdk-configuration/otlp-exporter-configuration/
