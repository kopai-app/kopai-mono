// TODO: simplify or split in many files
import { z } from "zod";
import {
  metricsBaseSchema,
  otelLogsSchema,
  otelMetricsSchema,
  otelTracesSchema,
} from "./denormalized-signals-zod.js";

// ============================================================
// Primitives
// ============================================================

const DurationString = z
  .string()
  .regex(/^\d+[smhdw]$/, {
    error:
      'Duration must be a positive integer + unit (s,m,h,d,w) — e.g. "30s", "2h", "7d".',
  })
  .describe(
    'Duration string: positive integer + unit suffix. Units: s=seconds, m=minutes, h=hours, d=days, w=weeks. Examples: "30s", "30m", "2h", "7d", "2w".'
  );

const ISODateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, {
    error: 'Must be ISO 8601 UTC datetime — e.g. "2024-01-01T00:00:00.000Z".',
  })
  .describe(
    'ISO 8601 UTC datetime. Example: "2024-01-01T00:00:00.000Z". Millisecond precision is sufficient.'
  );

const Alias = z
  .string()
  .min(1)
  .describe(
    "Alias for the measure in result rows. Must be unique within the query. Use snake_case — e.g. p95_duration, error_count, requests_per_second."
  );

export const Signal = z.enum(["traces", "logs", "metrics"]);
export type Signal = z.infer<typeof Signal>;

// ============================================================
// Per-signal attribute containers
// ============================================================
// OTel attributes are nested key/value maps on each row. To filter or
// group by a value inside a map, use a { container, key } ColumnRef.

const TraceAttrContainer = z
  .enum(["SpanAttributes", "ResourceAttributes"])
  .describe(
    "Attribute map on a trace row. SpanAttributes = span-specific; ResourceAttributes = process/host/service attrs."
  );

const LogAttrContainer = z
  .enum(["LogAttributes", "ResourceAttributes", "ScopeAttributes"])
  .describe(
    "Attribute map on a log row. LogAttributes = record-specific; ResourceAttributes = process/host/service attrs; ScopeAttributes = instrumentation scope."
  );

const MetricAttrContainer = z
  .enum(["Attributes", "ResourceAttributes", "ScopeAttributes"])
  .describe(
    "Attribute map on a metric data point. Attributes = data-point attrs; ResourceAttributes = process/host/service; ScopeAttributes = instrumentation scope."
  );

// ============================================================
// OTel semantic-convention attributes (latest spec, stable + RC)
// ============================================================
// Exposed alongside structural columns so the LLM can reference them
// directly by their canonical dotted name (the form it sees in OTel
// docs, Grafana, Honeycomb, etc.). The query→SQL layer maps each
// dotted name to the right storage location (top-level denormalized
// column where one exists, attribute-map lookup otherwise).
//
// Naming rule: PascalCase = structural OTel schema field (SpanId,
// TraceId, Duration). Dotted = semantic-convention attribute
// (service.name, http.request.method). The two shapes never collide.

const RESOURCE_SEMCONV = [
  // Service
  "service.name",
  "service.namespace",
  "service.version",
  "service.instance.id",
  // Deployment
  "deployment.environment.name",
  // Host
  "host.name",
  "host.id",
  "host.arch",
  "host.type",
  "host.ip",
  // Container
  "container.id",
  "container.name",
  "container.image.name",
  "container.image.tag",
  "container.runtime",
  // Kubernetes
  "k8s.cluster.name",
  "k8s.cluster.uid",
  "k8s.namespace.name",
  "k8s.node.name",
  "k8s.node.uid",
  "k8s.pod.name",
  "k8s.pod.uid",
  "k8s.container.name",
  "k8s.container.restart_count",
  "k8s.deployment.name",
  "k8s.deployment.uid",
  "k8s.statefulset.name",
  "k8s.statefulset.uid",
  "k8s.daemonset.name",
  "k8s.daemonset.uid",
  "k8s.job.name",
  "k8s.job.uid",
  "k8s.cronjob.name",
  "k8s.cronjob.uid",
  "k8s.replicaset.name",
  "k8s.replicaset.uid",
  // Cloud
  "cloud.provider",
  "cloud.region",
  "cloud.availability_zone",
  "cloud.account.id",
  "cloud.platform",
  "cloud.resource_id",
  // Process
  "process.pid",
  "process.executable.name",
  "process.command",
  "process.command_line",
  "process.runtime.name",
  "process.runtime.version",
  "process.runtime.description",
  // Telemetry SDK
  "telemetry.sdk.name",
  "telemetry.sdk.version",
  "telemetry.sdk.language",
  "telemetry.distro.name",
  "telemetry.distro.version",
  // OS
  "os.type",
  "os.name",
  "os.version",
  "os.description",
] as const;

