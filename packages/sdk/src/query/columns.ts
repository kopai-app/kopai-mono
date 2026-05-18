/**
 * Column reference types and per-signal column records.
 *
 * `ColumnRef<Name, TsType, Kind>` is a phantom-branded reference to a
 * column. `Name` is the wire-level identifier (camelCase, or
 * `<map>.<key>` for attribute-map indices). `TsType` is the JSON
 * deserialized type returned in rows. `Kind` is an agg-eligibility tag.
 *
 * Attribute maps support dynamic indexing via a Proxy: any string key
 * yields a `ColumnRef<'<map>.<key>', string, 'string'>`.
 *
 * Runtime objects carry only the `toNode()` method that produces the
 * wire AST; the phantom fields are type-only.
 */
import type {
  AttributeMapName,
  ColumnRefNode,
  AttributeValue,
} from "./internal-shared.js";

/** Agg-eligibility tag for a column. */
export type Kind =
  | "number"
  | "numericString"
  | "string"
  | "bool"
  | "array"
  | "map"
  | "date";

/**
 * Triple-branded column reference. Phantom fields are type-only — the
 * runtime object only carries `toNode()`.
 */
export interface ColumnRef<Name extends string, TsType, K extends Kind> {
  readonly __name: Name;
  readonly __ts: TsType;
  readonly __kind: K;
  toNode(): ColumnRefNode;
}

/**
 * Internal factory: build a runtime ColumnRef value with a `toNode()`
 * method that produces the wire AST.
 */
function makeCol<Name extends string, TsType, K extends Kind>(
  name: Name
): ColumnRef<Name, TsType, K> {
  return {
    toNode(): ColumnRefNode {
      return { kind: "col", name };
    },
  } as ColumnRef<Name, TsType, K>;
}

/**
 * Build an attribute-map column ref whose Name is `<map>.<key>` and
 * Kind is 'string'. Used by the Proxy below.
 */
function makeAttrCol<MapName extends AttributeMapName>(
  map: MapName,
  key: string
): ColumnRef<`${MapName}.${string}`, string, "string"> {
  return {
    toNode(): ColumnRefNode {
      return { kind: "attr", map, key };
    },
  } as ColumnRef<`${MapName}.${string}`, string, "string">;
}

/**
 * A Proxy-backed object representing an attribute map column. Behaves
 * as both a top-level column ref (resourceAttributes, spanAttributes,
 * etc.) AND as an indexable object yielding attribute column refs.
 */
type AttrMapColumn<MapName extends AttributeMapName, TopTs> = ColumnRef<
  MapName,
  TopTs,
  "map"
> & {
  readonly [key: string]: ColumnRef<`${MapName}.${string}`, string, "string">;
};

function makeAttrMap<MapName extends AttributeMapName, TopTs>(
  map: MapName
): AttrMapColumn<MapName, TopTs> {
  const base: Record<string, unknown> = {
    toNode(): ColumnRefNode {
      return { kind: "col", name: map };
    },
  };
  const proxy = new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "toNode") return target.toNode;
      // Phantom fields are TS-only; never accessed at runtime.
      if (prop === "__name" || prop === "__ts" || prop === "__kind") {
        return undefined;
      }
      return makeAttrCol(map, prop);
    },
  });
  return proxy as unknown as AttrMapColumn<MapName, TopTs>;
}

/* ------------------------------------------------------------------ */
/* Traces columns                                                     */
/* ------------------------------------------------------------------ */

export const tracesColumns = {
  spanId: makeCol<"spanId", string, "string">("spanId"),
  timestamp: makeCol<"timestamp", string, "numericString">("timestamp"),
  traceId: makeCol<"traceId", string, "string">("traceId"),
  duration: makeCol<"duration", string | undefined, "numericString">(
    "duration"
  ),
  eventsAttributes: makeCol<
    "eventsAttributes",
    Array<Record<string, AttributeValue>> | undefined,
    "array"
  >("eventsAttributes"),
  eventsName: makeCol<"eventsName", string[] | undefined, "array">(
    "eventsName"
  ),
  eventsTimestamp: makeCol<"eventsTimestamp", string[] | undefined, "array">(
    "eventsTimestamp"
  ),
  linksAttributes: makeCol<
    "linksAttributes",
    Array<Record<string, AttributeValue>> | undefined,
    "array"
  >("linksAttributes"),
  linksSpanId: makeCol<"linksSpanId", string[] | undefined, "array">(
    "linksSpanId"
  ),
  linksTraceId: makeCol<"linksTraceId", string[] | undefined, "array">(
    "linksTraceId"
  ),
  linksTraceState: makeCol<"linksTraceState", string[] | undefined, "array">(
    "linksTraceState"
  ),
  parentSpanId: makeCol<"parentSpanId", string | undefined, "string">(
    "parentSpanId"
  ),
  resourceAttributes: makeAttrMap<
    "resourceAttributes",
    Record<string, AttributeValue> | undefined
  >("resourceAttributes"),
  scopeName: makeCol<"scopeName", string | undefined, "string">("scopeName"),
  scopeVersion: makeCol<"scopeVersion", string | undefined, "string">(
    "scopeVersion"
  ),
  serviceName: makeCol<"serviceName", string | undefined, "string">(
    "serviceName"
  ),
  spanAttributes: makeAttrMap<
    "spanAttributes",
    Record<string, AttributeValue> | undefined
  >("spanAttributes"),
  spanKind: makeCol<"spanKind", string | undefined, "string">("spanKind"),
  spanName: makeCol<"spanName", string | undefined, "string">("spanName"),
  statusCode: makeCol<"statusCode", string | undefined, "string">("statusCode"),
  statusMessage: makeCol<"statusMessage", string | undefined, "string">(
    "statusMessage"
  ),
  traceState: makeCol<"traceState", string | undefined, "string">("traceState"),
} as const;

