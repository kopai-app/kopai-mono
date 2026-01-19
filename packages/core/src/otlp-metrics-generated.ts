import type {
  AggregationTemporality,
  InstrumentationScope,
  KeyValue,
  Resource,
} from "./otlp-generated.js";

/**
 * MetricsData represents the metrics data that can be stored in a persistent
 * storage, OR can be embedded by other protocols that transfer OTLP metrics
 * data but do not implement the OTLP protocol.
 *
 * MetricsData
 * └─── ResourceMetrics
 *   ├── Resource
 *   ├── SchemaURL
 *   └── ScopeMetrics
 *      ├── Scope
 *      ├── SchemaURL
 *      └── Metric
 *         ├── Name
 *         ├── Description
 *         ├── Unit
 *         └── data
 *            ├── Gauge
 *            ├── Sum
 *            ├── Histogram
 *            ├── ExponentialHistogram
 *            └── Summary
 *
 * The main difference between this message and collector protocol is that
 * in this message there will not be any "control" or "metadata" specific to
 * OTLP protocol.
 *
 * When new fields are added into this message, the OTLP request MUST be updated
 * as well.
 */
export interface MetricsData {
  /**
   * An array of ResourceMetrics.
   * For data coming from a single resource this array will typically contain
   * one element. Intermediary nodes that receive data from multiple origins
   * typically batch the data before forwarding further and in that case this
   * array will contain multiple elements.
   */
  resourceMetrics?: ResourceMetrics[] | undefined;
}

/** A collection of ScopeMetrics from a Resource. */
export interface ResourceMetrics {
  /**
   * The resource for the metrics in this message.
   * If this field is not set then no resource info is known.
   */
  resource?: Resource | undefined;
  /** A list of metrics that originate from a resource. */
  scopeMetrics?: ScopeMetrics[] | undefined;
  /**
   * The Schema URL, if known. This is the identifier of the Schema that the resource data
   * is recorded in. Notably, the last part of the URL path is the version number of the
   * schema: http[s]://server[:port]/path/<version>. To learn more about Schema URL see
   * https://opentelemetry.io/docs/specs/otel/schemas/#schema-url
   * This schema_url applies to the data in the "resource" field. It does not apply
   * to the data in the "scope_metrics" field which have their own schema_url field.
   */
  schemaUrl?: string | undefined;
}

/** A collection of Metrics produced by an Scope. */
export interface ScopeMetrics {
  /**
   * The instrumentation scope information for the metrics in this message.
   * Semantically when InstrumentationScope isn't set, it is equivalent with
   * an empty instrumentation scope name (unknown).
   */
  scope?: InstrumentationScope | undefined;
  /** A list of metrics that originate from an instrumentation library. */
  metrics?: Metric[] | undefined;
  /**
   * The Schema URL, if known. This is the identifier of the Schema that the metric data
   * is recorded in. Notably, the last part of the URL path is the version number of the
   * schema: http[s]://server[:port]/path/<version>. To learn more about Schema URL see
   * https://opentelemetry.io/docs/specs/otel/schemas/#schema-url
   * This schema_url applies to the data in the "scope" field and all metrics in the
   * "metrics" field.
   */
  schemaUrl?: string | undefined;
}