const TRACE_SEMCONV = [
  // HTTP
  "http.request.method",
  "http.request.method_original",
  "http.response.status_code",
  "http.route",
  "http.request.resend_count",
  // URL
  "url.full",
  "url.path",
  "url.scheme",
  "url.query",
  "url.fragment",
  // Server / Client
  "server.address",
  "server.port",
  "client.address",
  "client.port",
  // Network
  "network.protocol.name",
  "network.protocol.version",
  "network.transport",
  "network.type",
  "network.peer.address",
  "network.peer.port",
  "network.local.address",
  "network.local.port",
  // User agent
  "user_agent.original",
  // Database
  "db.system.name",
  "db.namespace",
  "db.collection.name",
  "db.operation.name",
  "db.operation.batch.size",
  "db.query.text",
  "db.query.summary",
  "db.response.status_code",
  "db.stored_procedure.name",
  // RPC
  "rpc.system.name",
  "rpc.service",
  "rpc.method",
  "rpc.method_original",
  "rpc.response.status_code",
  "rpc.grpc.status_code",
  // Messaging
  "messaging.system",
  "messaging.destination.name",
  "messaging.operation.type",
  "messaging.message.id",
  "messaging.message.body.size",
  // GenAI
  "gen_ai.system",
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  // Exception / Error
  "exception.type",
  "exception.message",
  "exception.stacktrace",
  "error.type",
  // Code
  "code.function.name",
  "code.namespace",
  "code.file.path",
  "code.line.number",
  "code.stacktrace",
  // Thread
  "thread.id",
  "thread.name",
  // End user
  "enduser.id",
  "enduser.role",
] as const;

const LOG_SEMCONV = [
  // Log
  "log.level",
  "log.file.name",
  "log.file.path",
  "log.iostream",
  "log.record.uid",
  // Exception / Error (common in error logs)
  "exception.type",
  "exception.message",
  "exception.stacktrace",
  "error.type",
  // Code (where the log was emitted)
  "code.function.name",
  "code.namespace",
  "code.file.path",
  "code.line.number",
  "code.stacktrace",
  // Thread
  "thread.id",
  "thread.name",
  // HTTP (request/access logs)
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.full",
  "url.path",
  "client.address",
  "server.address",
  "user_agent.original",
  // GenAI
  "gen_ai.system",
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  // End user
  "enduser.id",
  "enduser.role",
] as const;

const METRIC_SEMCONV = [
  // HTTP server/client metric attrs
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "server.address",
  "server.port",
  "url.scheme",
  "network.protocol.name",
  "network.protocol.version",
  // Database metric attrs
  "db.system.name",
  "db.namespace",
  "db.collection.name",
  "db.operation.name",
  // RPC metric attrs
  "rpc.system.name",
  "rpc.service",
  "rpc.method",
  // Messaging
  "messaging.system",
  "messaging.destination.name",
  "messaging.operation.type",
  // Error
  "error.type",
] as const;

// ============================================================
// Per-signal top-level column enums
// ============================================================
// Structural OTel schema fields are hand-typed for full literal
// narrowing (LLM JSON Schema + SDK builder autocomplete). The
// _assertStructuralColumnsInSyncWithSchema() check below runs at
// module load and catches drift if denormalized-signals-zod.ts adds
// or removes fields that aren't reflected here.
//
// Excluded (intentionally not in the query API):
//   - Attribute-map containers (use { container, key } instead)
//   - ServiceName (exposed as the dotted "service.name" attribute)
//   - Array-typed structural fields (Events.*, Links.*, Exemplars.*) —
//     filtering on per-row arrays needs different semantics; revisit
//     when adding array support.
//   - ScopeDroppedAttrCount (internal SDK accounting, not queryable)

const TRACE_STRUCTURAL = [
  "SpanId",
  "TraceId",
  "ParentSpanId",
  "Timestamp",
  "Duration",
  "SpanKind",
  "SpanName",
  "StatusCode",
  "StatusMessage",
  "TraceState",
  "ScopeName",
  "ScopeVersion",
] as const;

