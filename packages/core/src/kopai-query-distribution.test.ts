/// <reference types="vitest/globals" />
// Distribution and counter ops (KOP-70): wire schema, validator rules V1–V10
// and near-miss hints. Spec: nibbler spec-kopaiquery-distribution-ops,
// sections 2 and 3.
import { parseKopaiQuery } from "./kopai-query-compiler.js";

const td = {
  type: "absolute" as const,
  startTime: "2026-01-01T12:00:00Z",
  endTime: "2026-01-01T12:05:00Z",
};

type Leaf = Record<string, unknown>;

const pinType = (t: string): Leaf => ({
  column: "MetricType",
  op: "eq",
  value: t,
});
const MONOTONIC: Leaf = { column: "IsMonotonic", op: "eq", value: true };

function metricQuery(
  type: string,
  measures: Leaf[],
  extra: Record<string, unknown> = {},
  filters: Leaf[] = type === "Sum" ? [MONOTONIC] : []
) {
  return {
    signal: "metrics",
    mode: "aggregate",
    measures,
    timeDimension: td,
    output: { type: "summary" },
    filters: [pinType(type), ...filters],
    ...extra,
  };
}

function rejection(query: unknown): string {
  const result = parseKopaiQuery(query);
  if (result.ok) throw new Error("expected the query to be rejected");
  return result.issues.map((i) => `${i.path}: ${i.message}`).join("\n");
}

function accepted(query: unknown): void {
  const result = parseKopaiQuery(query);
  if (!result.ok) {
    throw new Error(result.issues.map((i) => i.message).join("\n"));
  }
}