/**
 * Defines a Metric which has one or more timeseries.  The following is a
 * brief summary of the Metric data model.  For more details, see:
 *
 *   https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/data-model.md
 *
 * The data model and relation between entities is shown in the
 * diagram below. Here, "DataPoint" is the term used to refer to any
 * one of the specific data point value types, and "points" is the term used
 * to refer to any one of the lists of points contained in the Metric.
 *
 * - Metric is composed of a metadata and data.
 * - Metadata part contains a name, description, unit.
 * - Data is one of the possible types (Sum, Gauge, Histogram, Summary).
 * - DataPoint contains timestamps, attributes, and one of the possible value type
 *   fields.
 *
 *    Metric
 *  +------------+
 *  |name        |
 *  |description |
 *  |unit        |     +------------------------------------+
 *  |data        |---> |Gauge, Sum, Histogram, Summary, ... |
 *  +------------+     +------------------------------------+
 *
 *    Data [One of Gauge, Sum, Histogram, Summary, ...]
 *  +-----------+
 *  |...        |  // Metadata about the Data.
 *  |points     |--+
 *  +-----------+  |
 *                 |      +---------------------------+
 *                 |      |DataPoint 1                |
 *                 v      |+------+------+   +------+ |
 *              +-----+   ||label |label |...|label | |
 *              |  1  |-->||value1|value2|...|valueN| |
 *              +-----+   |+------+------+   +------+ |
 *              |  .  |   |+-----+                    |
 *              |  .  |   ||value|                    |
 *              |  .  |   |+-----+                    |
 *              |  .  |   +---------------------------+
 *              |  .  |                   .
 *              |  .  |                   .
 *              |  .  |                   .
 *              |  .  |   +---------------------------+
 *              |  .  |   |DataPoint M                |
 *              +-----+   |+------+------+   +------+ |
 *              |  M  |-->||label |label |...|label | |
 *              +-----+   ||value1|value2|...|valueN| |
 *                        |+------+------+   +------+ |
 *                        |+-----+                    |
 *                        ||value|                    |
 *                        |+-----+                    |
 *                        +---------------------------+
 *
 * Each distinct type of DataPoint represents the output of a specific
 * aggregation function, the result of applying the DataPoint's
 * associated function of to one or more measurements.
 *
 * All DataPoint types have three common fields:
 * - Attributes includes key-value pairs associated with the data point
 * - TimeUnixNano is required, set to the end time of the aggregation
 * - StartTimeUnixNano is optional, but strongly encouraged for DataPoints
 *   having an AggregationTemporality field, as discussed below.
 *
 * Both TimeUnixNano and StartTimeUnixNano values are expressed as
 * UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January 1970.
 *
 * # TimeUnixNano
 *
 * This field is required, having consistent interpretation across
 * DataPoint types.  TimeUnixNano is the moment corresponding to when
 * the data point's aggregate value was captured.
 *
 * Data points with the 0 value for TimeUnixNano SHOULD be rejected
 * by consumers.
 *
 * # StartTimeUnixNano
 *
 * StartTimeUnixNano in general allows detecting when a sequence of
 * observations is unbroken.  This field indicates to consumers the
 * start time for points with cumulative and delta
 * AggregationTemporality, and it should be included whenever possible
 * to support correct rate calculation.  Although it may be omitted
 * when the start time is truly unknown, setting StartTimeUnixNano is
 * strongly encouraged.
 */
export interface Metric {
  /** The name of the metric. */
  name?: string | undefined;
  /** A description of the metric, which can be used in documentation. */
  description?: string | undefined;
  /**
   * The unit in which the metric value is reported. Follows the format
   * described by https://unitsofmeasure.org/ucum.html.
   */
  unit?: string | undefined;
  gauge?: Gauge | undefined;
  sum?: Sum | undefined;
  histogram?: Histogram | undefined;
  exponentialHistogram?: ExponentialHistogram | undefined;
  summary?: Summary | undefined;
  /**
   * Additional metadata attributes that describe the metric. [Optional].
   * Attributes are non-identifying.
   * Consumers SHOULD NOT need to be aware of these attributes.
   * These attributes MAY be used to encode information allowing
   * for lossless roundtrip translation to / from another data model.
   * Attribute keys MUST be unique (it is not allowed to have more than one
   * attribute with the same key).
   * The behavior of software that receives duplicated keys can be unpredictable.
   */
  metadata?: KeyValue[] | undefined;
}

/**
 * Gauge represents the type of a scalar metric that always exports the
 * "current value" for every data point. It should be used for an "unknown"
 * aggregation.
 *
 * A Gauge does not support different aggregation temporalities. Given the
 * aggregation is unknown, points cannot be combined using the same
 * aggregation, regardless of aggregation temporalities. Therefore,
 * AggregationTemporality is not included. Consequently, this also means
 * "StartTimeUnixNano" is ignored for all data points.
 */