const LOG_STRUCTURAL = [
  "Timestamp",
  "Body",
  "EventName",
  "SeverityNumber",
  "SeverityText",
  "SpanId",
  "TraceId",
  "TraceFlags",
  "ScopeName",
  "ScopeVersion",
  "ScopeSchemaUrl",
  "ResourceSchemaUrl",
] as const;

const METRIC_STRUCTURAL = [
  "TimeUnix",
  "StartTimeUnix",
  "MetricName",
  "MetricDescription",
  "MetricUnit",
  "MetricType",
  "ScopeName",
  "ScopeVersion",
  "ScopeSchemaUrl",
  "ResourceSchemaUrl",
  "Value",
  "Count",
  "Sum",
  "Min",
  "Max",
  "AggregationTemporality",
  "IsMonotonic",
  "Flags",
  "Scale",
  "ZeroCount",
  "ZeroThreshold",
  "BucketCounts",
  "ExplicitBounds",
  "PositiveBucketCounts",
  "PositiveOffset",
  "NegativeBucketCounts",
  "NegativeOffset",
  "ValueAtQuantiles.Quantile",
  "ValueAtQuantiles.Value",
] as const;

// Excluded from the query API. Anything in the storage schema but not
// in {STRUCTURAL ∪ EXCLUDED} is treated as drift.
const TRACE_EXCLUDED = new Set<string>([
  "SpanAttributes",
  "ResourceAttributes",
  "ServiceName",
  "Events.Attributes",
  "Events.Name",
  "Events.Timestamp",
  "Links.Attributes",
  "Links.SpanId",
  "Links.TraceId",
  "Links.TraceState",
]);

const LOG_EXCLUDED = new Set<string>([
  "LogAttributes",
  "ResourceAttributes",
  "ScopeAttributes",
  "ServiceName",
]);

const METRIC_EXCLUDED = new Set<string>([
  "Attributes",
  "ResourceAttributes",
  "ScopeAttributes",
  "ServiceName",
  "ScopeDroppedAttrCount",
  "Exemplars.FilteredAttributes",
  "Exemplars.SpanId",
  "Exemplars.TimeUnix",
  "Exemplars.TraceId",
  "Exemplars.Value",
]);

/**
 * Module-load drift detector for per-signal STRUCTURAL column lists.
 *
 * Why this exists:
 *   STRUCTURAL lists are hand-typed (literal narrowing for SDK builder
 *   + JSON Schema), but the source of truth for storage shape lives in
 *   denormalized-signals-zod.ts. Without enforcement the two drift —
 *   a column added to the storage schema silently fails to appear in
 *   the query API, or a removed column becomes a dead literal.
 *
 * Contract (per signal):
 *   For every key K in the storage schema:
 *     K ∈ STRUCTURAL  XOR  K ∈ EXCLUDED
 *   For every key K in STRUCTURAL: K must exist in the storage schema.
 *
 * Failure modes & how to resolve:
 *   1. "unaccounted field(s)" — storage schema gained a field. Either
 *      add it to the STRUCTURAL list (expose in query API) or to the
 *      EXCLUDED set (intentionally hide). Forces a deliberate choice
 *      so new storage columns don't accidentally leak through.
 *   2. "stale field(s)" — STRUCTURAL references a name the storage
 *      schema no longer has (renamed or removed). Update STRUCTURAL.
 *   3. Stale EXCLUDED entries are tolerated silently — harmless
 *      cleanup, not a bug.
 *
 * Metric-specific:
 *   otelMetricsSchema is a discriminatedUnion. We union the keys of
 *   every variant before checking, then re-check metricsBaseSchema
 *   separately to guard against the union dropping the shared-base
 *   pattern in a future refactor.
 *
 * Runs once at module load. Throws on drift — fail fast over silent
 * misbehavior since the query API is API-shaped (downstream callers
 * read these enums via JSON Schema).
 */
