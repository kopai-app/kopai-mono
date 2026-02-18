import { describe, it, expect } from "vitest";
import {
  parseChRow,
  toNumber,
  toNumberArray,
  chTracesRowSchema,
  chLogsRowSchema,
  chGaugeRowSchema,
  chSumRowSchema,
  chHistogramRowSchema,
  chExpHistogramRowSchema,
  chSummaryRowSchema,
  chDiscoverNameRowSchema,
  chDiscoverAttrRowSchema,
} from "./ch-row-schemas.js";
import { ClickHouseDatasourceParseError } from "./clickhouse-datasource-error.js";

describe("chTracesRowSchema", () => {
  const validRow = {
    TraceId: "abc123",
    SpanId: "span456",
    Timestamp: "2024-01-15 10:30:00.123456789",
    ParentSpanId: "parent789",
    TraceState: "",
    SpanName: "GET /api",
    SpanKind: "SERVER",
    ServiceName: "my-service",
    ResourceAttributes: { "service.name": "my-service" },
    ScopeName: "otel",
    ScopeVersion: "",
    SpanAttributes: { "http.method": "GET" },
    Duration: 1500000,
    StatusCode: "OK",
    StatusMessage: "",
    "Events.Timestamp": ["2024-01-15 10:30:00.100000000"],
    "Events.Name": ["exception"],
    "Events.Attributes": [{ "exception.message": "oops" }],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.TraceState": [],
    "Links.Attributes": [],
  };

  it("parses valid row with transforms", () => {
    const result = parseChRow(chTracesRowSchema, validRow);

    expect(result.TraceId).toBe("abc123");
    expect(result.SpanId).toBe("span456");
    // Timestamp converted from DateTime64 to nanos string
    expect(result.Timestamp).toBe("1705314600123456789");
    expect(result.ParentSpanId).toBe("parent789");
    // Empty strings become undefined
    expect(result.TraceState).toBeUndefined();
    expect(result.ScopeVersion).toBeUndefined();
    expect(result.StatusMessage).toBeUndefined();
    // Attributes coerced
    expect(result.SpanAttributes).toEqual({ "http.method": "GET" });
    // Duration coerced to string
    expect(result.Duration).toBe("1500000");
    // Events timestamps converted
    expect(result["Events.Timestamp"]).toEqual(["1705314600100000000"]);
    // Empty arrays become undefined
    expect(result["Links.TraceId"]).toBeUndefined();
    expect(result["Links.Attributes"]).toBeUndefined();
  });

  it("throws ClickHouseDatasourceParseError on invalid row", () => {
    expect(() => parseChRow(chTracesRowSchema, { TraceId: 123 })).toThrow(
      ClickHouseDatasourceParseError
    );
  });
});

describe("chLogsRowSchema", () => {
  const validRow = {
    Timestamp: "2024-01-15 10:30:00.000000000",
    TraceId: "",
    SpanId: "",
    TraceFlags: "0",
    SeverityText: "ERROR",
    SeverityNumber: "17",
    Body: "something failed",
    LogAttributes: { "log.source": "stderr" },
    ResourceAttributes: { "service.name": "svc" },
    ResourceSchemaUrl: "",
    ServiceName: "svc",
    ScopeName: "my-logger",
    ScopeVersion: "1.0",
    ScopeAttributes: {},
    ScopeSchemaUrl: "",
  };

  it("parses valid row", () => {
    const result = parseChRow(chLogsRowSchema, validRow);

    expect(result.Timestamp).toBe("1705314600000000000");
    expect(result.TraceId).toBeUndefined();
    expect(result.SpanId).toBeUndefined();
    expect(result.TraceFlags).toBe(0);
    expect(result.SeverityText).toBe("ERROR");
    expect(result.SeverityNumber).toBe(17);
    expect(result.Body).toBe("something failed");
    expect(result.ResourceSchemaUrl).toBeUndefined();
  });

  it("throws on missing Timestamp", () => {
    expect(() => parseChRow(chLogsRowSchema, { Body: "x" })).toThrow(
      ClickHouseDatasourceParseError
    );
  });
});

