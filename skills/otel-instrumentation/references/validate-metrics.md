| title            | impact | tags                          |
| ---------------- | ------ | ----------------------------- |
| Validate Metrics | HIGH   | validate, metrics, assertions |

# Validate Metrics

Metrics fail quietly and differently from traces: the exporter runs on an interval, so
a short run can end before the first export and look identical to a broken pipeline.
Assert deliberately.

Run these only if the service emits metrics. See `layered-telemetry.md` for whether it
should — traces answer most questions, and metrics earn their place for cheap alerting
and long-term trends, not as a duplicate of your spans.

## M1 — Metrics arrived at all

```bash
npx @kopai/cli metrics discover --json | jq 'length'
```

**Pass:** greater than zero.
**Fail — and the run was short:** the periodic reader never fired. Set
`OTEL_METRIC_EXPORT_INTERVAL=1000` and re-drive before concluding anything is broken.
**Fail — and the run was long:** the MeterProvider isn't registered, or only the
TracerProvider was set up. See `references/lang-<language>.md`.

## M2 — The expected instruments exist

```bash
npx @kopai/cli metrics discover --json | jq -r '.[].name' | sort
```

**Pass:** every instrument the code creates appears by name. Compare against the
`Counter`/`Histogram`/`Gauge` declarations you can grep for in the source — exhaustively,
not a spot check.
**Fail:** an instrument that is declared but never recorded to won't export in some SDKs.
Confirm the record call is actually reached by the traffic you drove.

## M3 — Values are moving and plausible

```bash
npx @kopai/cli metrics search --type Sum --name <your.counter> --aggregate sum --json
```

**Pass:** counters increase across runs; histogram counts match the requests you drove;
gauges sit in a believable range.
**Fail — a counter stuck at zero:** the increment is on a code path your traffic missed.
Drive that path (`drive-traffic.md`).
**Fail — a counter far larger than the requests you drove:** it is probably being
incremented in a loop or on retries. That is a real instrumentation bug, and it will
make every alert built on it wrong.

## M4 — Dimensions are groupable and bounded

```bash
npx @kopai/cli metrics search --type Sum --name <your.counter> \
  --aggregate sum --group-by <attribute> --json
```

**Pass:** grouping returns a small, stable set of values.
**Fail — a huge number of groups:** a high-cardinality attribute (`user.id`, a request ID,
a raw URL) has been attached to a metric. This is the one place cardinality genuinely
hurts: each combination becomes its own series. High-cardinality context belongs on
**spans**, where it is free. Move it there and keep metric dimensions low-cardinality.

## Metric types

| Type                 | Meaning                 | Reach for it when                                |
| -------------------- | ----------------------- | ------------------------------------------------ |
| Sum                  | Cumulative counter      | Counting occurrences — requests, errors, retries |
| Gauge                | Point-in-time value     | Current state — queue depth, pool size, memory   |
| Histogram            | Distribution of values  | Latency and size, where percentiles matter       |
| ExponentialHistogram | Auto-bucketed histogram | Latency across an unknown or very wide range     |
| Summary              | Precomputed quantiles   | Legacy ingestion only — don't emit new ones      |

Never use a Gauge for something you want to count, or a Sum for something you want
percentiles of. Neither can be fixed at query time.

## Done when

M1–M4 pass. Then `validate-shutdown.md`.

## Reference

[Kopai CLI](../references/cli-reference.md)