export type TracesColumns = typeof tracesColumns;

/* ------------------------------------------------------------------ */
/* Logs columns                                                       */
/* ------------------------------------------------------------------ */

export const logsColumns = {
  timestamp: makeCol<"timestamp", string, "numericString">("timestamp"),
  body: makeCol<"body", string | undefined, "string">("body"),
  eventName: makeCol<"eventName", string | undefined, "string">("eventName"),
  logAttributes: makeAttrMap<
    "logAttributes",
    Record<string, AttributeValue> | undefined
  >("logAttributes"),
  resourceAttributes: makeAttrMap<
    "resourceAttributes",
    Record<string, AttributeValue> | undefined
  >("resourceAttributes"),
  resourceSchemaUrl: makeCol<"resourceSchemaUrl", string | undefined, "string">(
    "resourceSchemaUrl"
  ),
  scopeAttributes: makeAttrMap<
    "scopeAttributes",
    Record<string, AttributeValue> | undefined
  >("scopeAttributes"),
  scopeName: makeCol<"scopeName", string | undefined, "string">("scopeName"),
  scopeSchemaUrl: makeCol<"scopeSchemaUrl", string | undefined, "string">(
    "scopeSchemaUrl"
  ),
  scopeVersion: makeCol<"scopeVersion", string | undefined, "string">(
    "scopeVersion"
  ),
  serviceName: makeCol<"serviceName", string | undefined, "string">(
    "serviceName"
  ),
  severityNumber: makeCol<"severityNumber", number | undefined, "number">(
    "severityNumber"
  ),
  severityText: makeCol<"severityText", string | undefined, "string">(
    "severityText"
  ),
  spanId: makeCol<"spanId", string | undefined, "string">("spanId"),
  traceFlags: makeCol<"traceFlags", number | undefined, "number">("traceFlags"),
  traceId: makeCol<"traceId", string | undefined, "string">("traceId"),
} as const;

export type LogsColumns = typeof logsColumns;

/* ------------------------------------------------------------------ */
/* Metrics columns (per metric type)                                  */
/* ------------------------------------------------------------------ */

/** Columns common to every metric type. */
function metricsBaseColumns() {
  return {
    timeUnix: makeCol<"timeUnix", string, "numericString">("timeUnix"),
    startTimeUnix: makeCol<"startTimeUnix", string, "numericString">(
      "startTimeUnix"
    ),
    attributes: makeAttrMap<
      "attributes",
      Record<string, AttributeValue> | undefined
    >("attributes"),
    metricName: makeCol<"metricName", string | undefined, "string">(
      "metricName"
    ),
    metricDescription: makeCol<
      "metricDescription",
      string | undefined,
      "string"
    >("metricDescription"),
    metricUnit: makeCol<"metricUnit", string | undefined, "string">(
      "metricUnit"
    ),
    resourceAttributes: makeAttrMap<
      "resourceAttributes",
      Record<string, AttributeValue> | undefined
    >("resourceAttributes"),
    resourceSchemaUrl: makeCol<
      "resourceSchemaUrl",
      string | undefined,
      "string"
    >("resourceSchemaUrl"),
    scopeAttributes: makeAttrMap<
      "scopeAttributes",
      Record<string, AttributeValue> | undefined
    >("scopeAttributes"),
    scopeDroppedAttrCount: makeCol<
      "scopeDroppedAttrCount",
      number | undefined,
      "number"
    >("scopeDroppedAttrCount"),
    scopeName: makeCol<"scopeName", string | undefined, "string">("scopeName"),
    scopeSchemaUrl: makeCol<"scopeSchemaUrl", string | undefined, "string">(
      "scopeSchemaUrl"
    ),
    scopeVersion: makeCol<"scopeVersion", string | undefined, "string">(
      "scopeVersion"
    ),
    serviceName: makeCol<"serviceName", string | undefined, "string">(
      "serviceName"
    ),
    exemplarsFilteredAttributes: makeCol<
      "exemplarsFilteredAttributes",
      Array<Record<string, AttributeValue>> | undefined,
      "array"
    >("exemplarsFilteredAttributes"),
    exemplarsSpanId: makeCol<"exemplarsSpanId", string[] | undefined, "array">(
      "exemplarsSpanId"
    ),
    exemplarsTimeUnix: makeCol<
      "exemplarsTimeUnix",
      string[] | undefined,
      "array"
    >("exemplarsTimeUnix"),
    exemplarsTraceId: makeCol<
      "exemplarsTraceId",
      string[] | undefined,
      "array"
    >("exemplarsTraceId"),
    exemplarsValue: makeCol<"exemplarsValue", number[] | undefined, "array">(
      "exemplarsValue"
    ),
    metricType: makeCol<"metricType", string | undefined, "string">(
      "metricType"
    ),
  } as const;
}

