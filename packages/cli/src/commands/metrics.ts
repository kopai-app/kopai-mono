import { Command, InvalidArgumentError } from "commander";
import {
  createClient,
  parseAttributes,
  withConnectionOptions,
  type ClientOptions,
} from "../client.js";
import { detectFormat, output, outputError, parseFields } from "../output.js";

interface MetricsSearchOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
  limit?: string;
  type: string;
  name?: string;
  service?: string;
  scope?: string;
  timeMin?: string;
  timeMax?: string;
  attr?: string[];
  resourceAttr?: string[];
  scopeAttr?: string[];
  sort?: string;
  aggregate?: string;
  groupBy?: string[];
  timeBucket?: string;
}

interface MetricsDiscoverOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
}

export function createMetricsCommand(): Command {
  const metrics = new Command("metrics").description("Query metrics");

  withConnectionOptions(
    metrics
      .command("search")
      .description("Search metrics")
      .requiredOption(
        "--type <type>",
        "Metric type (Gauge|Sum|Histogram|ExponentialHistogram|Summary)"
      )
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .option("-f, --fields <fields>", "Comma-separated fields to include")
      .option("-l, --limit <n>", "Max results")
      .option("-n, --name <name>", "Filter by metric name")
      .option("-s, --service <name>", "Filter by service name")
      .option("--scope <name>", "Filter by scope name")
      .option("--time-min <ns>", "Min time (nanoseconds)")
      .option("--time-max <ns>", "Max time (nanoseconds)")
      .option(
        "-a, --attr <key=value>",
        "Attribute filter (repeatable)",
        collect,
        []
      )
      .option(
        "--resource-attr <key=value>",
        "Resource attribute filter (repeatable)",
        collect,
        []
      )
      .option(
        "--scope-attr <key=value>",
        "Scope attribute filter (repeatable)",
        collect,
        []
      )
      .option("--sort <order>", "Sort order (ASC|DESC)")
      .option(
        "--aggregate <fn>",
        "Aggregation function (sum|avg|min|max|count)"
      )
      .option(
        "--group-by <attr>",
        "Group by attribute key (repeatable)",
        collect,
        []
      )
      .option(
        "--time-bucket <interval>",
        "Bucket interval for timeseries output (1m|5m|1h|1d). Requires --aggregate and --group-by. Server caps results at 10000 rows; --limit is ignored."
      )
  ).action(async (opts: MetricsSearchOptions) => {
    const format = detectFormat(opts.json, opts.table);
    const fields = parseFields(opts.fields);
    try {
      const client = createClient(opts);
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
      const aggregate = toAggregateFn(opts.aggregate);
      const groupBy =
        opts.groupBy && opts.groupBy.length > 0 ? opts.groupBy : undefined;
      const timeBucket = toTimeBucket(opts.timeBucket);

      if (timeBucket && !aggregate) {
        throw new InvalidArgumentError("--time-bucket requires --aggregate");
      }
      if (timeBucket && !groupBy) {
        throw new InvalidArgumentError(
          "--time-bucket requires at least one --group-by"
        );
      }
      if (groupBy && !aggregate) {
        throw new InvalidArgumentError("--group-by requires --aggregate");
      }

      const filter = {
        metricType: opts.type as
          | "Gauge"
          | "Sum"
          | "Histogram"
          | "ExponentialHistogram"
          | "Summary",
        metricName: opts.name,
        serviceName: opts.service,
        scopeName: opts.scope,
        timeUnixMin: opts.timeMin,
        timeUnixMax: opts.timeMax,
        attributes: parseAttributes(opts.attr),
        resourceAttributes: parseAttributes(opts.resourceAttr),
        scopeAttributes: parseAttributes(opts.scopeAttr),
        limit,
        sortOrder: opts.sort as "ASC" | "DESC" | undefined,
        aggregate,
        groupBy,
      };

      if (timeBucket && aggregate && groupBy) {
        const result = await client.searchMetricsTimeSeries({
          ...filter,
          aggregate,
          groupBy,
          timeBucket,
        });
        output(formatTimeseriesRows(result.data), { format, fields });
      } else if (aggregate) {
        const result = await client.searchAggregatedMetrics({
          ...filter,
          aggregate,
        });
        output(result.data, { format, fields });
      } else {
        const result = await client.searchMetricsPage(filter);
        output(result.data, { format, fields });
      }
    } catch (err) {
      outputError(err, format === "json");
      process.exit(1);
    }
  });

  withConnectionOptions(
    metrics
      .command("discover")
      .description("List available metrics")
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .option("-f, --fields <fields>", "Comma-separated fields to include")
  ).action(async (opts: MetricsDiscoverOptions) => {
    const format = detectFormat(opts.json, opts.table);
    const fields = parseFields(opts.fields);
    try {
      const client = createClient(opts);
      const result = await client.discoverMetrics();
      output(result.metrics, { format, fields });
    } catch (err) {
      outputError(err, format === "json");
      process.exit(1);
    }
  });

  return metrics;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

type AggregateFn = "sum" | "avg" | "min" | "max" | "count";

function isAggregateFn(value: string): value is AggregateFn {
  return (
    value === "sum" ||
    value === "avg" ||
    value === "min" ||
    value === "max" ||
    value === "count"
  );
}

function toAggregateFn(value: string | undefined): AggregateFn | undefined {
  if (value === undefined) return undefined;
  if (isAggregateFn(value)) return value;
  throw new InvalidArgumentError(`Invalid aggregate function: ${value}`);
}

type TimeBucket = "1m" | "5m" | "1h" | "1d";

function isTimeBucket(value: string): value is TimeBucket {
  return value === "1m" || value === "5m" || value === "1h" || value === "1d";
}

function toTimeBucket(value: string | undefined): TimeBucket | undefined {
  if (value === undefined) return undefined;
  if (isTimeBucket(value)) return value;
  throw new InvalidArgumentError(
    `Invalid time bucket: ${value}. Allowed: 1m, 5m, 1h, 1d.`
  );
}

// Flatten { groups: { k1: v1 }, timeBucketNs, value } -> { k1, timeBucketNs, value }
// so that `--table` output renders one column per group key followed by
// `timeBucketNs` and `value`.
function formatTimeseriesRows(
  rows: Array<{
    groups: Record<string, unknown>;
    timeBucketNs: string;
    value: number;
  }>
): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    ...row.groups,
    timeBucketNs: row.timeBucketNs,
    value: row.value,
  }));
}