describe("wire schema: the five new measure variants", () => {
  it.each([
    ["Histogram", { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" }],
    ["Histogram", { op: "HISTOGRAM_AVG", as: "avg" }],
    ["Summary", { op: "SUMMARY_QUANTILE", quantile: 0.99, as: "p99" }],
    ["Sum", { op: "INCREASE", column: "Value", as: "inc" }],
    ["Sum", { op: "RATE", column: "Value", as: "rps" }],
    ["Histogram", { op: "RATE", column: "Count", as: "rps" }],
    ["Histogram", { op: "INCREASE", column: "Sum", as: "total" }],
  ])("accepts %s %o", (type, measure) => {
    accepted(metricQuery(type, [measure]));
  });

  it.each([0, 1, -0.5, 1.5])("refuses quantile %d", (quantile) => {
    expect(
      rejection(
        metricQuery("Histogram", [
          { op: "HISTOGRAM_QUANTILE", quantile, as: "p" },
        ])
      )
    ).toMatch(/quantile/);
  });

  it("refuses a column on HISTOGRAM_QUANTILE", () => {
    expect(
      rejection(
        metricQuery("Histogram", [
          {
            op: "HISTOGRAM_QUANTILE",
            quantile: 0.5,
            column: "BucketCounts",
            as: "p",
          },
        ])
      )
    ).toMatch(/column/);
  });

  it("refuses INCREASE without a column", () => {
    expect(
      rejection(metricQuery("Sum", [{ op: "INCREASE", as: "inc" }]))
    ).toMatch(/column/);
  });

  it("keeps the new ops off traces and logs", () => {
    rejection({
      signal: "traces",
      mode: "aggregate",
      measures: [{ op: "RATE", column: "Duration", as: "r" }],
      timeDimension: td,
      output: { type: "summary" },
    });
  });
});

describe("V1: each op needs its MetricType", () => {
  it.each([
    [
      "Gauge",
      { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p" },
      /HISTOGRAM_QUANTILE needs MetricType Histogram; got Gauge/,
    ],
    [
      "Summary",
      { op: "HISTOGRAM_AVG", as: "p" },
      /HISTOGRAM_AVG needs MetricType Histogram; got Summary/,
    ],
    [
      "Histogram",
      { op: "SUMMARY_QUANTILE", quantile: 0.5, as: "p" },
      /SUMMARY_QUANTILE needs MetricType Summary; got Histogram/,
    ],
    [
      "Gauge",
      { op: "RATE", column: "Value", as: "r" },
      /RATE needs MetricType Sum or Histogram; got Gauge/,
    ],
  ])("%s %o", (type, measure, message) => {
    expect(rejection(metricQuery(type, [measure]))).toMatch(message);
  });
});

describe("V2: INCREASE and RATE read the counter column", () => {
  it.each([
    ["Sum", "Count", /On Sum, INCREASE reads Value/],
    ["Histogram", "Value", /On Histogram, INCREASE reads Count or Sum/],
    ["Histogram", "BucketCounts", /On Histogram, INCREASE reads Count or Sum/],
    ["Sum", "http.route", /On Sum, INCREASE reads Value/],
  ])("%s column %s", (type, column, message) => {
    expect(
      rejection(metricQuery(type, [{ op: "INCREASE", column, as: "i" }]))
    ).toMatch(message);
  });
});

describe("V3: counters on Sum need the IsMonotonic pin", () => {
  const rate = [{ op: "RATE", column: "Value", as: "r" }];
  const fix =
    /add \{column:'IsMonotonic', op:'eq', value:true\}; UpDownCounters use AVG\/MAX/;

  it("refuses a Sum counter without the pin", () => {
    expect(rejection(metricQuery("Sum", rate, {}, []))).toMatch(fix);
  });

  it("refuses the pin with value 1", () => {
    expect(
      rejection(
        metricQuery("Sum", rate, {}, [
          { column: "IsMonotonic", op: "eq", value: 1 },
        ])
      )
    ).toMatch(fix);
  });

  it("refuses the pin under an OR", () => {
    expect(
      rejection(
        metricQuery("Sum", rate, {}, [
          { or: [MONOTONIC, { column: "MetricName", op: "eq", value: "x" }] },
        ])
      )
    ).toMatch(fix);
  });

  it("accepts the pin nested in an AND", () => {
    accepted(
      metricQuery("Sum", rate, {}, [
        { and: [MONOTONIC, { column: "MetricName", op: "eq", value: "x" }] },
      ])
    );
  });

  it("needs no pin on Histogram", () => {
    accepted(
      metricQuery("Histogram", [{ op: "RATE", column: "Count", as: "r" }])
    );
  });
});

describe("V4: numeric measures need a numeric structural column", () => {
  it("names HISTOGRAM_QUANTILE for P95 on BucketCounts", () => {
    expect(
      rejection(
        metricQuery("Histogram", [
          { op: "P95", column: "BucketCounts", as: "p" },
        ])
      )
    ).toMatch(/P95 on BucketCounts: use HISTOGRAM_QUANTILE/);
  });

  it("names SUMMARY_QUANTILE for MAX on ValueAtQuantiles.Value", () => {
    expect(
      rejection(
        metricQuery("Summary", [
          { op: "MAX", column: "ValueAtQuantiles.Value", as: "p" },
        ])
      )
    ).toMatch(/use SUMMARY_QUANTILE/);
  });

  it("turns SUM(SpanName) on traces into a 400", () => {
    expect(
      rejection({
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "SUM", column: "SpanName", as: "s" }],
        timeDimension: td,
        output: { type: "summary" },
      })
    ).toMatch(/SUM on SpanName/);
  });

  it("exempts attribute refs and COUNT_DISTINCT", () => {
    accepted(
      metricQuery("Gauge", [
        { op: "AVG", column: { container: "Attributes", key: "x" }, as: "a" },
        { op: "COUNT_DISTINCT", column: "MetricName", as: "n" },
      ])
    );
  });
});

describe("V5: meaningless percentile/average on Histogram and Summary Sum/Count", () => {
  it.each([
    ["Histogram", "P95", "Sum", /use HISTOGRAM_QUANTILE \/ HISTOGRAM_AVG/],
    ["Histogram", "AVG", "Count", /use HISTOGRAM_QUANTILE \/ HISTOGRAM_AVG/],
    [
      "Histogram",
      "RATE_AVG",
      "Sum",
      /open an issue for per-interval load stats/,
    ],
    ["Summary", "P99", "Sum", /use SUMMARY_QUANTILE/],
    ["ExponentialHistogram", "AVG", "Count", /not supported yet|HISTOGRAM/],
  ])("%s %s(%s)", (type, op, column, message) => {
    expect(rejection(metricQuery(type, [{ op, column, as: "x" }]))).toMatch(
      message
    );
  });

  it.each(["SUM", "MIN", "MAX", "RATE_SUM", "RATE_MAX"])(
    "keeps %s(Count) on Histogram",
    (op) => {
      accepted(metricQuery("Histogram", [{ op, column: "Count", as: "x" }]));
    }
  );
});

describe("V6: time columns are not dimensions next to a new op", () => {
  it.each(["TimeUnix", "StartTimeUnix"])("%s", (dim) => {
    expect(
      rejection(
        metricQuery("Histogram", [{ op: "HISTOGRAM_AVG", as: "a" }], {
          dimensions: [dim],
        })
      )
    ).toMatch(/group by time with output timeSeries/);
  });

  it("still allows them without a new op", () => {
    accepted(
      metricQuery("Histogram", [{ op: "COUNT", as: "n" }], {
        dimensions: ["TimeUnix"],
      })
    );
  });
});

describe("V7: filters next to a new op must be series-level", () => {
  const avg = [{ op: "HISTOGRAM_AVG", as: "a" }];

  it.each([
    { column: "Count", op: "gt", value: 0 },
    { column: "Flags", op: "eq", value: 0 },
    { column: "AggregationTemporality", op: "eq", value: 2 },
    { column: "MetricDescription", op: "eq", value: "x" },
    { column: "StartTimeUnix", op: "gt", value: 0 },
  ])("refuses %o", (leaf) => {
    expect(rejection(metricQuery("Histogram", avg, {}, [leaf]))).toMatch(
      /filter by series attributes instead/
    );
  });

  it("accepts series-key columns and attribute refs", () => {
    accepted(
      metricQuery("Histogram", avg, {}, [
        { column: "MetricName", op: "eq", value: "http.server.duration" },
        { column: "MetricUnit", op: "eq", value: "ms" },
        { column: "service.name", op: "eq", value: "api" },
        {
          column: { container: "Attributes", key: "route" },
          op: "eq",
          value: "/",
        },
      ])
    );
  });

  it("does not apply without a new op", () => {
    accepted(
      metricQuery("Histogram", [{ op: "COUNT", as: "n" }], {}, [
        { column: "Count", op: "gt", value: 0 },
      ])
    );
  });
});

describe("V8: result keys are distinct", () => {
  const p95 = { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" };

  it("refuses an alias that collides with a range key", () => {
    expect(
      rejection(metricQuery("Histogram", [p95, { op: "COUNT", as: "p95_low" }]))
    ).toMatch(/alias p95_low collides with p95's range key/);
  });

  it("refuses an alias that collides with a dimension key", () => {
    expect(
      rejection(
        metricQuery("Histogram", [{ ...p95, as: "MetricName" }], {
          dimensions: ["MetricName"],
        })
      )
    ).toMatch(/MetricName/);
  });

  it("refuses bucket_start as an alias", () => {
    expect(
      rejection(metricQuery("Histogram", [{ ...p95, as: "bucket_start" }]))
    ).toMatch(/bucket_start/);
  });
});

describe("V9: havings and orderBy name aliases, not generated keys", () => {
  const p95 = { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" };

  it("refuses a having on p95_error", () => {
    expect(
      rejection(
        metricQuery("Histogram", [p95], {
          havings: [{ measure: "p95_error", op: "eq", value: 0 }],
        })
      )
    ).toMatch(/p95_error/);
  });

  it("refuses ordering by p95_low", () => {
    expect(
      rejection(
        metricQuery("Histogram", [p95], {
          orderBy: [{ type: "measure", alias: "p95_low", direction: "asc" }],
        })
      )
    ).toMatch(/p95_low/);
  });
});

describe("V10: ExponentialHistogram", () => {
  it.each([
    { op: "HISTOGRAM_QUANTILE", quantile: 0.5, as: "p" },
    { op: "RATE", column: "Count", as: "r" },
  ])("refuses %o", (measure) => {
    expect(rejection(metricQuery("ExponentialHistogram", [measure]))).toMatch(
      /not supported yet/
    );
  });
});

describe("near-miss hints for the new op names", () => {
  it.each([
    [
      "HISTOGRAM_P95",
      'Did you mean {op: "HISTOGRAM_QUANTILE", quantile: 0.95}?',
    ],
    [
      "histogram_p999",
      'Did you mean {op: "HISTOGRAM_QUANTILE", quantile: 0.999}?',
    ],
    ["SUMMARY_P50", 'Did you mean {op: "SUMMARY_QUANTILE", quantile: 0.5}?'],
    ["HISTOGRAM_MEAN", 'Did you mean "HISTOGRAM_AVG"?'],
    ["histogram_quantile", 'Did you mean "HISTOGRAM_QUANTILE"?'],
  ])("%s", (op, message) => {
    const issues = rejection(
      metricQuery("Histogram", [{ op, column: "BucketCounts", as: "p" }])
    );
    expect(issues).toContain(message);
  });
});
