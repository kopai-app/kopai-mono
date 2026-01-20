import { z } from "zod";
import {
  type MetricsData,
  type ResourceMetrics,
  type ScopeMetrics,
  type Metric,
  type Gauge,
  type Sum,
  type Histogram,
  type ExponentialHistogram,
  type Summary,
  type NumberDataPoint,
  type HistogramDataPoint,
  type ExponentialHistogramDataPoint,
  type ExponentialHistogramDataPoint_Buckets,
  type SummaryDataPoint,
  type SummaryDataPoint_ValueAtQuantile,
  type Exemplar,
} from "./otlp-metrics-generated.js";
import {
  keyValueSchema,
  instrumentationScopeSchema,
  resourceSchema,
  aggregationTemporalitySchema,
} from "./otlp-zod.js";

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
export const summaryDataPointValueAtQuantileSchema: z.ZodSchema<SummaryDataPoint_ValueAtQuantile> =
  z.object({
    /**
     * The quantile of a distribution. Must be in the interval
     * [0.0, 1.0].
     */
    quantile: z.union([z.number(), z.undefined()]).optional(),
    /**
     * The value at the given quantile of a distribution.
     *
     * Quantile values must NOT be negative.
     */
    value: z.union([z.number(), z.undefined()]).optional(),
  });

/**
 * Buckets are a set of bucket counts, encoded in a contiguous array
 * of counts.
 */
export const exponentialHistogramDataPointBucketsSchema: z.ZodSchema<ExponentialHistogramDataPoint_Buckets> =
  z.object({
    /**
     * The bucket index of the first entry in the bucket_counts array.
     *
     * Note: This uses a varint encoding as a simple form of compression.
     */
    offset: z.union([z.number(), z.undefined()]).optional(),
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
    bucketCounts: z
      .union([z.array(z.union([z.string(), z.number()])), z.undefined()])
      .optional(),
  });

/**
 * A representation of an exemplar, which is a sample input measurement.
 * Exemplars also hold information about the environment when the measurement
 * was recorded, for example the span and trace ID of the active span when the
 * exemplar was recorded.
 */
export const exemplarSchema: z.ZodSchema<Exemplar> = z.lazy(() =>
  z.object({
    /**
     * The set of key/value pairs that were filtered out by the aggregator, but
     * recorded alongside the original measurement. Only key/value pairs that were
     * filtered out by the aggregator should be included
     */
    filteredAttributes: z
      .union([z.array(keyValueSchema), z.undefined()])
      .optional(),
    /**
     * time_unix_nano is the exact time when this exemplar was recorded
     *
     * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
     * 1970.
     */
    timeUnixNano: z.union([z.string(), z.undefined()]).optional(),
    asDouble: z.union([z.number(), z.undefined()]).optional(),
    asInt: z.union([z.string(), z.undefined()]).optional(),
    /**
     * (Optional) Span ID of the exemplar trace.
     * span_id may be missing if the measurement is not recorded inside a trace
     * or if the trace is not sampled.
     */
    spanId: z.union([z.string(), z.undefined()]).optional(),
    /**
     * (Optional) Trace ID of the exemplar trace.
     * trace_id may be missing if the measurement is not recorded inside a trace
     * or if the trace is not sampled.
     */
    traceId: z.union([z.instanceof(Uint8Array), z.undefined()]).optional(),
  })
);

/**
 * NumberDataPoint is a single data point in a timeseries that describes the
 * time-varying scalar value of a metric.
 */
