# @kopai/app

Local OpenTelemetry backend with an http/json Otel collector, Otel data storage and API to query the data.

## Quick Start

```bash
npx @kopai/app start
```

Starts two servers:

- **API server** on port 8000 (query traces, logs, metrics)
- **OTEL collector** on port 4318 (receives OTLP/HTTP data)

## Kopai App server usage

```bash
npx @kopai/app <command>
```

### Commands

| Command | Description       |
| ------- | ----------------- |
| `start` | Start the server  |
| `help`  | Show help message |

### Options

| Option          | Description       |
| --------------- | ----------------- |
| `-h, --help`    | Show help message |
| `-v, --version` | Show version      |

### Global Install (optional)

```bash
npm install -g @kopai/app
kopai-server start
```

## Environment Variables

| Variable              | Default     | Description                  |
| --------------------- | ----------- | ---------------------------- |
| `SQLITE_DB_FILE_PATH` | `:memory:`  | Path to SQLite database file |
| `PORT`                | `8000`      | API server port              |
| `HOST`                | `localhost` | Host to bind                 |

### Examples

```bash
# [In-memory](https://www.sqlite.org/inmemorydb.html) database (default)
npx @kopai/app start

# Persistent database [sqlite db path](https://nodejs.org/api/sqlite.html)
SQLITE_DB_FILE_PATH=./data.db npx @kopai/app start

# Custom port
PORT=3000 npx @kopai/app start
```

## Endpoints

- **OTEL Collector** - `localhost:4318` - [OTLP/HTTP endpoints](https://opentelemetry.io/docs/specs/otlp/#otlphttp-request)
- **API Server** - `localhost:8000` - see [/documentation](http://localhost:8000/documentation) for available endpoints

## Sending Telemetry

Your application needs an [OpenTelemetry SDK](https://opentelemetry.io/docs/languages/) for your language.

Configure it to export OTLP/HTTP data to `http://localhost:4318`:

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

See [OTLP Exporter Configuration](https://opentelemetry.io/docs/specs/otel/protocol/exporter/#example-1) for more details.

## Example Workflow

### 1. Start Kopai

```bash
npx @kopai/app start
```

### 2. Run your instrumented app

```bash
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-app

node my-app.js
```

### 3. Query your telemetry data

**Search traces:**

```bash
curl -X POST http://localhost:8000/signals/traces/search \
  -H "Content-Type: application/json" \
  -d '{"serviceName": "my-app"}'
```

**Get a specific trace:**

```bash
curl http://localhost:8000/signals/traces/<traceId>
```

**Search logs:**

```bash
curl -X POST http://localhost:8000/signals/logs/search \
  -H "Content-Type: application/json" \
  -d '{"serviceName": "my-app"}'
```

**Discover available metrics:**

```bash
curl http://localhost:8000/signals/metrics/discover
```

**Search metrics:**

```bash
curl -X POST http://localhost:8000/signals/metrics/search \
  -H "Content-Type: application/json" \
  -d '{"metricName": "http.server.duration"}'
```

### Query telemetry data using @kopai/cli (recommended)

[@kopai/cli](https://github.com/Vunovati/kopai-mono/tree/main/packages/cli) provides a simpler interface for querying data. It's also better suited for LLM agents.

```bash
# Search traces
npx @kopai/cli traces search --service my-app

# Get a specific trace
npx @kopai/cli traces get <traceId>

# Search logs
npx @kopai/cli logs search --service my-app

# Discover metrics
npx @kopai/cli metrics discover

# Search metrics
npx @kopai/cli metrics search --type Gauge --name http.server.duration
```

See [@kopai/cli README](https://github.com/Vunovati/kopai-mono/tree/main/packages/cli) for all available options.
