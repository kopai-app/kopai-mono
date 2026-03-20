import type { datasource } from "@kopai/core";

/** Tracks the last emit time per signal for Delta startTimeUnixNano. */
const lastEmitNs = new Map<string, string>();

function nowNanos(): string {
  return String(BigInt(Date.now()) * 1_000_000n);
}

/**
 * Build an OTLP MetricsData payload with kopai.ingestion.bytes and
 * kopai.ingestion.requests Delta Sum metrics.
 */
export function buildIngestionMetrics(
  signal: string,
  contentLength: number
): datasource.MetricsData {
  const startNs = lastEmitNs.get(signal) ?? nowNanos();
  const endNs = nowNanos();
  lastEmitNs.set(signal, endNs);

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "kopai-collector" } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: "kopai.ingestion" },
            metrics: [
              {
                name: "kopai.ingestion.bytes",
                unit: "By",
                description: "Bytes ingested per OTLP write",
                sum: {
                  dataPoints: [
                    {
                      asDouble: contentLength,
                      timeUnixNano: endNs,
                      startTimeUnixNano: startNs,
                      attributes: [
                        {
                          key: "signal",
                          value: { stringValue: signal },
                        },
                      ],
                    },
                  ],
                  aggregationTemporality: 1, // DELTA
                  isMonotonic: true,
                },
              },
              {
                name: "kopai.ingestion.requests",
                unit: "{requests}",
                description: "Number of OTLP write requests",
                sum: {
                  dataPoints: [
                    {
                      asDouble: 1,
                      timeUnixNano: endNs,
                      startTimeUnixNano: startNs,
                      attributes: [
                        {
                          key: "signal",
                          value: { stringValue: signal },
                        },
                      ],
                    },
                  ],
                  aggregationTemporality: 1, // DELTA
                  isMonotonic: true,
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Emit kopai.ingestion.* metrics after an OTLP write.
 * Best-effort: errors are swallowed to not break the ingest path.
 */
export async function emitIngestionMetrics(
  writeMetricsDatasource: datasource.WriteMetricsDatasource,
  signal: string,
  contentLength: number
): Promise<void> {
  try {
    const metricsData = buildIngestionMetrics(signal, contentLength);
    await writeMetricsDatasource.writeMetrics(metricsData);
  } catch {
    // Best-effort — do not break the ingest path
  }
}
