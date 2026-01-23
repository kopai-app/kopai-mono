# @kopai/cli

Command-line tool for querying OpenTelemetry observability data (traces, logs, metrics).

## Installation

```bash
npm install -g @kopai/cli
# or
pnpm add -g @kopai/cli
```

## Quick Start

```bash
# Search for error traces
kopai traces search --status-code ERROR --limit 10

# Get all spans for a trace
kopai traces get <traceId>

# Search logs by service
kopai logs search --service my-api --limit 20

# Discover available metrics
kopai metrics discover
```

By default connects to `http://localhost:8000/signals`.

## Configuration

### Global Options

| Option                   | Description      |
| ------------------------ | ---------------- |
| `--url <url>`            | API base URL     |
| `--token <token>`        | Auth token       |
| `--config <path>` / `-c` | Config file path |
| `--timeout <ms>`         | Request timeout  |

### Config File

Create `.kopairc` in project root or home directory:

```json
{
  "url": "https://your-kopai-server.com/signals",
  "token": "your-token"
}
```

**Priority:** CLI flags → local `.kopairc` → `~/.kopairc` → defaults

## Commands

### traces

#### `traces get <traceId>`

Get all spans for a trace.

```bash
kopai traces get abc123def456
```

#### `traces search`

Search traces with filters.

```bash
kopai traces search --service my-api --status-code ERROR
kopai traces search --span-name "POST /users" --duration-min 1000000000
kopai traces search --span-attr "http.method=GET" --resource-attr "k8s.pod.name=web-1"
```

**Filters:**

- `--trace-id`, `--span-id`, `--parent-span-id`
- `-s, --service` - service name
- `--span-name` - span name
- `--span-kind` - CLIENT, SERVER, PRODUCER, CONSUMER, INTERNAL
- `--status-code` - OK, ERROR, UNSET
- `--scope` - instrumentation scope
- `--timestamp-min`, `--timestamp-max` - nanoseconds
- `--duration-min`, `--duration-max` - nanoseconds
- `--span-attr <key=value>` - repeatable
- `--resource-attr <key=value>` - repeatable
- `--sort` - ASC or DESC

**Fields:** SpanId, TraceId, Timestamp, Duration, ParentSpanId, ServiceName, SpanName, SpanKind, StatusCode, StatusMessage, SpanAttributes, ResourceAttributes, ScopeName, ScopeVersion, TraceState, Events, Links

### logs

#### `logs search`

Search logs with filters.

```bash
kopai logs search --service my-api --severity-text ERROR
kopai logs search --trace-id abc123 --body "connection failed"
kopai logs search --log-attr "user.id=123"
```

**Filters:**

- `--trace-id`, `--span-id` - correlate with traces
- `-s, --service` - service name
- `--scope` - scope name
- `--severity-text` - DEBUG, INFO, WARN, ERROR, FATAL
- `--severity-min`, `--severity-max` - 0-24
- `-b, --body` - body content substring
- `--timestamp-min`, `--timestamp-max` - nanoseconds
- `--log-attr <key=value>` - repeatable
- `--resource-attr <key=value>` - repeatable
- `--scope-attr <key=value>` - repeatable
- `--sort` - ASC or DESC

**Fields:** Timestamp, TraceId, SpanId, ServiceName, SeverityText, SeverityNumber, Body, LogAttributes, ResourceAttributes, ScopeName, ScopeVersion, ScopeAttributes, TraceFlags

### metrics

#### `metrics search --type <type>`

Search metrics by type.

```bash
kopai metrics search --type Gauge --name cpu_usage
kopai metrics search --type Histogram --service my-api
kopai metrics search --type Sum --attr "host=server1"
```

**Types:** Gauge, Sum, Histogram, ExponentialHistogram, Summary

**Filters:**

- `-n, --name` - metric name
- `-s, --service` - service name
- `--scope` - scope name
- `--time-min`, `--time-max` - nanoseconds
- `-a, --attr <key=value>` - repeatable
- `--resource-attr <key=value>` - repeatable
- `--scope-attr <key=value>` - repeatable
- `--sort` - ASC or DESC

**Fields:** TimeUnix, StartTimeUnix, MetricType, MetricName, MetricDescription, MetricUnit, ServiceName, Value, Count, Sum, Min, Max, Attributes, ResourceAttributes, ScopeName, ScopeAttributes, Exemplars, BucketCounts, ExplicitBounds

#### `metrics discover`

List available metrics.

```bash
kopai metrics discover
kopai metrics discover --json
```

**Fields:** name, type, unit, description, attributes, resourceAttributes

## Output Options

| Option                 | Description            |
| ---------------------- | ---------------------- |
| `-j, --json`           | JSON output            |
| `-t, --table`          | Table output           |
| `-f, --fields <f1,f2>` | Select specific fields |
| `-l, --limit <n>`      | Max results            |

**Auto-detection:** TTY outputs table, piped output defaults to JSON.

```bash
# Select specific fields
kopai traces search --fields "SpanId,ServiceName,Duration"

# Pipe JSON to jq
kopai logs search --json --service my-api | jq '.[] | .Body'
```

## Exit Codes

| Code | Meaning           |
| ---- | ----------------- |
| 0    | Success           |
| 1    | API/runtime error |
| 2    | Invalid arguments |
| 3    | Config error      |

## Examples

```bash
# Find slow traces (>1s duration)
kopai traces search --duration-min 1000000000 --json

# Get logs correlated with a trace
kopai traces get abc123 --fields TraceId
kopai logs search --trace-id abc123

# Export error logs as JSON
kopai logs search --severity-text ERROR --json > errors.json

# Monitor specific service
kopai traces search --service payment-api --status-code ERROR --limit 50
```
