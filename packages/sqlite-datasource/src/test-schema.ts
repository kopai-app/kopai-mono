import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ddlPath = join(__dirname, "sqlite-opentelemetry-ddl.sql");

const db = new DatabaseSync(":memory:", { allowExtension: false });
db.exec("PRAGMA journal_mode = WAL");

// Load and execute DDL
const ddl = readFileSync(ddlPath, "utf-8");
db.exec(ddl);

console.log("DDL executed successfully\n");

// Test data for each table
// Use BigInt for nanosecond timestamps (exceeds Number.MAX_SAFE_INTEGER)
const nowBigInt = BigInt(Date.now()) * 1_000_000n;
const now = Number(nowBigInt); // for JSON serialization in arrays

// 1. otel_logs
db.prepare(`
  INSERT INTO otel_logs (
    Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
    ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
    ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  now, "abc123", "span456", 1, "INFO", 9,
  "my-service", "Log message body", "https://schema.url",
  JSON.stringify({ "service.name": "my-service" }),
  "https://scope.schema.url", "my-scope", "1.0.0",
  JSON.stringify({ "scope.attr": "value" }),
  JSON.stringify({ "log.attr": "value" })
);
console.log("✓ otel_logs insert works");

// 2. otel_traces
db.prepare(`
  INSERT INTO otel_traces (
    Timestamp, TraceId, SpanId, ParentSpanId, TraceState, SpanName, SpanKind,
    ServiceName, ResourceAttributes, ScopeName, ScopeVersion, SpanAttributes,
    Duration, StatusCode, StatusMessage,
    "Events.Timestamp", "Events.Name", "Events.Attributes",
    "Links.TraceId", "Links.SpanId", "Links.TraceState", "Links.Attributes"
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  now, "trace123", "span456", "parentSpan789", "tracestate=value",
  "HTTP GET /api", "SERVER", "my-service",
  JSON.stringify({ "service.name": "my-service" }),
  "my-scope", "1.0.0",
  JSON.stringify({ "http.method": "GET" }),
  1000000, "OK", "",
  JSON.stringify([now]), JSON.stringify(["event1"]),
  JSON.stringify([{ "event.attr": "value" }]),
  JSON.stringify(["linkedTrace"]), JSON.stringify(["linkedSpan"]),
  JSON.stringify([""]), JSON.stringify([{}])
);
console.log("✓ otel_traces insert works");

// 3. otel_traces_trace_id_ts
db.prepare(`
  INSERT INTO otel_traces_trace_id_ts (TraceId, Start, End)
  VALUES (?, ?, ?)
`).run("trace123", now, now + 1000000);
console.log("✓ otel_traces_trace_id_ts insert works");

// 4. otel_metrics_gauge
db.prepare(`
  INSERT INTO otel_metrics_gauge (
    ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion,
    ScopeAttributes, ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName,
    MetricName, MetricDescription, MetricUnit, Attributes,
    StartTimeUnix, TimeUnix, Value, Flags,
    "Exemplars.FilteredAttributes", "Exemplars.TimeUnix", "Exemplars.Value",
    "Exemplars.SpanId", "Exemplars.TraceId"
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  JSON.stringify({ "service.name": "my-service" }), "https://schema.url",
  "my-scope", "1.0.0", JSON.stringify({}), 0, "https://scope.schema.url",
  "my-service", "cpu.usage", "CPU usage percentage", "%",
  JSON.stringify({ "host.name": "server1" }),
  now, now, 45.5, 0,
  JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
  JSON.stringify([]), JSON.stringify([])
);
console.log("✓ otel_metrics_gauge insert works");

// 5. otel_metrics_sum
db.prepare(`
  INSERT INTO otel_metrics_sum (
    ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion,
    ScopeAttributes, ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName,
    MetricName, MetricDescription, MetricUnit, Attributes,
    StartTimeUnix, TimeUnix, Value, Flags,
    "Exemplars.FilteredAttributes", "Exemplars.TimeUnix", "Exemplars.Value",
    "Exemplars.SpanId", "Exemplars.TraceId",
    AggTemporality, IsMonotonic
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  JSON.stringify({ "service.name": "my-service" }), "https://schema.url",
  "my-scope", "1.0.0", JSON.stringify({}), 0, "https://scope.schema.url",
  "my-service", "http.requests.total", "Total HTTP requests", "1",
  JSON.stringify({ "http.status_code": "200" }),
  now, now, 1234, 0,
  JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
  JSON.stringify([]), JSON.stringify([]),
  "CUMULATIVE", 1
);
console.log("✓ otel_metrics_sum insert works");

// 6. otel_metrics_histogram
db.prepare(`
  INSERT INTO otel_metrics_histogram (
    ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion,
    ScopeAttributes, ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName,
    MetricName, MetricDescription, MetricUnit, Attributes,
    StartTimeUnix, TimeUnix, Count, Sum, BucketCounts, ExplicitBounds,
    "Exemplars.FilteredAttributes", "Exemplars.TimeUnix", "Exemplars.Value",
    "Exemplars.SpanId", "Exemplars.TraceId",
    Min, Max, AggTemporality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  JSON.stringify({ "service.name": "my-service" }), "https://schema.url",
  "my-scope", "1.0.0", JSON.stringify({}), 0, "https://scope.schema.url",
  "my-service", "http.request.duration", "HTTP request duration", "ms",
  JSON.stringify({ "http.method": "GET" }),
  now, now, 100, 5432.5,
  JSON.stringify([10, 25, 50, 15]), JSON.stringify([10, 50, 100, 500]),
  JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
  JSON.stringify([]), JSON.stringify([]),
  1.5, 450.2, "CUMULATIVE"
);
console.log("✓ otel_metrics_histogram insert works");

// 7. otel_metrics_exponential_histogram
db.prepare(`
  INSERT INTO otel_metrics_exponential_histogram (
    ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion,
    ScopeAttributes, ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName,
    MetricName, MetricDescription, MetricUnit, Attributes,
    StartTimeUnix, TimeUnix, Count, Sum, Scale, ZeroCount,
    PositiveOffset, PositiveBucketCounts, NegativeOffset, NegativeBucketCounts,
    "Exemplars.FilteredAttributes", "Exemplars.TimeUnix", "Exemplars.Value",
    "Exemplars.SpanId", "Exemplars.TraceId",
    Min, Max, ZeroThreshold, AggTemporality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  JSON.stringify({ "service.name": "my-service" }), "https://schema.url",
  "my-scope", "1.0.0", JSON.stringify({}), 0, "https://scope.schema.url",
  "my-service", "http.request.duration.exp", "HTTP request duration (exp)", "ms",
  JSON.stringify({ "http.method": "POST" }),
  now, now, 50, 2500.0, 3, 5,
  0, JSON.stringify([5, 10, 20, 10, 5]), 0, JSON.stringify([]),
  JSON.stringify([]), JSON.stringify([]), JSON.stringify([]),
  JSON.stringify([]), JSON.stringify([]),
  0.5, 200.0, 0.001, "DELTA"
);
console.log("✓ otel_metrics_exponential_histogram insert works");

// 8. otel_metrics_summary
db.prepare(`
  INSERT INTO otel_metrics_summary (
    ResourceAttributes, ResourceSchemaUrl, ScopeName, ScopeVersion,
    ScopeAttributes, ScopeDroppedAttrCount, ScopeSchemaUrl, ServiceName,
    MetricName, MetricDescription, MetricUnit, Attributes,
    StartTimeUnix, TimeUnix, Count, Sum,
    "ValueAtQuantiles.Quantile", "ValueAtQuantiles.Value"
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  JSON.stringify({ "service.name": "my-service" }), "https://schema.url",
  "my-scope", "1.0.0", JSON.stringify({}), 0, "https://scope.schema.url",
  "my-service", "http.request.duration.summary", "HTTP request duration summary", "ms",
  JSON.stringify({ "http.method": "GET" }),
  now, now, 1000, 50000.0,
  JSON.stringify([0.5, 0.9, 0.99]), JSON.stringify([25.0, 80.0, 150.0])
);
console.log("✓ otel_metrics_summary insert works");

// Verify data by reading back all columns
console.log("\n--- Verification ---");

function verifyTable(name: string, expected: Record<string, unknown>) {
  // Use readBigInts to handle large INTEGER values
  const stmt = db.prepare(`SELECT * FROM ${name}`);
  stmt.setReadBigInts(true);
  const row = stmt.get() as Record<string, unknown>;
  const errors: string[] = [];

  for (const [key, expectedValue] of Object.entries(expected)) {
    let actualValue = row[key];
    // Convert BigInt to number/string for comparison
    if (typeof actualValue === "bigint") {
      actualValue = Number(actualValue);
    }
    const expectedStr = JSON.stringify(expectedValue);
    const actualStr = JSON.stringify(actualValue);

    if (expectedStr !== actualStr) {
      errors.push(`  ${key}: expected ${expectedStr}, got ${actualStr}`);
    }
  }

  if (errors.length > 0) {
    console.log(`✗ ${name} - FAILED:`);
    errors.forEach(e => console.log(e));
    return false;
  }

  console.log(`✓ ${name} - all ${Object.keys(expected).length} columns verified`);
  return true;
}

let allPassed = true;

allPassed = verifyTable("otel_logs", {
  Timestamp: now,
  TimestampTime: Math.floor(now / 1_000_000_000),
  TraceId: "abc123",
  SpanId: "span456",
  TraceFlags: 1,
  SeverityText: "INFO",
  SeverityNumber: 9,
  ServiceName: "my-service",
  Body: "Log message body",
  ResourceSchemaUrl: "https://schema.url",
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ScopeSchemaUrl: "https://scope.schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({ "scope.attr": "value" }),
  LogAttributes: JSON.stringify({ "log.attr": "value" }),
}) && allPassed;

allPassed = verifyTable("otel_traces", {
  Timestamp: now,
  TraceId: "trace123",
  SpanId: "span456",
  ParentSpanId: "parentSpan789",
  TraceState: "tracestate=value",
  SpanName: "HTTP GET /api",
  SpanKind: "SERVER",
  ServiceName: "my-service",
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  SpanAttributes: JSON.stringify({ "http.method": "GET" }),
  Duration: 1000000,
  StatusCode: "OK",
  StatusMessage: "",
  "Events.Timestamp": JSON.stringify([now]),
  "Events.Name": JSON.stringify(["event1"]),
  "Events.Attributes": JSON.stringify([{ "event.attr": "value" }]),
  "Links.TraceId": JSON.stringify(["linkedTrace"]),
  "Links.SpanId": JSON.stringify(["linkedSpan"]),
  "Links.TraceState": JSON.stringify([""]),
  "Links.Attributes": JSON.stringify([{}]),
}) && allPassed;

allPassed = verifyTable("otel_traces_trace_id_ts", {
  TraceId: "trace123",
  Start: now,
  End: now + 1000000,
}) && allPassed;

allPassed = verifyTable("otel_metrics_gauge", {
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ResourceSchemaUrl: "https://schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({}),
  ScopeDroppedAttrCount: 0,
  ScopeSchemaUrl: "https://scope.schema.url",
  ServiceName: "my-service",
  MetricName: "cpu.usage",
  MetricDescription: "CPU usage percentage",
  MetricUnit: "%",
  Attributes: JSON.stringify({ "host.name": "server1" }),
  StartTimeUnix: now,
  TimeUnix: now,
  Value: 45.5,
  Flags: 0,
  "Exemplars.FilteredAttributes": JSON.stringify([]),
  "Exemplars.TimeUnix": JSON.stringify([]),
  "Exemplars.Value": JSON.stringify([]),
  "Exemplars.SpanId": JSON.stringify([]),
  "Exemplars.TraceId": JSON.stringify([]),
}) && allPassed;

allPassed = verifyTable("otel_metrics_sum", {
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ResourceSchemaUrl: "https://schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({}),
  ScopeDroppedAttrCount: 0,
  ScopeSchemaUrl: "https://scope.schema.url",
  ServiceName: "my-service",
  MetricName: "http.requests.total",
  MetricDescription: "Total HTTP requests",
  MetricUnit: "1",
  Attributes: JSON.stringify({ "http.status_code": "200" }),
  StartTimeUnix: now,
  TimeUnix: now,
  Value: 1234,
  Flags: 0,
  "Exemplars.FilteredAttributes": JSON.stringify([]),
  "Exemplars.TimeUnix": JSON.stringify([]),
  "Exemplars.Value": JSON.stringify([]),
  "Exemplars.SpanId": JSON.stringify([]),
  "Exemplars.TraceId": JSON.stringify([]),
  AggTemporality: "CUMULATIVE",
  IsMonotonic: 1,
}) && allPassed;

allPassed = verifyTable("otel_metrics_histogram", {
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ResourceSchemaUrl: "https://schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({}),
  ScopeDroppedAttrCount: 0,
  ScopeSchemaUrl: "https://scope.schema.url",
  ServiceName: "my-service",
  MetricName: "http.request.duration",
  MetricDescription: "HTTP request duration",
  MetricUnit: "ms",
  Attributes: JSON.stringify({ "http.method": "GET" }),
  StartTimeUnix: now,
  TimeUnix: now,
  Count: 100,
  Sum: 5432.5,
  BucketCounts: JSON.stringify([10, 25, 50, 15]),
  ExplicitBounds: JSON.stringify([10, 50, 100, 500]),
  "Exemplars.FilteredAttributes": JSON.stringify([]),
  "Exemplars.TimeUnix": JSON.stringify([]),
  "Exemplars.Value": JSON.stringify([]),
  "Exemplars.SpanId": JSON.stringify([]),
  "Exemplars.TraceId": JSON.stringify([]),
  Min: 1.5,
  Max: 450.2,
  AggTemporality: "CUMULATIVE",
}) && allPassed;

allPassed = verifyTable("otel_metrics_exponential_histogram", {
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ResourceSchemaUrl: "https://schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({}),
  ScopeDroppedAttrCount: 0,
  ScopeSchemaUrl: "https://scope.schema.url",
  ServiceName: "my-service",
  MetricName: "http.request.duration.exp",
  MetricDescription: "HTTP request duration (exp)",
  MetricUnit: "ms",
  Attributes: JSON.stringify({ "http.method": "POST" }),
  StartTimeUnix: now,
  TimeUnix: now,
  Count: 50,
  Sum: 2500.0,
  Scale: 3,
  ZeroCount: 5,
  PositiveOffset: 0,
  PositiveBucketCounts: JSON.stringify([5, 10, 20, 10, 5]),
  NegativeOffset: 0,
  NegativeBucketCounts: JSON.stringify([]),
  "Exemplars.FilteredAttributes": JSON.stringify([]),
  "Exemplars.TimeUnix": JSON.stringify([]),
  "Exemplars.Value": JSON.stringify([]),
  "Exemplars.SpanId": JSON.stringify([]),
  "Exemplars.TraceId": JSON.stringify([]),
  Min: 0.5,
  Max: 200.0,
  ZeroThreshold: 0.001,
  AggTemporality: "DELTA",
}) && allPassed;

allPassed = verifyTable("otel_metrics_summary", {
  ResourceAttributes: JSON.stringify({ "service.name": "my-service" }),
  ResourceSchemaUrl: "https://schema.url",
  ScopeName: "my-scope",
  ScopeVersion: "1.0.0",
  ScopeAttributes: JSON.stringify({}),
  ScopeDroppedAttrCount: 0,
  ScopeSchemaUrl: "https://scope.schema.url",
  ServiceName: "my-service",
  MetricName: "http.request.duration.summary",
  MetricDescription: "HTTP request duration summary",
  MetricUnit: "ms",
  Attributes: JSON.stringify({ "http.method": "GET" }),
  StartTimeUnix: now,
  TimeUnix: now,
  Count: 1000,
  Sum: 50000.0,
  "ValueAtQuantiles.Quantile": JSON.stringify([0.5, 0.9, 0.99]),
  "ValueAtQuantiles.Value": JSON.stringify([25.0, 80.0, 150.0]),
}) && allPassed;

if (allPassed) {
  console.log("\n✓ All tests passed!");
} else {
  console.log("\n✗ Some tests failed!");
  process.exit(1);
}