export const numberDataPointSchema: z.ZodSchema<NumberDataPoint> = z.lazy(() =>
  z.object({
    /**
     * The set of key/value pairs that uniquely identify the timeseries from
     * where this point belongs. The list may be empty (may contain 0 elements).
     * Attribute keys MUST be unique (it is not allowed to have more than one
     * attribute with the same key).
     * The behavior of software that receives duplicated keys can be unpredictable.
     */
    attributes: z.union([z.array(keyValueSchema), z.undefined()]).optional(),
    /**
     * StartTimeUnixNano is optional but strongly encouraged, see the
     * the detailed comments above Metric.
     *
     * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
     * 1970.
     */
    startTimeUnixNano: z.union([z.string(), z.undefined()]).optional(),
    /**
     * TimeUnixNano is required, see the detailed comments above Metric.
     *
     * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
     * 1970.
     */
    timeUnixNano: z.union([z.string(), z.undefined()]).optional(),
    asDouble: z.union([z.number(), z.undefined()]).optional(),
    asInt: z.union([z.string(), z.undefined()]).optional(),
    /**
     * (Optional) List of exemplars collected from
     * measurements that were used to form the data point
     */
    exemplars: z.union([z.array(exemplarSchema), z.undefined()]).optional(),
    /**
     * Flags that apply to this specific data point.  See DataPointFlags
     * for the available flags and their meaning.
     */
    flags: z.union([z.number(), z.undefined()]).optional(),
  })
);

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
export const histogramDataPointSchema: z.ZodSchema<HistogramDataPoint> = z.lazy(
  () =>
    z.object({
      /**
       * The set of key/value pairs that uniquely identify the timeseries from
       * where this point belongs. The list may be empty (may contain 0 elements).
       * Attribute keys MUST be unique (it is not allowed to have more than one
       * attribute with the same key).
       * The behavior of software that receives duplicated keys can be unpredictable.
       */
      attributes: z.union([z.array(keyValueSchema), z.undefined()]).optional(),
      /**
       * StartTimeUnixNano is optional but strongly encouraged, see the
       * the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      startTimeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /**
       * TimeUnixNano is required, see the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      timeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /**
       * count is the number of values in the population. Must be non-negative. This
       * value must be equal to the sum of the "count" fields in buckets if a
       * histogram is provided.
       */
      count: z.union([z.string(), z.number(), z.undefined()]).optional(),
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
      sum: z.union([z.number(), z.undefined()]).optional(),
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
      bucketCounts: z
        .union([z.array(z.union([z.string(), z.number()])), z.undefined()])
        .optional(),
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
      explicitBounds: z.union([z.array(z.number()), z.undefined()]).optional(),
      /**
       * (Optional) List of exemplars collected from
       * measurements that were used to form the data point
       */
      exemplars: z.union([z.array(exemplarSchema), z.undefined()]).optional(),
      /**
       * Flags that apply to this specific data point.  See DataPointFlags
       * for the available flags and their meaning.
       */
      flags: z.union([z.number(), z.undefined()]).optional(),
      /** min is the minimum value over (start_time, end_time]. */
      min: z.union([z.number(), z.undefined()]).optional(),
      /** max is the maximum value over (start_time, end_time]. */
      max: z.union([z.number(), z.undefined()]).optional(),
    })
);

/**
 * ExponentialHistogramDataPoint is a single data point in a timeseries that describes the
 * time-varying values of a ExponentialHistogram of double values. A ExponentialHistogram contains
 * summary statistics for a population of values, it may optionally contain the
 * distribution of those values across a set of buckets.
 */
export const exponentialHistogramDataPointSchema: z.ZodSchema<ExponentialHistogramDataPoint> =
  z.lazy(() =>
    z.object({
      /**
       * The set of key/value pairs that uniquely identify the timeseries from
       * where this point belongs. The list may be empty (may contain 0 elements).
       * Attribute keys MUST be unique (it is not allowed to have more than one
       * attribute with the same key).
       * The behavior of software that receives duplicated keys can be unpredictable.
       */
      attributes: z.union([z.array(keyValueSchema), z.undefined()]).optional(),
      /**
       * StartTimeUnixNano is optional but strongly encouraged, see the
       * the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      startTimeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /**
       * TimeUnixNano is required, see the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      timeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /**
       * The number of values in the population. Must be
       * non-negative. This value must be equal to the sum of the "bucket_counts"
       * values in the positive and negative Buckets plus the "zero_count" field.
       */
      count: z.union([z.string(), z.number(), z.undefined()]).optional(),
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
      sum: z.union([z.number(), z.undefined()]).optional(),
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
      scale: z.union([z.number(), z.undefined()]).optional(),
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
      zeroCount: z.union([z.string(), z.number(), z.undefined()]).optional(),
      /** positive carries the positive range of exponential bucket counts. */
      positive: z
        .union([exponentialHistogramDataPointBucketsSchema, z.undefined()])
        .optional(),
      /** negative carries the negative range of exponential bucket counts. */
      negative: z
        .union([exponentialHistogramDataPointBucketsSchema, z.undefined()])
        .optional(),
      /**
       * Flags that apply to this specific data point.  See DataPointFlags
       * for the available flags and their meaning.
       */
      flags: z.union([z.number(), z.undefined()]).optional(),
      /**
       * (Optional) List of exemplars collected from
       * measurements that were used to form the data point
       */
      exemplars: z.union([z.array(exemplarSchema), z.undefined()]).optional(),
      /** The minimum value over (start_time, end_time]. */
      min: z.union([z.number(), z.undefined()]).optional(),
      /** The maximum value over (start_time, end_time]. */
      max: z.union([z.number(), z.undefined()]).optional(),
      /**
       * ZeroThreshold may be optionally set to convey the width of the zero
       * region. Where the zero region is defined as the closed interval
       * [-ZeroThreshold, ZeroThreshold].
       * When ZeroThreshold is 0, zero count bucket stores values that cannot be
       * expressed using the standard exponential formula as well as values that
       * have been rounded to zero.
       */
      zeroThreshold: z.union([z.number(), z.undefined()]).optional(),
    })
  );

