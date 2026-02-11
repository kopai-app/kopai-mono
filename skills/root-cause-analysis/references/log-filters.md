# Log Filters Reference

## Available Filters

| Filter            | Flag              | Example                           |
| ----------------- | ----------------- | --------------------------------- |
| Service           | `--service`       | `--service payment-api`           |
| Severity text     | `--severity-text` | `--severity-text ERROR`           |
| Severity min      | `--severity-min`  | `--severity-min 17`               |
| Severity max      | `--severity-max`  | `--severity-max 20`               |
| Body search       | `--body`          | `--body "connection refused"`     |
| Trace correlation | `--trace-id`      | `--trace-id abc123`               |
| Log attribute     | `--log-attr`      | `--log-attr "error.type=timeout"` |

## Severity Levels

Prefer `--severity-min` over `--severity-text` for error detection.
`SeverityText` is a free-form string that varies by language (e.g. `ERROR`, `error`, `Error`, or empty).
`SeverityNumber` is standardized per the OTel Log Data Model.

| Level | Number Range | Description            |
| ----- | ------------ | ---------------------- |
| TRACE | 1-4          | Fine-grained debugging |
| DEBUG | 5-8          | Debugging information  |
| INFO  | 9-12         | Informational messages |
| WARN  | 13-16        | Warning conditions     |
| ERROR | 17-20        | Error conditions       |
| FATAL | 21-24        | Critical failures      |

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