function _assertStructuralColumnsInSyncWithSchema(): void {
  const cases: Array<{
    name: string;
    schemaKeys: string[];
    structural: readonly string[];
    excluded: Set<string>;
  }> = [
    {
      name: "traces",
      schemaKeys: Object.keys(otelTracesSchema.shape),
      structural: TRACE_STRUCTURAL,
      excluded: TRACE_EXCLUDED,
    },
    {
      name: "logs",
      schemaKeys: Object.keys(otelLogsSchema.shape),
      structural: LOG_STRUCTURAL,
      excluded: LOG_EXCLUDED,
    },
    {
      name: "metrics",
      schemaKeys: [
        ...new Set(
          otelMetricsSchema.options.flatMap((v) => Object.keys(v.shape))
        ),
      ],
      structural: METRIC_STRUCTURAL,
      excluded: METRIC_EXCLUDED,
    },
  ];

  for (const { name, schemaKeys, structural, excluded } of cases) {
    const structuralSet = new Set<string>(structural);

    // Schema has a key not classified as structural or excluded.
    const unaccounted = schemaKeys.filter(
      (k) => !structuralSet.has(k) && !excluded.has(k)
    );
    if (unaccounted.length > 0) {
      throw new Error(
        `kopai-query: ${name} storage schema has unaccounted field(s) ${JSON.stringify(unaccounted)}. ` +
          `Add to STRUCTURAL or EXCLUDED list.`
      );
    }

    // Structural claims a key the schema no longer has.
    const schemaSet = new Set(schemaKeys);
    const stale = structural.filter((k) => !schemaSet.has(k));
    if (stale.length > 0) {
      throw new Error(
        `kopai-query: ${name} STRUCTURAL contains stale field(s) ${JSON.stringify(stale)} not in storage schema.`
      );
    }

    // Excluded claims a key the schema no longer has — relax to warn
    // by keeping silent; stale exclusions are harmless and removing
    // them is a no-op cleanup, not a bug.
  }

  // metricsBaseSchema is the shared base of every metric variant; its
  // keys must all be in METRIC_STRUCTURAL (or excluded) too — separate
  // check because variant-merge above could miss a base-only field if
  // the discriminated-union shape is ever refactored.
  const baseKeys = Object.keys(metricsBaseSchema.shape);
  const structuralSet = new Set<string>(METRIC_STRUCTURAL);
  const missingFromBase = baseKeys.filter(
    (k) => !structuralSet.has(k) && !METRIC_EXCLUDED.has(k)
  );
  if (missingFromBase.length > 0) {
    throw new Error(
      `kopai-query: metricsBaseSchema has unaccounted field(s) ${JSON.stringify(missingFromBase)}.`
    );
  }
}

_assertStructuralColumnsInSyncWithSchema();

const TraceColumn = z
  .enum([...TRACE_STRUCTURAL, ...RESOURCE_SEMCONV, ...TRACE_SEMCONV])
  .describe(
    "Trace column. PascalCase = structural OTel schema field; dotted = OTel semantic-convention attribute. Use the { container, key } form for any non-semantic-convention attribute."
  );

const LogColumn = z
  .enum([...LOG_STRUCTURAL, ...RESOURCE_SEMCONV, ...LOG_SEMCONV])
  .describe(
    "Log column. PascalCase = structural OTel schema field; dotted = OTel semantic-convention attribute. Use the { container, key } form for any non-semantic-convention attribute."
  );

const MetricColumn = z
  .enum([...METRIC_STRUCTURAL, ...RESOURCE_SEMCONV, ...METRIC_SEMCONV])
  .describe(
    "Metric column. PascalCase = structural OTel schema field; dotted = OTel semantic-convention attribute. MetricType-specific structural columns (Sum/Count/Min/Max on Histogram, Value on Gauge/Sum) require an equivalent filter on MetricType. Use the { container, key } form for any non-semantic-convention attribute."
  );

// ============================================================
// Per-signal ColumnRef
// ============================================================
// A reference is either a top-level column (string from the enum) or
// a nested attribute { container, key }. The string-vs-object shape
// itself discriminates — no risk of confusing "service.name" the key
// with a dot-path navigation.

const buildAttrRef = <C extends z.ZodEnum>(container: C) =>
  z
    .object({
      container,
      key: z
        .string()
        .min(1)
        .describe(
          'Attribute key inside the container, as stored in OTel. Example: "http.route", "service.version".'
        ),
    })
    .describe(
      "Reference to a value inside a nested OTel attribute map. Use this for any attribute not exposed as a top-level column."
    );

const TraceColumnRef = z
  .union([TraceColumn, buildAttrRef(TraceAttrContainer)])
  .describe(
    "Trace column reference. Either a top-level column name (string) or a nested attribute reference (object)."
  );

const LogColumnRef = z
  .union([LogColumn, buildAttrRef(LogAttrContainer)])
  .describe(
    "Log column reference. Either a top-level column name (string) or a nested attribute reference (object)."
  );

const MetricColumnRef = z
  .union([MetricColumn, buildAttrRef(MetricAttrContainer)])
  .describe(
    "Metric column reference. Either a top-level column name (string) or a nested attribute reference (object)."
  );

