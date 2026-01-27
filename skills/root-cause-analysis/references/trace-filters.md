# Trace Filters Reference

## Available Filters

| Filter             | Flag              | Example                                |
| ------------------ | ----------------- | -------------------------------------- |
| Service            | `--service`       | `--service payment-api`                |
| Span name          | `--span-name`     | `--span-name "POST /checkout"`         |
| Status             | `--status-code`   | `--status-code ERROR`                  |
| Span kind          | `--span-kind`     | `--span-kind CLIENT`                   |
| Min duration       | `--duration-min`  | `--duration-min 1000000000`            |
| Span attribute     | `--span-attr`     | `--span-attr "user.id=123"`            |
| Resource attribute | `--resource-attr` | `--resource-attr "k8s.pod.name=web-1"` |
| Trace ID           | `--trace-id`      | `--trace-id abc123`                    |
| Min timestamp      | `--timestamp-min` | `--timestamp-min 1700000000000000000`  |

## Status Codes

| Value | Description          |
| ----- | -------------------- |
| OK    | Successful operation |
| ERROR | Failed operation     |
| UNSET | Status not set       |

## Span Kinds

| Value    | Description                      |
| -------- | -------------------------------- |
| SERVER   | Server-side span                 |
| CLIENT   | Client-side span (outgoing call) |
| INTERNAL | Internal operation               |
| PRODUCER | Message producer                 |
| CONSUMER | Message consumer                 |

## Output Options

| Flag       | Description            |
| ---------- | ---------------------- |
| `--json`   | JSON output            |
| `--table`  | Table output           |
| `--fields` | Select specific fields |
| `--limit`  | Max results            |