export interface Gauge {
  /**
   * The time series data points.
   * Note: Multiple time series may be included (same timestamp, different attributes).
   */
  dataPoints?: NumberDataPoint[] | undefined;
}

/**
 * Sum represents the type of a scalar metric that is calculated as a sum of all
 * reported measurements over a time interval.
 */
export interface Sum {
  /**
   * The time series data points.
   * Note: Multiple time series may be included (same timestamp, different attributes).
   */
  dataPoints?: NumberDataPoint[] | undefined;
  /**
   * aggregation_temporality describes if the aggregator reports delta changes
   * since last report time, or cumulative changes since a fixed start time.
   */
  aggregationTemporality?: AggregationTemporality | undefined;
  /** Represents whether the sum is monotonic. */
  isMonotonic?: boolean | undefined;
}

/**
 * Histogram represents the type of a metric that is calculated by aggregating
 * as a Histogram of all reported measurements over a time interval.
 */
export interface Histogram {
  /**
   * The time series data points.
   * Note: Multiple time series may be included (same timestamp, different attributes).
   */
  dataPoints?: HistogramDataPoint[] | undefined;
  /**
   * aggregation_temporality describes if the aggregator reports delta changes
   * since last report time, or cumulative changes since a fixed start time.
   */
  aggregationTemporality?: AggregationTemporality | undefined;
}

/**
 * ExponentialHistogram represents the type of a metric that is calculated by aggregating
 * as a ExponentialHistogram of all reported double measurements over a time interval.
 */
export interface ExponentialHistogram {
  /**
   * The time series data points.
   * Note: Multiple time series may be included (same timestamp, different attributes).
   */
  dataPoints?: ExponentialHistogramDataPoint[] | undefined;
  /**
   * aggregation_temporality describes if the aggregator reports delta changes
   * since last report time, or cumulative changes since a fixed start time.
   */
  aggregationTemporality?: AggregationTemporality | undefined;
}

/**
 * Summary metric data are used to convey quantile summaries,
 * a Prometheus (see: https://prometheus.io/docs/concepts/metric_types/#summary)
 * and OpenMetrics (see: https://github.com/prometheus/OpenMetrics/blob/4dbf6075567ab43296eed941037c12951faafb92/protos/prometheus.proto#L45)
 * data type. These data points cannot always be merged in a meaningful way.
 * While they can be useful in some applications, histogram data points are
 * recommended for new applications.
 * Summary metrics do not have an aggregation temporality field. This is
 * because the count and sum fields of a SummaryDataPoint are assumed to be
 * cumulative values.
 */
export interface Summary {
  /**
   * The time series data points.
   * Note: Multiple time series may be included (same timestamp, different attributes).
   */
  dataPoints?: SummaryDataPoint[] | undefined;
}

/**
 * NumberDataPoint is a single data point in a timeseries that describes the
 * time-varying scalar value of a metric.
 */
export interface NumberDataPoint {
  /**
   * The set of key/value pairs that uniquely identify the timeseries from
   * where this point belongs. The list may be empty (may contain 0 elements).
   * Attribute keys MUST be unique (it is not allowed to have more than one
   * attribute with the same key).
   * The behavior of software that receives duplicated keys can be unpredictable.
   */
  attributes?: KeyValue[] | undefined;
  /**
   * StartTimeUnixNano is optional but strongly encouraged, see the
   * the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  startTimeUnixNano?: string | undefined;
  /**
   * TimeUnixNano is required, see the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  timeUnixNano?: string | undefined;
  asDouble?: number | undefined;
  asInt?: string | undefined;
  /**
   * (Optional) List of exemplars collected from
   * measurements that were used to form the data point
   */
  exemplars?: Exemplar[] | undefined;
  /**
   * Flags that apply to this specific data point.  See DataPointFlags
   * for the available flags and their meaning.
   */
  flags?: number | undefined;
}