// ============================================================
// Numeric aggregation ops (used in MeasureExpr)
// ============================================================
// TODO: re-introduce HEATMAP once result-shape contract is defined
// (returns an array per group; cannot be used in HAVING/ORDER BY).

const NumericOp = z
  .enum([
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "P50",
    "P75",
    "P90",
    "P95",
    "P99",
    "P999",
    "RATE_AVG",
    "RATE_SUM",
    "RATE_MAX",
  ])
  .describe(
    "Aggregation that requires a numeric column. RATE_* divides the aggregate by the time-bucket width."
  );

// ============================================================
// Per-signal MeasureExpr
// ============================================================
// ERROR_RATE and THROUGHPUT are trace-only semantics:
//   ERROR_RATE = share of spans with StatusCode=ERROR
//   THROUGHPUT = spans per second over the time window
// COUNT is universal. COUNT_DISTINCT works on any column. NumericOp
// requires a numeric column — validated server-side against column
// type metadata since attribute-map values are dynamically typed.

const TraceMeasureExpr = z
  .union([
    z
      .object({ op: z.literal("COUNT"), as: Alias })
      .describe("Row count over the matched span set."),
    z
      .object({ op: z.literal("ERROR_RATE"), as: Alias })
      .describe(
        "Fraction of spans with StatusCode=ERROR. Result is in [0, 1]."
      ),
    z
      .object({ op: z.literal("THROUGHPUT"), as: Alias })
      .describe(
        "Spans per second over the time bucket (or the full window if output=summary)."
      ),
    z
      .object({
        op: z.literal("COUNT_DISTINCT"),
        column: TraceColumnRef,
        as: Alias,
      })
      .describe(
        "Approximate count of distinct non-null values of the column (HyperLogLog-style — backed by ClickHouse `uniq`). Use COUNT with a filter if exact deduplication is required."
      ),
    z
      .object({ op: NumericOp, column: TraceColumnRef, as: Alias })
      .describe(
        "Numeric aggregation. Column must be numeric (e.g. Duration, or a numeric attribute)."
      ),
  ])
  .describe("Aggregation expression for the traces signal.");

const LogMeasureExpr = z
  .union([
    z
      .object({ op: z.literal("COUNT"), as: Alias })
      .describe("Row count over the matched log set."),
    z
      .object({
        op: z.literal("COUNT_DISTINCT"),
        column: LogColumnRef,
        as: Alias,
      })
      .describe(
        "Approximate count of distinct non-null values of the column (HyperLogLog-style — backed by ClickHouse `uniq`). Use COUNT with a filter if exact deduplication is required."
      ),
    z
      .object({ op: NumericOp, column: LogColumnRef, as: Alias })
      .describe(
        "Numeric aggregation. Column must be numeric (e.g. SeverityNumber, or a numeric attribute)."
      ),
  ])
  .describe("Aggregation expression for the logs signal.");

const MetricMeasureExpr = z
  .union([
    z
      .object({ op: z.literal("COUNT"), as: Alias })
      .describe("Row count over the matched metric data-point set."),
    z
      .object({
        op: z.literal("COUNT_DISTINCT"),
        column: MetricColumnRef,
        as: Alias,
      })
      .describe(
        "Approximate count of distinct non-null values of the column (HyperLogLog-style — backed by ClickHouse `uniq`). Use COUNT with a filter if exact deduplication is required."
      ),
    z
      .object({ op: NumericOp, column: MetricColumnRef, as: Alias })
      .describe(
        "Numeric aggregation. For heterogeneous MetricType, filter by MetricType so the chosen column exists for every matched row."
      ),
  ])
  .describe("Aggregation expression for the metrics signal.");

// ============================================================
// FilterExpr (per signal, recursive)
// ============================================================
// Top-level discriminator: `kind`. Variants:
//   string      — eq/neq/contains/notContains/startsWith/endsWith
//   stringIn    — in/notIn against an array of strings
//   number      — eq/neq/gt/gte/lt/lte
//   numberIn    — in/notIn against an array of numbers
//   boolean     — eq/neq
//   null        — isNull/isNotNull (no value)
//   logical     — and/or wrapping nested filters
//
// z.union (not z.discriminatedUnion) is used here because Zod v4 has
// limitations around recursive discriminated unions. The `kind`
// literal still serves as a clear discriminator in the rendered JSON
// Schema for LLM structured-output.