describe("chGaugeRowSchema", () => {
  const validRow = {
    TimeUnix: "2024-01-15 10:30:00.000000000",
    StartTimeUnix: "2024-01-15 10:00:00.000000000",
    Attributes: {},
    MetricName: "cpu_usage",
    MetricDescription: "",
    MetricUnit: "%",
    ResourceAttributes: {},
    ResourceSchemaUrl: "",
    ScopeAttributes: {},
    ScopeDroppedAttrCount: "0",
    ScopeName: "",
    ScopeSchemaUrl: "",
    ScopeVersion: "",
    ServiceName: "svc",
    Value: 42.5,
    Flags: "0",
  };

  it("parses gauge row", () => {
    const result = parseChRow(chGaugeRowSchema, validRow);

    expect(result.TimeUnix).toBe("1705314600000000000");
    expect(result.Value).toBe(42.5);
    expect(result.Flags).toBe(0);
    expect(result.MetricDescription).toBeUndefined();
    expect(result.MetricUnit).toBe("%");
  });
});

describe("chSumRowSchema", () => {
  it("parses sum row with monotonic", () => {
    const row = {
      TimeUnix: "2024-01-15 10:30:00.000000000",
      StartTimeUnix: "2024-01-15 10:00:00.000000000",
      Attributes: {},
      MetricName: "requests_total",
      MetricDescription: "",
      MetricUnit: "",
      ResourceAttributes: {},
      ResourceSchemaUrl: "",
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeName: "",
      ScopeSchemaUrl: "",
      ScopeVersion: "",
      ServiceName: "svc",
      Value: 100,
      Flags: 0,
      AggTemporality: "CUMULATIVE",
      IsMonotonic: "1",
    };
    const result = parseChRow(chSumRowSchema, row);

    expect(result.Value).toBe(100);
    expect(result.AggTemporality).toBe("CUMULATIVE");
    expect(result.IsMonotonic).toBe(1);
  });
});

describe("chHistogramRowSchema", () => {
  it("parses histogram row", () => {
    const row = {
      TimeUnix: "2024-01-15 10:30:00.000000000",
      StartTimeUnix: "2024-01-15 10:00:00.000000000",
      Attributes: {},
      MetricName: "latency",
      MetricDescription: "",
      MetricUnit: "ms",
      ResourceAttributes: {},
      ResourceSchemaUrl: "",
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeName: "",
      ScopeSchemaUrl: "",
      ScopeVersion: "",
      ServiceName: "svc",
      Count: "50",
      Sum: 1234.5,
      Min: 1.0,
      Max: 500.0,
      BucketCounts: ["10", "20", "15", "5"],
      ExplicitBounds: [10, 50, 100, 500],
      AggTemporality: "DELTA",
    };
    const result = parseChRow(chHistogramRowSchema, row);

    expect(result.Count).toBe(50);
    expect(result.Sum).toBe(1234.5);
    expect(result.BucketCounts).toEqual([10, 20, 15, 5]);
    expect(result.ExplicitBounds).toEqual([10, 50, 100, 500]);
  });
});

