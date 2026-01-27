# Metric Filters Reference

## Available Filters

| Filter          | Flag        | Example                      |
| --------------- | ----------- | ---------------------------- |
| Type (required) | `--type`    | `--type Gauge`               |
| Name            | `--name`    | `--name http_requests_total` |
| Service         | `--service` | `--service payment-api`      |
| Attributes      | `--attr`    | `--attr "endpoint=/api"`     |

## Metric Types

| Type      | Description            | Use Case                         |
| --------- | ---------------------- | -------------------------------- |
| Gauge     | Point-in-time value    | Current memory, CPU, connections |
| Sum       | Cumulative counter     | Request counts, error counts     |
| Histogram | Distribution of values | Latency percentiles              |

## Common Metrics

| Metric                        | Type      | Description         |
| ----------------------------- | --------- | ------------------- |
| http_requests_total           | Sum       | Total HTTP requests |
| http_server_errors_total      | Sum       | HTTP 5xx errors     |
| http_server_duration          | Histogram | Request latency     |
| process_cpu_seconds           | Sum       | CPU usage           |
| process_resident_memory_bytes | Gauge     | Memory usage        |

## Output Options

| Flag       | Description            |
| ---------- | ---------------------- |
| `--json`   | JSON output            |
| `--table`  | Table output           |
| `--fields` | Select specific fields |
| `--limit`  | Max results            |

## Commands

```bash
# Discover all metrics
kopai metrics discover --json

# Search specific metric
kopai metrics search --type TYPE [--name NAME] [--service NAME] --json
```