type AnyColumnRef = z.infer<
  typeof TraceColumnRef | typeof LogColumnRef | typeof MetricColumnRef
>;

export type FilterExpr<C = AnyColumnRef> =
  | {
      kind: "string";
      column: C;
      op: "eq" | "neq" | "contains" | "notContains" | "startsWith" | "endsWith";
      value: string;
    }
  | { kind: "stringIn"; column: C; op: "in" | "notIn"; values: string[] }
  | {
      kind: "number";
      column: C;
      op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: number;
    }
  | { kind: "numberIn"; column: C; op: "in" | "notIn"; values: number[] }
  | { kind: "boolean"; column: C; op: "eq" | "neq"; value: boolean }
  | { kind: "null"; column: C; op: "isNull" | "isNotNull" }
  | { kind: "logical"; op: "and" | "or"; filters: FilterExpr<C>[] };

const buildFilterExpr = <C extends z.ZodType>(
  columnRef: C
): z.ZodType<FilterExpr<z.infer<C>>> => {
  const StringFilter = z
    .object({
      kind: z.literal("string"),
      column: columnRef,
      op: z
        .enum([
          "eq",
          "neq",
          "contains",
          "notContains",
          "startsWith",
          "endsWith",
        ])
        .describe(
          "String comparison. contains/startsWith/endsWith are substring matches."
        ),
      value: z.string(),
    })
    .describe("Filter where the column is a string.");

  const StringInFilter = z
    .object({
      kind: z.literal("stringIn"),
      column: columnRef,
      op: z.enum(["in", "notIn"]),
      values: z.array(z.string()).min(1),
    })
    .describe("Filter where a string column is (or is not) in a set.");

  const NumberFilter = z
    .object({
      kind: z.literal("number"),
      column: columnRef,
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
      value: z.number(),
    })
    .describe("Filter where the column is numeric.");

  const NumberInFilter = z
    .object({
      kind: z.literal("numberIn"),
      column: columnRef,
      op: z.enum(["in", "notIn"]),
      values: z.array(z.number()).min(1),
    })
    .describe("Filter where a numeric column is (or is not) in a set.");

  const BoolFilter = z
    .object({
      kind: z.literal("boolean"),
      column: columnRef,
      op: z.enum(["eq", "neq"]),
      value: z.boolean(),
    })
    .describe("Filter where the column is boolean.");

  const NullFilter = z
    .object({
      kind: z.literal("null"),
      column: columnRef,
      op: z.enum(["isNull", "isNotNull"]),
    })
    .describe("Null-presence check. No value field.");

  const Expr: z.ZodType<FilterExpr<z.infer<C>>> = z.lazy(() =>
    z.union([
      StringFilter,
      StringInFilter,
      NumberFilter,
      NumberInFilter,
      BoolFilter,
      NullFilter,
      z
        .object({
          kind: z.literal("logical"),
          op: z
            .enum(["and", "or"])
            .describe(
              "Combination operator. and = all children must match; or = any child matches."
            ),
          filters: z.array(Expr).min(1),
        })
        .describe(
          "Logical combination of nested filters. Use to express boolean trees."
        ),
    ])
  ) as z.ZodType<FilterExpr<z.infer<C>>>;

  return Expr;
};

const TraceFilterExpr = buildFilterExpr(TraceColumnRef);
const LogFilterExpr = buildFilterExpr(LogColumnRef);
const MetricFilterExpr = buildFilterExpr(MetricColumnRef);

// ============================================================
// HavingExpr (aggregate-only)
// ============================================================
// Filter on a measure's aggregated value. References the measure by
// its `as` alias defined in the same query.

export const HavingExpr = z
  .object({
    measure: z
      .string()
      .min(1)
      .describe("Alias of a measure defined in this query's `measures` array."),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: z.number(),
  })
  .describe(
    "Post-aggregation filter. Applied after grouping — equivalent to SQL HAVING. Use only when filtering on a measure's value (e.g. error_count > 100)."
  );

export type HavingExpr = z.infer<typeof HavingExpr>;

// ============================================================
// OrderExpr (per signal)
// ============================================================
// Discriminated on `type`. Dimension orders reference the same column
// shape used elsewhere; measure orders reference a measure alias.

const buildOrderExpr = (columnRef: z.ZodType) =>
  z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("dimension"),
        column: columnRef,
        direction: z.enum(["asc", "desc"]),
      }),
      z.object({
        type: z.literal("measure"),
        alias: z
          .string()
          .min(1)
          .describe(
            "Alias of a measure defined in this query's `measures` array."
          ),
        direction: z.enum(["asc", "desc"]),
      }),
    ])
    .describe(
      "Sort key. Either a column (must also appear in `dimensions`) or a measure alias."
    );

