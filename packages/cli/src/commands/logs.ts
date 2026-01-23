import { Command } from "commander";
import {
  createClient,
  parseAttributes,
  type ClientOptions,
} from "../client.js";
import { detectFormat, output, outputError, parseFields } from "../output.js";

interface LogsSearchOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
  limit?: string;
  traceId?: string;
  spanId?: string;
  service?: string;
  scope?: string;
  severityText?: string;
  severityMin?: string;
  severityMax?: string;
  body?: string;
  timestampMin?: string;
  timestampMax?: string;
  logAttr?: string[];
  resourceAttr?: string[];
  scopeAttr?: string[];
  sort?: string;
}

export function createLogsCommand(): Command {
  const logs = new Command("logs").description("Query logs");

  logs
    .command("search")
    .description("Search logs")
    .option("-j, --json", "JSON output")
    .option("-t, --table", "Table output")
    .option("-f, --fields <fields>", "Comma-separated fields to include")
    .option("-l, --limit <n>", "Max results")
    .option("--trace-id <id>", "Filter by trace ID")
    .option("--span-id <id>", "Filter by span ID")
    .option("-s, --service <name>", "Filter by service name")
    .option("--scope <name>", "Filter by scope name")
    .option("--severity-text <level>", "Filter by severity text")
    .option("--severity-min <n>", "Min severity number")
    .option("--severity-max <n>", "Max severity number")
    .option("-b, --body <text>", "Filter by body contains")
    .option("--timestamp-min <ns>", "Min timestamp (nanoseconds)")
    .option("--timestamp-max <ns>", "Max timestamp (nanoseconds)")
    .option(
      "--log-attr <key=value>",
      "Log attribute filter (repeatable)",
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
    .action(async (opts: LogsSearchOptions) => {
      const format = detectFormat(opts.json, opts.table);
      const fields = parseFields(opts.fields);
      try {
        const client = createClient(opts);
        const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

        const filter = {
          traceId: opts.traceId,
          spanId: opts.spanId,
          serviceName: opts.service,
          scopeName: opts.scope,
          severityText: opts.severityText,
          severityNumberMin: opts.severityMin
            ? parseInt(opts.severityMin, 10)
            : undefined,
          severityNumberMax: opts.severityMax
            ? parseInt(opts.severityMax, 10)
            : undefined,
          bodyContains: opts.body,
          timestampMin: opts.timestampMin,
          timestampMax: opts.timestampMax,
          logAttributes: parseAttributes(opts.logAttr),
          resourceAttributes: parseAttributes(opts.resourceAttr),
          scopeAttributes: parseAttributes(opts.scopeAttr),
          limit,
          sortOrder: opts.sort as "ASC" | "DESC" | undefined,
        };

        const result = await client.searchLogsPage(filter);
        output(result.data, { format, fields });
      } catch (err) {
        outputError(err, format === "json");
        process.exit(1);
      }
    });

  return logs;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
