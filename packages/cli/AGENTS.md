# Kopai CLI - Agent Guide

Machine-readable documentation for LLM agents.

## Installation

```bash
pnpm add @kopai/cli
# or run via npx
npx @kopai/cli <command>
```

## Configuration

**Default:** `https://api.kopai.app/v2` (hosted Kopai instance, requires auth)

Run `kopai login` to save a token, or pass `--token` on each call. For local development against `@kopai/app`, override with `--url http://localhost:8000` (no auth required).

To persist configuration, create `.kopairc` in current or home directory:

```json
{
  "url": "https://your-kopai-server.com/signals",
  "token": "your-token"
}
```

Or use flags: `--url <url> --token <token>`

`kopai setup` also writes an `otlp` block: where an instrumented app sends telemetry. Query
commands ignore it.

```json
{
  "url": "https://api.kopai.app/v2",
  "token": "kpi_…",
  "otlp": { "endpoint": "https://otlp-http.kopai.app", "token": "kpi_…" }
}
```

## Setup

`kopai setup` connects the current project to a Kopai workspace in one step. Copy the
command, with its one-time code, from the Kopai dashboard. Run it from the project root.

```bash
npx @kopai/cli setup --code kps_…
kopai setup --code kps_… --api http://localhost:3000    # local Kopai stack
kopai setup --code kps_… --dry-run                      # print the plan only
```

What it does, in order:

1. Exchanges the code at `POST <api>/v1/setup/exchange`. The code is single-use and
   expires after 15 minutes.
2. Writes `./.kopairc` (mode 0600): `url` and `token` for the CLI, and the `otlp` block.
   Existing keys in the file are kept. Inside a git repository, adds `.kopairc` to
   `./.gitignore` when no `.gitignore` up to the repository root lists it.
3. Installs the skills `kopai-get-started`, `otel-instrumentation`, `root-cause-analysis`,
   and `create-dashboard` into the project:
   `npx -y skills add <source> --skill kopai-get-started otel-instrumentation root-cause-analysis create-dashboard -y`.
4. Registers the Kopai MCP connector, named `kopai`, in each coding agent found:
   - Claude Code: `claude mcp add --transport http kopai <mcpUrl>`
   - Codex: `codex mcp add kopai --url <mcpUrl>`
   - Cursor: sets `mcpServers.kopai.url` in `./.cursor/mcp.json`, keeping other servers.

   A connector that is already registered counts as done. When the workspace has no MCP
   URL, this step is skipped with a note.

5. Prints the first prompt to give your coding agent. With `--launch`, starts Claude Code
   with it.

Progress goes to stderr; the final next-step lines go to stdout. A failed skills or
connector step prints the command to run yourself, the remaining steps still run, and the
exit code is 1.

| Flag                    | Description                                                                      |
| ----------------------- | -------------------------------------------------------------------------------- |
| `--code <code>`         | One-time setup code from the dashboard (required)                                |
| `--api <url>`           | API origin (default `https://api.kopai.app`)                                     |
| `--skills-source <src>` | Source for `npx skills add` (default `kopai-app/kopai-mono`; a local path works) |
| `--agent <names>`       | Agents to register, comma-separated: `claude,codex,cursor` (default: all found)  |
| `--no-skills`           | Skip installing the skills                                                       |
| `--no-mcp`              | Skip registering the MCP connector                                               |
| `--dry-run`             | Print the plan; do not exchange the code, run commands, or write files           |
| `--yes`                 | Do not ask before editing `.gitignore` or launching Claude Code                  |
| `--launch`              | Start Claude Code with the first prompt when setup is done                       |

An agent counts as found when its binary (`claude`, `codex`) is on PATH. Cursor counts when
`./.cursor` exists or `cursor` or `cursor-agent` is on PATH.

Questions are asked only when stdin is a terminal. Without one, `.gitignore` is updated
without asking, and `--launch` needs `--yes`.

| Exit code | Meaning in `setup`                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------- |
| 0         | Done (also for `--dry-run`)                                                                              |
| 1         | The exchange failed (invalid or expired code, network, rate limit), or a skills or connector step failed |
| 2         | Invalid arguments: missing `--code`, bad `--api`, unknown `--agent`                                      |
| 3         | `./.kopairc` cannot be written                                                                           |

## Run

`kopai run` starts a command with the exporter settings from the `otlp` block in `./.kopairc`
in its environment. An agent launches an instrumented app this way without reading the
token. Run it from the directory that holds `.kopairc`; options after the command belong to
the command.

```bash
npx @kopai/cli run -- node server.js
OTEL_SERVICE_NAME=shop-api npx @kopai/cli run -- npm start
npx @kopai/cli run -- go run ./cmd/api --port 8080
```

It sets these three, replacing any existing values, and passes everything else through:

| Variable                      | Value                                 |
| ----------------------------- | ------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `otlp.endpoint`                       |
| `OTEL_EXPORTER_OTLP_HEADERS`  | `Authorization=Bearer%20<otlp.token>` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`                       |

One line goes to stderr before the command starts: the endpoint and a prefix of the token.
The exit code is the command's own; 127 when it could not be started; 3 when `.kopairc`
has no `otlp` block.

## Whoami

`kopai whoami` prints a prefix of the CLI token and its URL, then checks the token with a
one-row trace search (`Token is valid.`). When `.kopairc` has an `otlp` block it also prints
the OTLP endpoint and a prefix of the backend token, then checks that token with an empty
`POST <otlp.endpoint>/v1/traces` (`Backend token is valid.`, `Backend token is invalid or
revoked.`, or `Could not reach the OTLP endpoint …`). Any failed check sets the exit code
to 1. Tokens are never printed in full.

## Commands

### Traces

```bash
# Get all spans for a trace
kopai traces get <traceId> --json