const TraceOrderExpr = buildOrderExpr(TraceColumnRef);
const LogOrderExpr = buildOrderExpr(LogColumnRef);
const MetricOrderExpr = buildOrderExpr(MetricColumnRef);

// ============================================================
// TimeDimension
// ============================================================
// `compareOffset` shifts the same lookback window backward in time so
// the consumer can render period-over-period comparisons. Example:
// lookback="2h", compareOffset="7d" → compare the last 2h vs the 2h
// that ended 7d ago.

const RelativeTimeDimension = z
  .object({
    type: z.literal("relative"),
    lookback: DurationString.describe(
      'Window length ending now. Example: "2h" = the last 2 hours.'
    ),
    compareOffset: DurationString.optional().describe(
      'Optional period-over-period offset. Same window length, shifted back by this duration. Example: "7d" = compare last 2h vs the 2h that ended 7d ago.'
    ),
  })
  .describe("Relative time window ending at query time.");

const AbsoluteTimeDimension = z
  .object({
    type: z.literal("absolute"),
    startTime: ISODateString.describe("Window start (inclusive)."),
    endTime: ISODateString.describe("Window end (exclusive)."),
    compareOffset: DurationString.optional().describe(
      "Optional period-over-period offset. Same window length, shifted back by this duration."
    ),
  })
  .describe("Absolute time window with fixed ISO datetimes.");

export const TimeDimension = z
  .discriminatedUnion("type", [RelativeTimeDimension, AbsoluteTimeDimension])
  .describe(
    "Time window for the query. Required on every query — bounds the rows scanned and (for time-series output) the bucketing range."
  );

export type TimeDimension = z.infer<typeof TimeDimension>;

// ============================================================
// Aggregate output
// ============================================================
// Required on aggregate queries — explicit is better than implicit.
// `summary` → one row of {dim..., measure_alias...} per group.
// `timeSeries` → one row per (group, time-bucket). Bucket boundary is
// added to result rows as `bucket_start` (ISO datetime).

const AggregateOutput = z
  .discriminatedUnion("type", [
    z
      .object({ type: z.literal("summary") })
      .describe(
        "Single aggregated value per group, across the entire time window."
      ),
    z
      .object({
        type: z.literal("timeSeries"),
        granularity: DurationString.describe(
          'Bucket width. Example: "5m" = 5-minute buckets across the time window.'
        ),
      })
      .describe(
        "Bucketed time-series. One row per (group, bucket). Adds a `bucket_start` ISO datetime to each result row."
      ),
  ])
  .describe(
    "Shape of the aggregate result. summary = one row per group; timeSeries = one row per (group, bucket)."
  );

// ============================================================
// Per-signal query bodies
// ============================================================
// Two-level discrimination: `signal` (traces/logs/metrics) and `mode`
// (aggregate/raw). Six leaf variants flat-unioned into KopaiQuery.
// The signal+mode literals let the LLM (and JSON-Schema-aware tooling)
// resolve oneOf branches cleanly.
//
// Server-side defaults:
//   - limit: server applies a sane default if absent (especially for
//     raw mode); explicit values are recommended for predictability.

const Limit = z
  .number()
  .int()
  .min(1)
  .max(10_000)
  .optional()
  .describe(
    "Maximum rows to return. Server applies a default if omitted. Hard cap = 10000."
  );

const Cursor = z
  .string()
  .optional()
  .describe(
    "Opaque pagination token for raw mode. Omit on the first page; pass the value returned by the previous response to fetch the next page. Cursor is bound to the original query parameters — do not mutate the query between pages."
  );

const TraceAggregateQuery = z
  .object({
    signal: z.literal("traces"),
    mode: z.literal("aggregate"),
    measures: z
      .array(TraceMeasureExpr)
      .min(1)
      .describe("One or more aggregations to compute."),
    dimensions: z
      .array(TraceColumnRef)
      .optional()
      .describe(
        "GROUP BY columns. Omit for a single aggregated row across all matched spans."
      ),
    filters: z
      .array(TraceFilterExpr)
      .optional()
      .describe(
        "Pre-aggregation filters. Multiple entries are combined with AND. Use a logical filter to express OR."
      ),
    havings: z
      .array(HavingExpr)
      .optional()
      .describe(
        "Post-aggregation filters on measure aliases. Combined with AND."
      ),
    timeDimension: TimeDimension,
    orderBy: z
      .array(TraceOrderExpr)
      .optional()
      .describe("Sort keys applied in array order."),
    output: AggregateOutput,
    limit: Limit,
  })
  .describe("Aggregate query over traces (spans).");

