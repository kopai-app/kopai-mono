---
"@kopai/cli": minor
---

Added `kopai run -- <command>`, which starts a command with the exporter settings from the `otlp` block in `./.kopairc` in its environment: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (`Authorization=Bearer%20<token>`) and `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`. Every other variable passes through, options after the command belong to it, and the exit code is the command's. A coding agent can launch an instrumented app this way without ever reading the token. Without an `otlp` block it exits 3 and points at `kopai setup`.

`kopai whoami` now also reports the `otlp` block: the endpoint, a prefix of the backend token, and whether Kopai Cloud accepts that token, checked with an empty OTLP request. A rejected or unreachable endpoint sets the exit code to 1.

`kopai setup` installs the new `kopai-get-started` skill in addition to `otel-instrumentation`, `root-cause-analysis` and `create-dashboard`.