# Search traces
kopai traces search --service myapp --limit 100 --json
kopai traces search --span-name "GET /api" --status-code ERROR --json
kopai traces search --timestamp-min 1700000000000000000 --timestamp-max 1700001000000000000 --json
kopai traces search --span-attr key=value --resource-attr service.version=1.0 --json
```

### Logs

```bash
# Search logs
kopai logs search --service myapp --limit 100 --json
kopai logs search --severity-text ERROR --json
kopai logs search --body "exception" --json
kopai logs search --trace-id abc123 --json
kopai logs search --log-attr key=value --json
```

### Metrics

```bash
# Discover available metrics
kopai metrics discover --json

# Search metrics (--type required)
kopai metrics search --type Gauge --name http_requests_total --json
kopai metrics search --type Sum --service myapp --json
kopai metrics search --type Histogram --attr endpoint=/api --json
```

## Output Formats

- `--json` / `-j`: JSON output (default when piped)
- `--table` / `-t`: Table output (default for TTY)

Always use `--json` when parsing output programmatically.

## Exit Codes

| Code | Meaning                    |
| ---- | -------------------------- |
| 0    | Success                    |
| 1    | API/runtime error          |
| 2    | Invalid arguments          |
| 3    | Config error (missing url) |

## Common Flags

| Flag              | Short | Description                       |
| ----------------- | ----- | --------------------------------- |
| `--json`          | `-j`  | JSON output                       |
| `--table`         | `-t`  | Table output                      |
| `--fields <f>`    | `-f`  | Comma-separated fields to include |
| `--limit <n>`     | `-l`  | Max results                       |
| `--timeout <ms>`  |       | Request timeout                   |
| `--config <path>` | `-c`  | Config file path                  |
| `--url <url>`     |       | API base URL                      |
| `--token <token>` |       | Auth token                        |

## Filter Options

Flags marked `(repeatable)` can be specified multiple times; all conditions must match (AND logic).

### Traces Search

- `--trace-id`, `--span-id`, `--parent-span-id`
- `--service` / `-s`, `--span-name`, `--span-kind`, `--status-code`, `--scope`
- `--timestamp-min`, `--timestamp-max` (nanoseconds)
- `--duration-min`, `--duration-max` (nanoseconds)
- `--span-attr key=value` (repeatable)
- `--resource-attr key=value` (repeatable)
- `--sort ASC|DESC`

### Logs Search

- `--trace-id`, `--span-id`
- `--service` / `-s`, `--scope`
- `--severity-text`, `--severity-min`, `--severity-max`
- `--body` / `-b` (substring match)
- `--timestamp-min`, `--timestamp-max` (nanoseconds)
- `--log-attr key=value` (repeatable)
- `--resource-attr key=value` (repeatable)
- `--scope-attr key=value` (repeatable)
- `--sort ASC|DESC`

### Metrics Search

- `--type` (required): Gauge, Sum, Histogram, ExponentialHistogram, Summary
- `--name` / `-n`, `--service` / `-s`, `--scope`
- `--time-min`, `--time-max` (nanoseconds)
- `--attr` / `-a` key=value (repeatable)
- `--resource-attr key=value` (repeatable)
- `--scope-attr key=value` (repeatable)
- `--sort ASC|DESC`

## Available Fields (--fields)

### Traces (get/search)

`SpanId, TraceId, Timestamp, Duration, ParentSpanId, ServiceName, SpanName, SpanKind, StatusCode, StatusMessage, SpanAttributes, ResourceAttributes, ScopeName, ScopeVersion, TraceState, Events, Links`

### Logs (search)

`Timestamp, TraceId, SpanId, ServiceName, SeverityText, SeverityNumber, Body, LogAttributes, ResourceAttributes, ScopeName, ScopeVersion, ScopeAttributes, TraceFlags`

### Metrics (search)

`TimeUnix, StartTimeUnix, MetricType, MetricName, MetricDescription, MetricUnit, ServiceName, Value, Count, Sum, Min, Max, Attributes, ResourceAttributes, ScopeName, ScopeAttributes, Exemplars, BucketCounts, ExplicitBounds`

### Metrics (discover)

`name, type, unit, description, attributes, resourceAttributes`

### Dashboards

```bash
# Print UI tree component schema
kopai dashboards schema

# Create a dashboard (pipe uiTree JSON via stdin)
echo '{"uiTree":{"root":"s1","elements":{"s1":{"key":"s1","type":"Stack","props":{"direction":"vertical","gap":"md","align":null},"children":[],"parentKey":""}}},"metadata":{}}' | kopai dashboards create --name "My Dashboard" --tree-version "0.5.0" --json
```

## Examples for Agents

```bash
# Find recent errors
kopai traces search --status-code ERROR --limit 10 --json

# Get logs for a specific trace
kopai logs search --trace-id abc123 --json

# List all available metrics
kopai metrics discover --json

# Get CPU metrics
kopai metrics search --type Gauge --name process_cpu_seconds_total --json

# Filter by multiple attributes (repeat flag for each)
kopai traces search --span-attr rpc.system=grpc --span-attr rpc.service=UserService --json

# Select specific fields
kopai traces search --fields TraceId,SpanName,Duration --table
kopai logs search --fields Timestamp,Body,SeverityText --json
kopai metrics discover --fields name,type --table
```