/**
 * HistogramDataPoint is a single data point in a timeseries that describes the
 * time-varying values of a Histogram. A Histogram contains summary statistics
 * for a population of values, it may optionally contain the distribution of
 * those values across a set of buckets.
 *
 * If the histogram contains the distribution of values, then both
 * "explicit_bounds" and "bucket counts" fields must be defined.
 * If the histogram does not contain the distribution of values, then both
 * "explicit_bounds" and "bucket_counts" must be omitted and only "count" and
 * "sum" are known.
 */
export interface HistogramDataPoint {
  /**
   * The set of key/value pairs that uniquely identify the timeseries from
   * where this point belongs. The list may be empty (may contain 0 elements).
   * Attribute keys MUST be unique (it is not allowed to have more than one
   * attribute with the same key).
   * The behavior of software that receives duplicated keys can be unpredictable.
   */
  attributes?: KeyValue[] | undefined;
  /**
   * StartTimeUnixNano is optional but strongly encouraged, see the
   * the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  startTimeUnixNano?: string | undefined;
  /**
   * TimeUnixNano is required, see the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  timeUnixNano?: string | undefined;
  /**
   * count is the number of values in the population. Must be non-negative. This
   * value must be equal to the sum of the "count" fields in buckets if a
   * histogram is provided.
   */
  count?: string | undefined;
  /**
   * sum of the values in the population. If count is zero then this field
   * must be zero.
   *
   * Note: Sum should only be filled out when measuring non-negative discrete
   * events, and is assumed to be monotonic over the values of these events.
   * Negative events *can* be recorded, but sum should not be filled out when
   * doing so.  This is specifically to enforce compatibility w/ OpenMetrics,
   * see: https://github.com/prometheus/OpenMetrics/blob/v1.0.0/specification/OpenMetrics.md#histogram
   */
  sum?: number | undefined;
  /**
   * bucket_counts is an optional field contains the count values of histogram
   * for each bucket.
   *
   * The sum of the bucket_counts must equal the value in the count field.
   *
   * The number of elements in bucket_counts array must be by one greater than
   * the number of elements in explicit_bounds array. The exception to this rule
   * is when the length of bucket_counts is 0, then the length of explicit_bounds
   * must also be 0.
   */
  bucketCounts?: number[] | undefined;
  /**
   * explicit_bounds specifies buckets with explicitly defined bounds for values.
   *
   * The boundaries for bucket at index i are:
   *
   * (-infinity, explicit_bounds[i]] for i == 0
   * (explicit_bounds[i-1], explicit_bounds[i]] for 0 < i < size(explicit_bounds)
   * (explicit_bounds[i-1], +infinity) for i == size(explicit_bounds)
   *
   * The values in the explicit_bounds array must be strictly increasing.
   *
   * Histogram buckets are inclusive of their upper boundary, except the last
   * bucket where the boundary is at infinity. This format is intentionally
   * compatible with the OpenMetrics histogram definition.
   *
   * If bucket_counts length is 0 then explicit_bounds length must also be 0,
   * otherwise the data point is invalid.
   */
  explicitBounds?: number[] | undefined;
  /**
   * (Optional) List of exemplars collected from
   * measurements that were used to form the data point
   */
  exemplars?: Exemplar[] | undefined;
  /**
   * Flags that apply to this specific data point.  See DataPointFlags
   * for the available flags and their meaning.
   */
  flags?: number | undefined;
  /** min is the minimum value over (start_time, end_time]. */
  min?: number | undefined;
  /** max is the maximum value over (start_time, end_time]. */
  max?: number | undefined;
}

/**
 * ExponentialHistogramDataPoint is a single data point in a timeseries that describes the
 * time-varying values of a ExponentialHistogram of double values. A ExponentialHistogram contains
 * summary statistics for a population of values, it may optionally contain the
 * distribution of those values across a set of buckets.
 */
