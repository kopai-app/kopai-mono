# ClickHouse Observability Backend

Runs the full OTEL → ClickHouse → API pipeline locally via Docker Compose.

## Architecture

### Data Ingestion

```mermaid
flowchart LR
    A["OTEL SDK / curl"] -->|OTLP HTTP| B["OTEL Collector<br/>:4318"]
    B -->|ClickHouse<br/>exporter| C[("ClickHouse<br/>:8123 / :9000")]

    style A fill:#e8f5e9,stroke:#388e3c
    style B fill:#fff3e0,stroke:#f57c00
    style C fill:#e3f2fd,stroke:#1976d2
```

### Data Query

```mermaid
flowchart LR
    D["@kopai/cli<br/>or curl"] -->|REST API| E["API Server :8000<br/>Fastify + @kopai/api<br/>+ ClickHouseReadDatasource"]
    E -->|HTTP queries| F[("ClickHouse<br/>:8123")]

    style D fill:#f3e5f5,stroke:#7b1fa2
    style E fill:#fce4ec,stroke:#c62828
    style F fill:#e3f2fd,stroke:#1976d2
```

### Docker Compose Services

```mermaid
graph TB
    subgraph compose["docker compose"]
        CH[("clickhouse<br/>25.6-alpine")]
        OC["otel-collector<br/>0.136.0"]
        API["api<br/>Node 24 + Fastify"]
    end

    OC -->|depends_on<br/>healthy| CH
    API -->|depends_on<br/>healthy| CH

    EXT_OTEL["OTLP clients :4318"] -.-> OC
    EXT_API["API clients :8000"] -.-> API

    style CH fill:#e3f2fd,stroke:#1976d2
    style OC fill:#fff3e0,stroke:#f57c00
    style API fill:#fce4ec,stroke:#c62828
    style EXT_OTEL fill:#f5f5f5,stroke:#9e9e9e
    style EXT_API fill:#f5f5f5,stroke:#9e9e9e
```

## Start

```bash
cd packages/clickhouse-datasource/examples/clickhouse-observability-backend
docker compose up --build
```

Wait for all 3 services to be healthy.

## Send test data

### Traces

```bash
NOW=$(date +%s) && curl -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' \
  -d "{
    \"resourceSpans\": [{
      \"resource\": {
        \"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"demo-service\"}}]
      },
      \"scopeSpans\": [{
        \"scope\": {\"name\": \"demo-scope\"},
        \"spans\": [{
          \"traceId\": \"0af7651916cd43dd8448eb211c80319c\",
          \"spanId\": \"b7ad6b7169203331\",
          \"name\": \"GET /api/demo\",
          \"kind\": 2,
          \"startTimeUnixNano\": \"${NOW}000000000\",
          \"endTimeUnixNano\": \"${NOW}005000000\",
          \"status\": {\"code\": 1}
        }]
      }]
    }]
  }"
```

### Logs

```bash
NOW=$(date +%s) && curl -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d "{
    \"resourceLogs\": [{
      \"resource\": {
        \"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"demo-service\"}}]
      },
      \"scopeLogs\": [{
        \"scope\": {\"name\": \"demo-scope\"},
        \"logRecords\": [{
          \"timeUnixNano\": \"${NOW}000000000\",
          \"severityNumber\": 9,
          \"severityText\": \"INFO\",
          \"body\": {\"stringValue\": \"Hello from docker compose e2e\"}
        }]
      }]
    }]
  }"
```

### Metrics (Gauge)

```bash
NOW=$(date +%s) && curl -X POST http://localhost:4318/v1/metrics \
  -H 'Content-Type: application/json' \
  -d "{
    \"resourceMetrics\": [{
      \"resource\": {
        \"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"demo-service\"}}]
      },
      \"scopeMetrics\": [{
        \"scope\": {\"name\": \"demo-scope\"},
        \"metrics\": [{
          \"name\": \"demo.gauge\",
          \"gauge\": {
            \"dataPoints\": [{\"timeUnixNano\": \"${NOW}000000000\", \"asDouble\": 42.0}]
          }
        }]
      }]
    }]
  }"
```

## Query data

### Via @kopai/cli

```bash
kopai traces search --url http://localhost:8000/signals
kopai logs search --url http://localhost:8000/signals
kopai metrics search --url http://localhost:8000/signals --type Gauge
kopai metrics discover --url http://localhost:8000/signals
```

### Via curl

```bash
# Search traces
curl -X POST http://localhost:8000/signals/traces/search \
  -H 'Content-Type: application/json' \
  -d '{}'

# Search logs
curl -X POST http://localhost:8000/signals/logs/search \
  -H 'Content-Type: application/json' \
  -d '{}'

# Search metrics
curl -X POST http://localhost:8000/signals/metrics/search \
  -H 'Content-Type: application/json' \
  -d '{"metricType": "Gauge"}'

# Discover metrics
curl http://localhost:8000/signals/metrics/discover
```

## Versions

| Component      | Image                                          |
| -------------- | ---------------------------------------------- |
| ClickHouse     | `clickhouse/clickhouse-server:25.6-alpine`     |
| OTEL Collector | `otel/opentelemetry-collector-contrib:0.136.0` |
| Node.js        | `node:24-slim`                                 |
