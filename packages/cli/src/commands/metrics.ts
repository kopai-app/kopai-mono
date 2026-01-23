import { Command } from "commander";
import {
  createClient,
  parseAttributes,
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
}

interface MetricsDiscoverOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
}

export function createMetricsCommand(): Command {
  const metrics = new Command("metrics").description("Query metrics");

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
    .option("--timeout <ms>", "Request timeout")
    .option("-c, --config <path>", "Config file path")
    .option("--url <url>", "API base URL")
    .option("--token <token>", "Auth token")
    .action(async (opts: MetricsSearchOptions) => {
      const format = detectFormat(opts.json, opts.table);
      const fields = parseFields(opts.fields);
      try {
        const client = createClient(opts);
        const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

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
        };

        const result = await client.searchMetricsPage(filter);
        output(result.data, { format, fields });
      } catch (err) {
        outputError(err, format === "json");
        process.exit(1);
      }
    });

  metrics
    .command("discover")
    .description("List available metrics")
    .option("-j, --json", "JSON output")
    .option("-t, --table", "Table output")
    .option("-f, --fields <fields>", "Comma-separated fields to include")
    .option("--timeout <ms>", "Request timeout")
    .option("-c, --config <path>", "Config file path")
    .option("--url <url>", "API base URL")
    .option("--token <token>", "Auth token")
    .action(async (opts: MetricsDiscoverOptions) => {
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