export interface ExponentialHistogramDataPoint {
  /**
   * The set of key/value pairs that uniquely identify the timeseries from
   * where this point belongs. The list may be empty (may contain 0 elements).
   * Attribute keys MUST be unique (it is not allowed to have more than one
   * attribute with the same key).
   * The behavior of software that receives duplicated keys can be unpredictable.
   */
  attributes?: KeyValue[] | undefined;
  /**
   * StartTimeUnixNano is optional but strongly encouraged, see the
   * the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  startTimeUnixNano?: string | undefined;
  /**
   * TimeUnixNano is required, see the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  timeUnixNano?: string | undefined;
  /**
   * The number of values in the population. Must be
   * non-negative. This value must be equal to the sum of the "bucket_counts"
   * values in the positive and negative Buckets plus the "zero_count" field.
   */
  count?: string | undefined;
  /**
   * The sum of the values in the population. If count is zero then this field
   * must be zero.
   *
   * Note: Sum should only be filled out when measuring non-negative discrete
   * events, and is assumed to be monotonic over the values of these events.
   * Negative events *can* be recorded, but sum should not be filled out when
   * doing so.  This is specifically to enforce compatibility w/ OpenMetrics,
   * see: https://github.com/prometheus/OpenMetrics/blob/v1.0.0/specification/OpenMetrics.md#histogram
   */
  sum?: number | undefined;
  /**
   * scale describes the resolution of the histogram.  Boundaries are
   * located at powers of the base, where:
   *
   *   base = (2^(2^-scale))
   *
   * The histogram bucket identified by `index`, a signed integer,
   * contains values that are greater than (base^index) and
   * less than or equal to (base^(index+1)).
   *
   * The positive and negative ranges of the histogram are expressed
   * separately.  Negative values are mapped by their absolute value
   * into the negative range using the same scale as the positive range.
   *
   * scale is not restricted by the protocol, as the permissible
   * values depend on the range of the data.
   */
  scale?: number | undefined;
  /**
   * The count of values that are either exactly zero or
   * within the region considered zero by the instrumentation at the
   * tolerated degree of precision.  This bucket stores values that
   * cannot be expressed using the standard exponential formula as
   * well as values that have been rounded to zero.
   *
   * Implementations MAY consider the zero bucket to have probability
   * mass equal to (zero_count / count).
   */
  zeroCount?: number | undefined;
  /** positive carries the positive range of exponential bucket counts. */
  positive?: ExponentialHistogramDataPoint_Buckets | undefined;
  /** negative carries the negative range of exponential bucket counts. */
  negative?: ExponentialHistogramDataPoint_Buckets | undefined;
  /**
   * Flags that apply to this specific data point.  See DataPointFlags
   * for the available flags and their meaning.
   */
  flags?: number | undefined;
  /**
   * (Optional) List of exemplars collected from
   * measurements that were used to form the data point
   */
  exemplars?: Exemplar[] | undefined;
  /** The minimum value over (start_time, end_time]. */
  min?: number | undefined;
  /** The maximum value over (start_time, end_time]. */
  max?: number | undefined;
  /**
   * ZeroThreshold may be optionally set to convey the width of the zero
   * region. Where the zero region is defined as the closed interval
   * [-ZeroThreshold, ZeroThreshold].
   * When ZeroThreshold is 0, zero count bucket stores values that cannot be
   * expressed using the standard exponential formula as well as values that
   * have been rounded to zero.
   */
  zeroThreshold?: number | undefined;
}

/**
 * Buckets are a set of bucket counts, encoded in a contiguous array
 * of counts.
 */
export interface ExponentialHistogramDataPoint_Buckets {
  /**
   * The bucket index of the first entry in the bucket_counts array.
   *
   * Note: This uses a varint encoding as a simple form of compression.
   */
  offset?: number | undefined;
  /**
   * An array of count values, where bucket_counts[i] carries
   * the count of the bucket at index (offset+i). bucket_counts[i] is the count
   * of values greater than base^(offset+i) and less than or equal to
   * base^(offset+i+1).
   *
   * Note: By contrast, the explicit HistogramDataPoint uses
   * fixed64.  This field is expected to have many buckets,
   * especially zeros, so uint64 has been selected to ensure
   * varint encoding.
   */
  bucketCounts?: string[] | undefined;
}

