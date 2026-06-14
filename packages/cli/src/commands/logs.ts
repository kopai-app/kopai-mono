import { Command, InvalidArgumentError } from "commander";
import {
  createClient,
  parseAttributes,
  withConnectionOptions,
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
  aggregate?: string;
  groupBy?: string[];
}

export function createLogsCommand(): Command {
  const logs = new Command("logs").description("Query logs");

  withConnectionOptions(
    logs
      .command("search")
      .description("Search logs")
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .option("-f, --fields <fields>", "Comma-separated fields to include")
      .option("-l, --limit <n>", "Max results (ignored in aggregate mode)")
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
      .option(
        "--aggregate <fn>",
        "Aggregation function. Only 'count' is supported for logs. Server caps results at 1000 groups; --limit is ignored."
      )
      .option(
        "--group-by <attr>",
        "Group by attribute key (repeatable). Required when --aggregate is set.",
        collect,
        []
      )
  ).action(async (opts: LogsSearchOptions) => {
    const format = detectFormat(opts.json, opts.table);
    const fields = parseFields(opts.fields);
    try {
      const client = createClient(opts);
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
      const aggregate = toAggregateFn(opts.aggregate);
      const groupBy =
        opts.groupBy && opts.groupBy.length > 0 ? opts.groupBy : undefined;

      if (aggregate && !groupBy) {
        throw new InvalidArgumentError(
          "--aggregate requires at least one --group-by"
        );
      }
      if (groupBy && !aggregate) {
        throw new InvalidArgumentError("--group-by requires --aggregate");
      }

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
        aggregate,
        groupBy,
      };

      if (aggregate && groupBy) {
        const result = await client.searchLogsAggregate({
          ...filter,
          aggregate,
          groupBy,
        });
        output(formatAggregatedRows(result.data), { format, fields });
      } else {
        const result = await client.searchLogsPage(filter);
        output(result.data, { format, fields });
      }
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

type AggregateFn = "count";

function isAggregateFn(value: string): value is AggregateFn {
  return value === "count";
}

function toAggregateFn(value: string | undefined): AggregateFn | undefined {
  if (value === undefined) return undefined;
  if (isAggregateFn(value)) return value;
  throw new InvalidArgumentError(
    `Invalid aggregate function for logs: ${value}. Only 'count' is supported.`
  );
}

// Flatten { groups: { k1: v1, k2: v2 }, value } -> { k1, k2, value } so that
// `--table` output renders one column per group key followed by `value`.
function formatAggregatedRows(
  rows: Array<{ groups: Record<string, unknown>; value: number }>
): Array<Record<string, unknown>> {
  return rows.map((row) => ({ ...row.groups, value: row.value }));
}