export const gaugeColumns = {
  ...metricsBaseColumns(),
  value: makeCol<"value", number, "number">("value"),
  flags: makeCol<"flags", number | undefined, "number">("flags"),
} as const;

export const sumColumns = {
  ...metricsBaseColumns(),
  value: makeCol<"value", number, "number">("value"),
  flags: makeCol<"flags", number | undefined, "number">("flags"),
  aggregationTemporality: makeCol<
    "aggregationTemporality",
    string | undefined,
    "string"
  >("aggregationTemporality"),
  isMonotonic: makeCol<"isMonotonic", number | undefined, "number">(
    "isMonotonic"
  ),
} as const;

export const histogramColumns = {
  ...metricsBaseColumns(),
  count: makeCol<"count", number | undefined, "number">("count"),
  sum: makeCol<"sum", number | undefined, "number">("sum"),
  min: makeCol<"min", number | null | undefined, "number">("min"),
  max: makeCol<"max", number | null | undefined, "number">("max"),
  bucketCounts: makeCol<"bucketCounts", number[] | undefined, "array">(
    "bucketCounts"
  ),
  explicitBounds: makeCol<"explicitBounds", number[] | undefined, "array">(
    "explicitBounds"
  ),
  aggregationTemporality: makeCol<
    "aggregationTemporality",
    string | undefined,
    "string"
  >("aggregationTemporality"),
} as const;

export const exponentialHistogramColumns = {
  ...metricsBaseColumns(),
  count: makeCol<"count", number | undefined, "number">("count"),
  sum: makeCol<"sum", number | undefined, "number">("sum"),
  min: makeCol<"min", number | null | undefined, "number">("min"),
  max: makeCol<"max", number | null | undefined, "number">("max"),
  scale: makeCol<"scale", number | undefined, "number">("scale"),
  zeroCount: makeCol<"zeroCount", number | undefined, "number">("zeroCount"),
  positiveBucketCounts: makeCol<
    "positiveBucketCounts",
    number[] | undefined,
    "array"
  >("positiveBucketCounts"),
  positiveOffset: makeCol<"positiveOffset", number | undefined, "number">(
    "positiveOffset"
  ),
  negativeBucketCounts: makeCol<
    "negativeBucketCounts",
    number[] | undefined,
    "array"
  >("negativeBucketCounts"),
  negativeOffset: makeCol<"negativeOffset", number | undefined, "number">(
    "negativeOffset"
  ),
  zeroThreshold: makeCol<"zeroThreshold", number | undefined, "number">(
    "zeroThreshold"
  ),
  aggregationTemporality: makeCol<
    "aggregationTemporality",
    string | undefined,
    "string"
  >("aggregationTemporality"),
} as const;

export const summaryColumns = {
  ...metricsBaseColumns(),
  count: makeCol<"count", number | undefined, "number">("count"),
  sum: makeCol<"sum", number | undefined, "number">("sum"),
  valueAtQuantilesQuantile: makeCol<
    "valueAtQuantilesQuantile",
    number[] | undefined,
    "array"
  >("valueAtQuantilesQuantile"),
  valueAtQuantilesValue: makeCol<
    "valueAtQuantilesValue",
    number[] | undefined,
    "array"
  >("valueAtQuantilesValue"),
} as const;

/* ------------------------------------------------------------------ */
/* Per-signal column-name unions (used to gate agg fns by signal)     */
/* ------------------------------------------------------------------ */

/** Column-name union for traces (top-level + attr-map indices). */
export type TracesColumnName =
  | keyof TracesColumns
  | `spanAttributes.${string}`
  | `resourceAttributes.${string}`;

/** Column-name union for logs (top-level + attr-map indices). */
export type LogsColumnName =
  | keyof LogsColumns
  | `logAttributes.${string}`
  | `resourceAttributes.${string}`
  | `scopeAttributes.${string}`;

/** Column-name union covering every metric-type column. */
export type MetricsColumnName =
  | keyof typeof gaugeColumns
  | keyof typeof sumColumns
  | keyof typeof histogramColumns
  | keyof typeof exponentialHistogramColumns
  | keyof typeof summaryColumns
  | `attributes.${string}`
  | `resourceAttributes.${string}`
  | `scopeAttributes.${string}`;