/**
 * SummaryDataPoint is a single data point in a timeseries that describes the
 * time-varying values of a Summary metric. The count and sum fields represent
 * cumulative values.
 */
export interface SummaryDataPoint {
  /**
   * The set of key/value pairs that uniquely identify the timeseries from
   * where this point belongs. The list may be empty (may contain 0 elements).
   * Attribute keys MUST be unique (it is not allowed to have more than one
   * attribute with the same key).
   * The behavior of software that receives duplicated keys can be unpredictable.
   */
  attributes?: KeyValue[] | undefined;
  /**
   * StartTimeUnixNano is optional but strongly encouraged, see the
   * the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  startTimeUnixNano?: string | undefined;
  /**
   * TimeUnixNano is required, see the detailed comments above Metric.
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  timeUnixNano?: string | undefined;
  /** count is the number of values in the population. Must be non-negative. */
  count?: string | undefined;
  /**
   * sum of the values in the population. If count is zero then this field
   * must be zero.
   *
   * Note: Sum should only be filled out when measuring non-negative discrete
   * events, and is assumed to be monotonic over the values of these events.
   * Negative events *can* be recorded, but sum should not be filled out when
   * doing so.  This is specifically to enforce compatibility w/ OpenMetrics,
   * see: https://github.com/prometheus/OpenMetrics/blob/v1.0.0/specification/OpenMetrics.md#summary
   */
  sum?: number | undefined;
  /**
   * (Optional) list of values at different quantiles of the distribution calculated
   * from the current snapshot. The quantiles must be strictly increasing.
   */
  quantileValues?: SummaryDataPoint_ValueAtQuantile[] | undefined;
  /**
   * Flags that apply to this specific data point.  See DataPointFlags
   * for the available flags and their meaning.
   */
  flags?: number | undefined;
}

/**
 * Represents the value at a given quantile of a distribution.
 *
 * To record Min and Max values following conventions are used:
 * - The 1.0 quantile is equivalent to the maximum value observed.
 * - The 0.0 quantile is equivalent to the minimum value observed.
 *
 * See the following issue for more context:
 * https://github.com/open-telemetry/opentelemetry-proto/issues/125
 */
export interface SummaryDataPoint_ValueAtQuantile {
  /**
   * The quantile of a distribution. Must be in the interval
   * [0.0, 1.0].
   */
  quantile?: number | undefined;
  /**
   * The value at the given quantile of a distribution.
   *
   * Quantile values must NOT be negative.
   */
  value?: number | undefined;
}

/**
 * A representation of an exemplar, which is a sample input measurement.
 * Exemplars also hold information about the environment when the measurement
 * was recorded, for example the span and trace ID of the active span when the
 * exemplar was recorded.
 */
export interface Exemplar {
  /**
   * The set of key/value pairs that were filtered out by the aggregator, but
   * recorded alongside the original measurement. Only key/value pairs that were
   * filtered out by the aggregator should be included
   */
  filteredAttributes?: KeyValue[] | undefined;
  /**
   * time_unix_nano is the exact time when this exemplar was recorded
   *
   * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
   * 1970.
   */
  timeUnixNano?: string | undefined;
  asDouble?: number | undefined;
  asInt?: string | undefined;
  /**
   * (Optional) Span ID of the exemplar trace.
   * span_id may be missing if the measurement is not recorded inside a trace
   * or if the trace is not sampled.
   */
  spanId?: string | undefined;
  /**
   * (Optional) Trace ID of the exemplar trace.
   * trace_id may be missing if the measurement is not recorded inside a trace
   * or if the trace is not sampled.
   */
  traceId?: Uint8Array | undefined;
}