const TraceRawQuery = z
  .object({
    signal: z.literal("traces"),
    mode: z.literal("raw"),
    dimensions: z
      .array(TraceColumnRef)
      .min(1)
      .describe(
        "Columns to project in each returned row. Result rows are the denormalized OTel trace shape filtered to these columns."
      ),
    filters: z.array(TraceFilterExpr).optional(),
    timeDimension: TimeDimension,
    orderBy: z.array(TraceOrderExpr).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .describe(
    "Raw span search. Returns denormalized OTel trace rows — no aggregation."
  );

const LogAggregateQuery = z
  .object({
    signal: z.literal("logs"),
    mode: z.literal("aggregate"),
    measures: z.array(LogMeasureExpr).min(1),
    dimensions: z.array(LogColumnRef).optional(),
    filters: z.array(LogFilterExpr).optional(),
    havings: z.array(HavingExpr).optional(),
    timeDimension: TimeDimension,
    orderBy: z.array(LogOrderExpr).optional(),
    output: AggregateOutput,
    limit: Limit,
  })
  .describe("Aggregate query over logs.");

const LogRawQuery = z
  .object({
    signal: z.literal("logs"),
    mode: z.literal("raw"),
    dimensions: z.array(LogColumnRef).min(1),
    filters: z.array(LogFilterExpr).optional(),
    timeDimension: TimeDimension,
    orderBy: z.array(LogOrderExpr).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .describe(
    "Raw log search. Returns denormalized OTel log rows — no aggregation."
  );

const MetricAggregateQuery = z
  .object({
    signal: z.literal("metrics"),
    mode: z.literal("aggregate"),
    measures: z.array(MetricMeasureExpr).min(1),
    dimensions: z.array(MetricColumnRef).optional(),
    filters: z.array(MetricFilterExpr).optional(),
    havings: z.array(HavingExpr).optional(),
    timeDimension: TimeDimension,
    orderBy: z.array(MetricOrderExpr).optional(),
    output: AggregateOutput,
    limit: Limit,
  })
  .describe("Aggregate query over metrics data points.");

const MetricRawQuery = z
  .object({
    signal: z.literal("metrics"),
    mode: z.literal("raw"),
    dimensions: z.array(MetricColumnRef).min(1),
    filters: z.array(MetricFilterExpr).optional(),
    timeDimension: TimeDimension,
    orderBy: z.array(MetricOrderExpr).optional(),
    limit: Limit,
    cursor: Cursor,
  })
  .describe(
    "Raw metric data-point search. Returns denormalized OTel metric rows — no aggregation."
  );

// ============================================================
// KopaiQuery
// ============================================================

export const KopaiQuery = z
  .union([
    TraceAggregateQuery,
    TraceRawQuery,
    LogAggregateQuery,
    LogRawQuery,
    MetricAggregateQuery,
    MetricRawQuery,
  ])
  .describe(
    "Telemetry query. Pick `signal` (traces/logs/metrics) and `mode` (aggregate/raw); the rest of the shape follows from that pair."
  );

export type KopaiQuery = z.infer<typeof KopaiQuery>;

export type TraceAggregateQuery = z.infer<typeof TraceAggregateQuery>;
export type TraceRawQuery = z.infer<typeof TraceRawQuery>;
export type LogAggregateQuery = z.infer<typeof LogAggregateQuery>;
export type LogRawQuery = z.infer<typeof LogRawQuery>;
export type MetricAggregateQuery = z.infer<typeof MetricAggregateQuery>;
export type MetricRawQuery = z.infer<typeof MetricRawQuery>;

export {
  TraceAggregateQuery as TraceAggregateQuerySchema,
  TraceRawQuery as TraceRawQuerySchema,
  LogAggregateQuery as LogAggregateQuerySchema,
  LogRawQuery as LogRawQuerySchema,
  MetricAggregateQuery as MetricAggregateQuerySchema,
  MetricRawQuery as MetricRawQuerySchema,
  TraceColumn,
  LogColumn,
  MetricColumn,
  TraceAttrContainer,
  LogAttrContainer,
  MetricAttrContainer,
  NumericOp,
};
