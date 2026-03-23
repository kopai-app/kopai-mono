import { describe, it, expect, vi } from "vitest";
import {
  buildIngestionMetrics,
  emitIngestionMetrics,
} from "./ingestion-metrics.js";

describe("buildIngestionMetrics", () => {
  it("creates two Delta Sum metrics with signal attribute", () => {
    const data = buildIngestionMetrics("/v1/traces", 1024);

    const resourceMetrics = data.resourceMetrics;
    expect(resourceMetrics).toHaveLength(1);

    const metrics = resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics;
    expect(metrics).toHaveLength(2);

    const bytesMetric = metrics?.[0];
    expect(bytesMetric?.name).toBe("kopai.ingestion.bytes");
    expect(bytesMetric?.sum?.aggregationTemporality).toBe(1);
    expect(bytesMetric?.sum?.isMonotonic).toBe(true);
    expect(bytesMetric?.sum?.dataPoints?.[0]?.asDouble).toBe(1024);

    const signalAttr = bytesMetric?.sum?.dataPoints?.[0]?.attributes?.[0];
    expect(signalAttr?.key).toBe("signal");

    const requestsMetric = metrics?.[1];
    expect(requestsMetric?.name).toBe("kopai.ingestion.requests");
    expect(requestsMetric?.sum?.dataPoints?.[0]?.asDouble).toBe(1);
  });

  it("uses previous endTime as startTime on subsequent calls (Delta semantics)", () => {
    // Use a unique signal to avoid state leaking from other tests
    const signal = "/v1/delta-test";
    const first = buildIngestionMetrics(signal, 100);
    const firstDp =
      first.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.sum
        ?.dataPoints?.[0];
    const firstEnd = firstDp?.timeUnixNano;
    const firstStart = firstDp?.startTimeUnixNano;

    // First call: start <= end (start is "now" since no prior emit)
    expect(BigInt(firstStart ?? "0")).toBeLessThanOrEqual(
      BigInt(firstEnd ?? "0")
    );

    const second = buildIngestionMetrics(signal, 200);
    const secondDp =
      second.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.sum
        ?.dataPoints?.[0];
    const secondStart = secondDp?.startTimeUnixNano;

    // Second call: startTime === first call's endTime
    expect(secondStart).toBe(firstEnd);
  });
});

describe("emitIngestionMetrics", () => {
  it("calls writeMetrics and swallows errors", async () => {
    const writeMetrics = vi.fn().mockRejectedValue(new Error("fail"));
    await emitIngestionMetrics({ writeMetrics }, "/v1/logs", 512);
    expect(writeMetrics).toHaveBeenCalledOnce();
  });

  it("writes metrics successfully", async () => {
    const writeMetrics = vi.fn().mockResolvedValue({});
    await emitIngestionMetrics({ writeMetrics }, "/v1/metrics", 256);
    expect(writeMetrics).toHaveBeenCalledOnce();
    const payload = writeMetrics.mock.calls[0]?.[0];
    const metricName =
      payload?.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics?.[0]?.name;
    expect(metricName).toBe("kopai.ingestion.bytes");
  });
});
