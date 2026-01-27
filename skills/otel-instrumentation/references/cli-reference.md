# Kopai CLI Reference

> **Note:** Use `npx @kopai/cli` or `kopai` (if globally installed)

## Traces

```bash
# Search traces
kopai traces search [--service NAME] [--span-name NAME] [--status-code OK|ERROR] [--json]

# Get specific trace
kopai traces get <traceId> [--json]

# Advanced filters
kopai traces search --span-attr "key=value" --json
kopai traces search --resource-attr "key=value" --json
kopai traces search --duration-min 1000000000 --json  # 1s in ns
```

## Logs

```bash
# Search logs
kopai logs search [--service NAME] [--severity-text ERROR] [--body TEXT] [--json]

# Correlate with trace
kopai logs search --trace-id <traceId> --json

# Filter by attributes
kopai logs search --log-attr "key=value" --json
```

## Metrics

```bash
# Discover metrics
kopai metrics discover [--json]

# Search metrics (type required)
kopai metrics search --type TYPE [--name NAME] [--json]
```

## Output Options

| Flag           | Description              |
| -------------- | ------------------------ |
| --json         | JSON output (pipe to jq) |
| --table        | Table output             |
| --fields F1,F2 | Select fields            |
| --limit N      | Max results              |

## Full Documentation

https://github.com/kopai-app/kopai-mono/tree/main/packages/cli