describe("chExpHistogramRowSchema", () => {
  it("parses exponential histogram row", () => {
    const row = {
      TimeUnix: "2024-01-15 10:30:00.000000000",
      StartTimeUnix: "2024-01-15 10:00:00.000000000",
      Attributes: {},
      MetricName: "latency",
      MetricDescription: "",
      MetricUnit: "ms",
      ResourceAttributes: {},
      ResourceSchemaUrl: "",
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeName: "",
      ScopeSchemaUrl: "",
      ScopeVersion: "",
      ServiceName: "svc",
      Count: "100",
      Sum: 5000,
      Min: null,
      Max: null,
      Scale: "3",
      ZeroCount: "5",
      ZeroThreshold: 0.001,
      PositiveOffset: "1",
      PositiveBucketCounts: ["10", "20", "30"],
      NegativeOffset: "0",
      NegativeBucketCounts: [],
      AggTemporality: "CUMULATIVE",
    };
    const result = parseChRow(chExpHistogramRowSchema, row);

    expect(result.Count).toBe(100);
    expect(result.Scale).toBe(3);
    expect(result.ZeroCount).toBe(5);
    expect(result.PositiveBucketCounts).toEqual([10, 20, 30]);
    expect(result.NegativeBucketCounts).toBeUndefined();
  });
});

describe("chSummaryRowSchema", () => {
  it("parses summary row", () => {
    const row = {
      TimeUnix: "2024-01-15 10:30:00.000000000",
      StartTimeUnix: "2024-01-15 10:00:00.000000000",
      Attributes: {},
      MetricName: "latency_summary",
      MetricDescription: "",
      MetricUnit: "ms",
      ResourceAttributes: {},
      ResourceSchemaUrl: "",
      ScopeAttributes: {},
      ScopeDroppedAttrCount: 0,
      ScopeName: "",
      ScopeSchemaUrl: "",
      ScopeVersion: "",
      ServiceName: "svc",
      Count: "200",
      Sum: 10000,
      "ValueAtQuantiles.Quantile": [0.5, 0.9, 0.99],
      "ValueAtQuantiles.Value": [50, 90, 99],
    };
    const result = parseChRow(chSummaryRowSchema, row);

    expect(result.Count).toBe(200);
    expect(result["ValueAtQuantiles.Quantile"]).toEqual([0.5, 0.9, 0.99]);
  });
});

describe("chDiscoverNameRowSchema", () => {
  it("parses discover name row", () => {
    const row = {
      MetricName: "http_requests",
      MetricType: "Sum",
      MetricDescription: "Total HTTP requests",
      MetricUnit: "1",
    };
    const result = parseChRow(chDiscoverNameRowSchema, row);

    expect(result.MetricName).toBe("http_requests");
    expect(result.MetricType).toBe("Sum");
  });

  it("rejects invalid MetricType", () => {
    const row = {
      MetricName: "http_requests",
      MetricType: "InvalidType",
      MetricDescription: "desc",
      MetricUnit: "1",
    };
    expect(() => parseChRow(chDiscoverNameRowSchema, row)).toThrow(
      ClickHouseDatasourceParseError
    );
  });
});

describe("chDiscoverAttrRowSchema", () => {
  it("parses discover attr row", () => {
    const row = {
      MetricName: "http_requests",
      MetricType: "Sum",
      source: "attr",
      attr_key: "method",
      attr_values: ["GET", "POST"],
    };
    const result = parseChRow(chDiscoverAttrRowSchema, row);

    expect(result.attr_key).toBe("method");
    expect(result.attr_values).toEqual(["GET", "POST"]);
  });
});

describe("toNumber", () => {
  it("parses numeric string", () => {
    expect(toNumber("123")).toBe(123);
  });

  it("returns undefined for empty string", () => {
    expect(toNumber("")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(toNumber(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(toNumber(undefined)).toBeUndefined();
  });

  it("passes through numbers", () => {
    expect(toNumber(42)).toBe(42);
  });

  it("returns undefined for non-numeric string", () => {
    expect(toNumber("abc")).toBeUndefined();
  });
});

describe("toNumberArray", () => {
  it("filters out non-numeric values", () => {
    expect(toNumberArray(["1", "abc", "3"])).toEqual([1, 3]);
  });

  it("returns undefined for empty array", () => {
    expect(toNumberArray([])).toBeUndefined();
  });

  it("converts valid string array", () => {
    expect(toNumberArray(["10", "20"])).toEqual([10, 20]);
  });
});