/**
 * SummaryDataPoint is a single data point in a timeseries that describes the
 * time-varying values of a Summary metric. The count and sum fields represent
 * cumulative values.
 */
export const summaryDataPointSchema: z.ZodSchema<SummaryDataPoint> = z.lazy(
  () =>
    z.object({
      /**
       * The set of key/value pairs that uniquely identify the timeseries from
       * where this point belongs. The list may be empty (may contain 0 elements).
       * Attribute keys MUST be unique (it is not allowed to have more than one
       * attribute with the same key).
       * The behavior of software that receives duplicated keys can be unpredictable.
       */
      attributes: z.union([z.array(keyValueSchema), z.undefined()]).optional(),
      /**
       * StartTimeUnixNano is optional but strongly encouraged, see the
       * the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      startTimeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /**
       * TimeUnixNano is required, see the detailed comments above Metric.
       *
       * Value is UNIX Epoch time in nanoseconds since 00:00:00 UTC on 1 January
       * 1970.
       */
      timeUnixNano: z.union([z.string(), z.undefined()]).optional(),
      /** count is the number of values in the population. Must be non-negative. */
      count: z.union([z.string(), z.number(), z.undefined()]).optional(),
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
      sum: z.union([z.number(), z.undefined()]).optional(),
      /**
       * (Optional) list of values at different quantiles of the distribution calculated
       * from the current snapshot. The quantiles must be strictly increasing.
       */
      quantileValues: z
        .union([z.array(summaryDataPointValueAtQuantileSchema), z.undefined()])
        .optional(),
      /**
       * Flags that apply to this specific data point.  See DataPointFlags
       * for the available flags and their meaning.
       */
      flags: z.union([z.number(), z.undefined()]).optional(),
    })
);

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
export const gaugeSchema: z.ZodSchema<Gauge> = z.lazy(() =>
  z.object({
    /**
     * The time series data points.
     * Note: Multiple time series may be included (same timestamp, different attributes).
     */
    dataPoints: z
      .union([z.array(numberDataPointSchema), z.undefined()])
      .optional(),
  })
);

/**
 * Sum represents the type of a scalar metric that is calculated as a sum of all
 * reported measurements over a time interval.
 */
export const sumSchema: z.ZodSchema<Sum> = z.lazy(() =>
  z.object({
    /**
     * The time series data points.
     * Note: Multiple time series may be included (same timestamp, different attributes).
     */
    dataPoints: z
      .union([z.array(numberDataPointSchema), z.undefined()])
      .optional(),
    /**
     * aggregation_temporality describes if the aggregator reports delta changes
     * since last report time, or cumulative changes since a fixed start time.
     */
    aggregationTemporality: z
      .union([aggregationTemporalitySchema, z.undefined()])
      .optional(),
    /** Represents whether the sum is monotonic. */
    isMonotonic: z.union([z.boolean(), z.undefined()]).optional(),
  })
);

/**
 * Histogram represents the type of a metric that is calculated by aggregating
 * as a Histogram of all reported measurements over a time interval.
 */
export const histogramSchema: z.ZodSchema<Histogram> = z.lazy(() =>
  z.object({
    /**
     * The time series data points.
     * Note: Multiple time series may be included (same timestamp, different attributes).
     */
    dataPoints: z
      .union([z.array(histogramDataPointSchema), z.undefined()])
      .optional(),
    /**
     * aggregation_temporality describes if the aggregator reports delta changes
     * since last report time, or cumulative changes since a fixed start time.
     */
    aggregationTemporality: z
      .union([aggregationTemporalitySchema, z.undefined()])
      .optional(),
  })
);

/**
 * ExponentialHistogram represents the type of a metric that is calculated by aggregating
 * as a ExponentialHistogram of all reported double measurements over a time interval.
 */
