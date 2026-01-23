# Kopai CLI - Agent Guide

Machine-readable documentation for LLM agents.

## Installation

```bash
pnpm add @kopai/cli
# or run via npx
npx @kopai/cli <command>
```

## Configuration

**Default:** `http://localhost:8000/signals` (no auth required)

Works out of the box with local @kopai/app. No configuration needed for local development.

For remote/authenticated APIs, create `.kopairc` in current or home directory:

```json
{
  "url": "https://your-kopai-server.com/signals",
  "token": "your-token"
}
```

Or use flags: `--url <url> --token <token>`

## Commands

### Traces

```bash
# Get all spans for a trace
@kopai/cli traces get <traceId> --json

# Search traces
@kopai/cli traces search --service myapp --limit 100 --json
@kopai/cli traces search --span-name "GET /api" --status-code ERROR --json
@kopai/cli traces search --timestamp-min 1700000000000000000 --timestamp-max 1700001000000000000 --json
@kopai/cli traces search --span-attr key=value --resource-attr service.version=1.0 --json
```

### Logs

```bash
# Search logs
@kopai/cli logs search --service myapp --limit 100 --json
@kopai/cli logs search --severity-text ERROR --json
@kopai/cli logs search --body "exception" --json
@kopai/cli logs search --trace-id abc123 --json
@kopai/cli logs search --log-attr key=value --json
```

### Metrics

```bash
# Discover available metrics
@kopai/cli metrics discover --json

# Search metrics (--type required)
@kopai/cli metrics search --type Gauge --name http_requests_total --json
@kopai/cli metrics search --type Sum --service myapp --json
@kopai/cli metrics search --type Histogram --attr endpoint=/api --json
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

## Examples for Agents

```bash
# Find recent errors
@kopai/cli traces search --status-code ERROR --limit 10 --json

# Get logs for a specific trace
@kopai/cli logs search --trace-id abc123 --json

# List all available metrics
@kopai/cli metrics discover --json

# Get CPU metrics
@kopai/cli metrics search --type Gauge --name process_cpu_seconds_total --json

# Filter by multiple attributes (repeat flag for each)
@kopai/cli traces search --span-attr rpc.system=grpc --span-attr rpc.service=UserService --json

# Select specific fields
@kopai/cli traces search --fields TraceId,SpanName,Duration --table
@kopai/cli logs search --fields Timestamp,Body,SeverityText --json
@kopai/cli metrics discover --fields name,type --table
```
