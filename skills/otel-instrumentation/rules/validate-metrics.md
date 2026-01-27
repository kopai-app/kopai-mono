| title            | impact | tags              |
| ---------------- | ------ | ----------------- |
| Validate Metrics | HIGH   | validate, metrics |

## Validate Metrics

**Impact:** HIGH

Verify metrics are being collected by Kopai.

### Discover Available Metrics

```bash
npx @kopai/cli metrics discover --json
```

### Search Specific Metric

```bash
npx @kopai/cli metrics search --type Gauge --name http_requests_total --json
```

### Metric Types

| Type                 | Description                    |
| -------------------- | ------------------------------ |
| Gauge                | Point-in-time value            |
| Sum                  | Cumulative counter             |
| Histogram            | Distribution of values         |
| ExponentialHistogram | Exponential bucket histogram   |
| Summary              | Precomputed quantiles (legacy) |

### Reference

[Kopai CLI](https://github.com/kopai-app/kopai-mono/tree/main/packages/cli)
