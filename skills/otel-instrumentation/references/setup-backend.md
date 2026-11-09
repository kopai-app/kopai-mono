| title               | impact   | tags                             |
| ------------------- | -------- | -------------------------------- |
| Start Kopai Backend | CRITICAL | setup, backend, collector, cloud |

# Start Kopai Backend

Check for Kopai Cloud first. If `./.kopairc` has an `otlp` block, skip this page down to
[Kopai Cloud](#kopai-cloud) and start nothing.

```bash
npx @kopai/app start
```

Starts two things, on two ports that are easy to confuse:

| Port | Service        | Direction                                     |
| ---- | -------------- | --------------------------------------------- |
| 4318 | OTEL collector | Your app **sends** telemetry here (OTLP/HTTP) |
| 8000 | API server     | The CLI and SDK **read** data from here       |

Pointing `OTEL_EXPORTER_OTLP_ENDPOINT` at 8000 is the most common setup mistake —
see `troubleshoot-wrong-port.md`.

## Confirm it is up

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'
```

A 2xx means the collector is accepting OTLP. This is step 1 of the workflow, and every
later assertion depends on it — do not proceed past a non-2xx here.

## Kopai Cloud

`kopai setup` connects a project to Kopai Cloud and writes `./.kopairc`. An `otlp` block in
that file means Cloud mode:

```bash
jq -e .otlp .kopairc     # prints the block and exits 0 in Cloud mode
```

```json
{
  "url": "https://api.kopai.app/v2",
  "token": "kpi_…",
  "otlp": { "endpoint": "https://otlp-http.kopai.app", "token": "kpi_…" }
}
```

In Cloud mode, never run `npx @kopai/app start`. Read the endpoint and token from the file
and export them in the shell that launches the app:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=$(jq -r .otlp.endpoint .kopairc)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20$(jq -r .otlp.token .kopairc)"
```

The `%20` is the space after `Bearer`, percent-encoded. See `setup-environment.md`.

### Confirm it accepts your token

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$(jq -r .otlp.endpoint .kopairc)/v1/traces" \
  -H "Authorization: Bearer $(jq -r .otlp.token .kopairc)" \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'
```

A 2xx means Kopai Cloud accepts OTLP with this token. This is step 1 of the workflow in
Cloud mode. A 401 means the token is wrong or revoked: run `kopai setup` again with a new
code from the dashboard. Do not proceed past a non-2xx here.

Keep the token out of sight. Never echo it, paste it into code, or commit `.kopairc` —
`kopai setup` adds it to `.gitignore`.

The CLI reads the `url` and `token` from the same file, so the validation steps work
unchanged. Run them from the directory that holds `.kopairc`.

## Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/app
