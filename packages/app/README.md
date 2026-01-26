# @kopai/app

Local OpenTelemetry backend with an http/json Otel collector, Otel data storage and API to query the data.

## Quick Start

```bash
npx @kopai/app start
```

Starts two servers:

- **API server** on port 8000 (query traces, logs, metrics)
- **OTEL collector** on port 4318 (receives OTLP/HTTP data)

## CLI Usage

```bash
npx @kopai/app <command>
```

### Commands

| Command | Description       |
| ------- | ----------------- |
| `start` | Start the server  |
| `help`  | Show help message |

### Options

| Option       | Description       |
| ------------ | ----------------- |
| `-h, --help` | Show help message |

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

### OTEL Collector (default: localhost:4318)

- `POST /v1/traces` - Receive trace data
- `POST /v1/logs` - Receive log data
- `POST /v1/metrics` - Receive metric data

### API Server (default: localhost:8000)

- `GET /documentation` - Swagger UI
- `GET /signals/traces` - Query traces
- `GET /signals/logs` - Query logs
- `GET /signals/metrics` - Query metrics
