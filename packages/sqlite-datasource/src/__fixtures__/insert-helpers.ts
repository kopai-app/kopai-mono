import { otlp, type datasource } from "@kopai/core";

export function createInsertSpan(
  ds: Pick<datasource.WriteTracesDatasource, "writeTraces">
) {
  return async (opts: {
    traceId: string;
    spanId: string;
    serviceName?: string;
    spanName?: string;
    spanKind?: otlp.SpanKind;
    statusCode?: otlp.StatusCode;
    scopeName?: string;
    startTimeNanos: string;
    endTimeNanos: string;
    parentSpanId?: string;
    spanAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    events?: { name: string; timeUnixNano: string }[];
    links?: { traceId: string; spanId: string; traceState?: string }[];
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [
            {
              key: "service.name",
              value: { stringValue: opts.serviceName },
            },
          ]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const spanAttrs = Object.entries(opts.spanAttributes ?? {}).map(
      ([key, value]) => ({
        key,
        value: { stringValue: value },
      })
    );

    await ds.writeTraces({
      resourceSpans: [
        {
          resource: { attributes: resourceAttrs },
          scopeSpans: [
            {
              scope: { name: opts.scopeName ?? "test-scope" },
              spans: [
                {
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  parentSpanId: opts.parentSpanId,
                  name: opts.spanName ?? "test-span",
                  kind: opts.spanKind,
                  startTimeUnixNano: opts.startTimeNanos,
                  endTimeUnixNano: opts.endTimeNanos,
                  status: opts.statusCode
                    ? { code: opts.statusCode }
                    : undefined,
                  attributes: spanAttrs,
                  events: opts.events,
                  links: opts.links,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertGauge(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    value: number;
    serviceName?: string;
    scopeName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
    exemplars?: Array<{
      timeUnixNano: string;
      value: number;
      spanId?: string;
      traceId?: string;
    }>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const exemplars = opts.exemplars?.map((e) => ({
      timeUnixNano: e.timeUnixNano,
      asDouble: e.value,
      spanId: e.spanId,
      traceId: e.traceId,
    }));

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                        exemplars,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertSum(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    value: number;
    serviceName?: string;
    scopeName?: string;
    isMonotonic?: boolean;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        asDouble: opts.value,
                        attributes: metricAttrs,
                      },
                    ],
                    isMonotonic: opts.isMonotonic,
                    aggregationTemporality: aggTemp,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertHistogram(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    bucketCounts: number[];
    explicitBounds: number[];
    serviceName?: string;
    scopeName?: string;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  histogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        bucketCounts: opts.bucketCounts,
                        explicitBounds: opts.explicitBounds,
                        attributes: metricAttrs,
                      },
                    ],
                    aggregationTemporality: aggTemp,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertExpHistogram(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    scale: number;
    zeroCount: number;
    positiveBucketCounts?: number[];
    positiveOffset?: number;
    negativeBucketCounts?: number[];
    negativeOffset?: number;
    serviceName?: string;
    scopeName?: string;
    aggregationTemporality?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    let aggTemp: number | undefined;
    if (opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_DELTA") {
      aggTemp = 1;
    } else if (
      opts.aggregationTemporality === "AGGREGATION_TEMPORALITY_CUMULATIVE"
    ) {
      aggTemp = 2;
    }

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  exponentialHistogram: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        scale: opts.scale,
                        zeroCount: opts.zeroCount,
                        positive: {
                          offset: opts.positiveOffset ?? 0,
                          bucketCounts: opts.positiveBucketCounts,
                        },
                        negative: {
                          offset: opts.negativeOffset ?? 0,
                          bucketCounts: opts.negativeBucketCounts,
                        },
                        attributes: metricAttrs,
                      },
                    ],
                    aggregationTemporality: aggTemp,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertSummary(
  ds: Pick<datasource.WriteMetricsDatasource, "writeMetrics">
) {
  return async (opts: {
    metricName: string;
    timeUnixNano: string;
    startTimeUnixNano?: string;
    count: number;
    sum: number;
    quantiles: number[];
    quantileValues: number[];
    serviceName?: string;
    scopeName?: string;
    attributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const metricAttrs = Object.entries(opts.attributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const quantileValues = opts.quantiles.map((q, i) => ({
      quantile: q,
      value: opts.quantileValues[i],
    }));

    await ds.writeMetrics({
      resourceMetrics: [
        {
          resource: { attributes: resourceAttrs },
          scopeMetrics: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              metrics: [
                {
                  name: opts.metricName,
                  summary: {
                    dataPoints: [
                      {
                        timeUnixNano: opts.timeUnixNano,
                        startTimeUnixNano:
                          opts.startTimeUnixNano ?? opts.timeUnixNano,
                        count: opts.count,
                        sum: opts.sum,
                        quantileValues,
                        attributes: metricAttrs,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  };
}

export function createInsertLog(
  ds: Pick<datasource.WriteLogsDatasource, "writeLogs">
) {
  return async (opts: {
    timeNanos: string;
    traceId?: string;
    spanId?: string;
    serviceName?: string;
    scopeName?: string;
    severityText?: string;
    severityNumber?: number;
    body?: string;
    bodyValue?: otlp.AnyValue;
    logAttributes?: Record<string, string>;
    resourceAttributes?: Record<string, string>;
    scopeAttributes?: Record<string, string>;
  }) => {
    const resourceAttrs = [
      ...(opts.serviceName
        ? [{ key: "service.name", value: { stringValue: opts.serviceName } }]
        : []),
      ...Object.entries(opts.resourceAttributes ?? {}).map(([key, value]) => ({
        key,
        value: { stringValue: value },
      })),
    ];

    const logAttrs = Object.entries(opts.logAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    const scopeAttrs = Object.entries(opts.scopeAttributes ?? {}).map(
      ([key, value]) => ({ key, value: { stringValue: value } })
    );

    await ds.writeLogs({
      resourceLogs: [
        {
          resource: { attributes: resourceAttrs },
          scopeLogs: [
            {
              scope: {
                name: opts.scopeName ?? "test-scope",
                attributes: scopeAttrs,
              },
              logRecords: [
                {
                  timeUnixNano: opts.timeNanos,
                  traceId: opts.traceId,
                  spanId: opts.spanId,
                  severityText: opts.severityText,
                  severityNumber: opts.severityNumber,
                  body:
                    opts.bodyValue ??
                    (opts.body ? { stringValue: opts.body } : undefined),
                  attributes: logAttrs,
                },
              ],
            },
          ],
        },
      ],
    });
  };
}