export const exponentialHistogramSchema: z.ZodSchema<ExponentialHistogram> =
  z.lazy(() =>
    z.object({
      /**
       * The time series data points.
       * Note: Multiple time series may be included (same timestamp, different attributes).
       */
      dataPoints: z
        .union([z.array(exponentialHistogramDataPointSchema), z.undefined()])
        .optional(),
      /**
       * aggregation_temporality describes if the aggregator reports delta changes
       * since last report time, or cumulative changes since a fixed start time.
       */
      aggregationTemporality: z
        .union([aggregationTemporalitySchema, z.undefined()])
        .optional(),
    })
  );

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
export const summarySchema: z.ZodSchema<Summary> = z.lazy(() =>
  z.object({
    /**
     * The time series data points.
     * Note: Multiple time series may be included (same timestamp, different attributes).
     */
    dataPoints: z
      .union([z.array(summaryDataPointSchema), z.undefined()])
      .optional(),
  })
);

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
export const metricSchema: z.ZodSchema<Metric> = z.lazy(() =>
  z.object({
    /** The name of the metric. */
    name: z.union([z.string(), z.undefined()]).optional(),
    /** A description of the metric, which can be used in documentation. */
    description: z.union([z.string(), z.undefined()]).optional(),
    /**
     * The unit in which the metric value is reported. Follows the format
     * described by https://unitsofmeasure.org/ucum.html.
     */
    unit: z.union([z.string(), z.undefined()]).optional(),
    gauge: z.union([gaugeSchema, z.undefined()]).optional(),
    sum: z.union([sumSchema, z.undefined()]).optional(),
    histogram: z.union([histogramSchema, z.undefined()]).optional(),
    exponentialHistogram: z
      .union([exponentialHistogramSchema, z.undefined()])
      .optional(),
    summary: z.union([summarySchema, z.undefined()]).optional(),
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
    metadata: z.union([z.array(keyValueSchema), z.undefined()]).optional(),
  })
);

/** A collection of Metrics produced by an Scope. */
export const scopeMetricsSchema: z.ZodSchema<ScopeMetrics> = z.lazy(() =>
  z.object({
    /**
     * The instrumentation scope information for the metrics in this message.
     * Semantically when InstrumentationScope isn't set, it is equivalent with
     * an empty instrumentation scope name (unknown).
     */
    scope: z.union([instrumentationScopeSchema, z.undefined()]).optional(),
    /** A list of metrics that originate from an instrumentation library. */
    metrics: z.union([z.array(metricSchema), z.undefined()]).optional(),
    /**
     * The Schema URL, if known. This is the identifier of the Schema that the metric data
     * is recorded in. Notably, the last part of the URL path is the version number of the
     * schema: http[s]://server[:port]/path/<version>. To learn more about Schema URL see
     * https://opentelemetry.io/docs/specs/otel/schemas/#schema-url
     * This schema_url applies to the data in the "scope" field and all metrics in the
     * "metrics" field.
     */
    schemaUrl: z.union([z.string(), z.undefined()]).optional(),
  })
);

/** A collection of ScopeMetrics from a Resource. */
export const resourceMetricsSchema: z.ZodSchema<ResourceMetrics> = z.lazy(() =>
  z.object({
    /**
     * The resource for the metrics in this message.
     * If this field is not set then no resource info is known.
     */
    resource: z.union([resourceSchema, z.undefined()]).optional(),
    /** A list of metrics that originate from a resource. */
    scopeMetrics: z
      .union([z.array(scopeMetricsSchema), z.undefined()])
      .optional(),
    /**
     * The Schema URL, if known. This is the identifier of the Schema that the resource data
     * is recorded in. Notably, the last part of the URL path is the version number of the
     * schema: http[s]://server[:port]/path/<version>. To learn more about Schema URL see
     * https://opentelemetry.io/docs/specs/otel/schemas/#schema-url
     * This schema_url applies to the data in the "resource" field. It does not apply
     * to the data in the "scope_metrics" field which have their own schema_url field.
     */
    schemaUrl: z.union([z.string(), z.undefined()]).optional(),
  })
);

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
export const metricsDataSchema: z.ZodSchema<MetricsData> = z.lazy(() =>
  z.object({
    /**
     * An array of ResourceMetrics.
     * For data coming from a single resource this array will typically contain
     * one element. Intermediary nodes that receive data from multiple origins
     * typically batch the data before forwarding further and in that case this
     * array will contain multiple elements.
     */
    resourceMetrics: z
      .union([z.array(resourceMetricsSchema), z.undefined()])
      .optional(),
  })
);
