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
jq -e .otlp.endpoint .kopairc     # prints the endpoint and exits 0 in Cloud mode
```

The block also holds the app's token. Do not print it: `kopai run` and `kopai whoami` read
it for you.

In Cloud mode, never run `npx @kopai/app start`. Launch the app through the CLI, which puts
the endpoint and token in its environment:

```bash
npx @kopai/cli run -- <the command that starts the app>
```

### Confirm it accepts your token

```bash
npx @kopai/cli whoami
```

`Backend token is valid.` means Kopai Cloud accepts OTLP with this token: the CLI sent the
same empty POST to `<otlp.endpoint>/v1/traces` that an app's first export makes. This is
step 1 of the workflow in Cloud mode. `Backend token is invalid or revoked.` means the
token no longer works: ask the user to run `kopai setup` again with a fresh command from
the dashboard. Do not proceed past anything but `valid` here.

Keep the token out of sight. Never read it out of `.kopairc`, paste it into code, or commit
the file — `kopai setup` adds it to `.gitignore`.

The CLI reads the `url` and `token` from the same file, so the validation steps work
unchanged. Run them from the directory that holds `.kopairc`.

## Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/app
