# @kopai/app

[![npm](https://img.shields.io/npm/v/@kopai/app?label=latest)](https://www.npmjs.com/package/@kopai/app)

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
- **MCP Server** - `localhost:8000/mcp` - read-only [MCP](https://modelcontextprotocol.io) endpoint, see [MCP](#mcp)

## MCP

The API server also serves a read-only MCP server at `/mcp`, so an MCP client on
the same machine can query your local telemetry. With Claude Code:

```bash
claude mcp add --transport http local-kopai http://localhost:8000/mcp
```

Use your `PORT` if you changed it. The server exposes two tools:

- `query` - search and aggregate traces, logs and metrics
- `metrics_discover` - list the metrics that exist, with their attributes

It works with MCP clients that run on your machine outside a browser, such as
Claude Code or the MCP Inspector's CLI:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:8000/mcp --method tools/list
```

These are not supported:

- clients that connect from a browser page directly, such as the Inspector's
  web UI in direct mode - the endpoint serves no CORS, so the browser blocks
  the request;
- clients in another container that reach Kopai by a name other than
  `localhost`, such as a Compose service name or `host.docker.internal` - the
  endpoint accepts loopback names only;
- connectors that connect from a vendor's backend (claude.ai, Claude Desktop's
  connector dialog), which cannot reach `localhost`.

**Security.** There is no authentication. `/mcp` refuses any request whose
`Host` or browser `Origin` is not `localhost`, `127.0.0.1` or `[::1]`, which
keeps web pages - including DNS-rebinding ones - out of the MCP endpoint.
Those checks cover `/mcp` only: the rest of the API, the dashboard and the
collector do not check `Host` or `Origin` yet, so a DNS-rebinding page can
still read your telemetry through them, and write telemetry that an agent later
reads. Only run Kopai while you need it, and avoid untrusted sites while it is
running.

None of this is network access control: a client on your network can send any
`Host` it likes. If you bind `HOST=0.0.0.0` (the Docker image does), the whole
API, including `/mcp`, is reachable from your network.

## Sending Telemetry

Your application needs an [OpenTelemetry SDK](https://opentelemetry.io/docs/languages/) for your language.

Configure it to export OTLP/HTTP data to `http://localhost:4318`:

```bash
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

[@kopai/cli](https://github.com/kopai-app/kopai-mono/tree/main/packages/cli) provides a simpler interface for querying data. It's also better suited for LLM agents.

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

See [@kopai/cli README](https://github.com/kopai-app/kopai-mono/tree/main/packages/cli) for all available options.
