# Log Filters Reference

## Available Filters

| Filter            | Flag              | Example                           |
| ----------------- | ----------------- | --------------------------------- |
| Service           | `--service`       | `--service payment-api`           |
| Severity          | `--severity-text` | `--severity-text ERROR`           |
| Body search       | `--body`          | `--body "connection refused"`     |
| Trace correlation | `--trace-id`      | `--trace-id abc123`               |
| Log attribute     | `--log-attr`      | `--log-attr "error.type=timeout"` |

## Severity Levels

| Level | Description            |
| ----- | ---------------------- |
| TRACE | Fine-grained debugging |
| DEBUG | Debugging information  |
| INFO  | Informational messages |
| WARN  | Warning conditions     |
| ERROR | Error conditions       |
| FATAL | Critical failures      |

## Key Log Fields

| Field        | Description             |
| ------------ | ----------------------- |
| TraceId      | Correlation with traces |
| SpanId       | Specific span context   |
| SeverityText | Log level               |
| Body         | Log message content     |
| ServiceName  | Source service          |
| Timestamp    | Event time              |

## Output Options

| Flag       | Description            |
| ---------- | ---------------------- |
| `--json`   | JSON output            |
| `--table`  | Table output           |
| `--fields` | Select specific fields |
| `--limit`  | Max results            |
