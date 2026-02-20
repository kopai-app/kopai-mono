import { Command } from "commander";
import {
  createClient,
  parseAttributes,
  withConnectionOptions,
  type ClientOptions,
} from "../client.js";
import { detectFormat, output, outputError, parseFields } from "../output.js";

interface TracesGetOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
}

interface TracesSearchOptions extends ClientOptions {
  json?: boolean;
  table?: boolean;
  fields?: string;
  limit?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  service?: string;
  spanName?: string;
  spanKind?: string;
  statusCode?: string;
  scope?: string;
  timestampMin?: string;
  timestampMax?: string;
  durationMin?: string;
  durationMax?: string;
  spanAttr?: string[];
  resourceAttr?: string[];
  sort?: string;
}

export function createTracesCommand(): Command {
  const traces = new Command("traces").description("Query traces");

  withConnectionOptions(
    traces
      .command("get")
      .description("Get all spans for a trace by ID")
      .argument("<traceId>", "Trace ID")
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .option("-f, --fields <fields>", "Comma-separated fields to include")
  ).action(async (traceId: string, opts: TracesGetOptions) => {
    const format = detectFormat(opts.json, opts.table);
    const fields = parseFields(opts.fields);
    try {
      const client = createClient(opts);
      const spans = await client.getTrace(traceId);
      output(spans, { format, fields });
    } catch (err) {
      outputError(err, format === "json");
      process.exit(1);
    }
  });

  withConnectionOptions(
    traces
      .command("search")
      .description("Search traces")
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .option("-f, --fields <fields>", "Comma-separated fields to include")
      .option("-l, --limit <n>", "Max results")
      .option("--trace-id <id>", "Filter by trace ID")
      .option("--span-id <id>", "Filter by span ID")
      .option("--parent-span-id <id>", "Filter by parent span ID")
      .option("-s, --service <name>", "Filter by service name")
      .option("--span-name <name>", "Filter by span name")
      .option("--span-kind <kind>", "Filter by span kind")
      .option("--status-code <code>", "Filter by status code")
      .option("--scope <name>", "Filter by scope name")
      .option("--timestamp-min <ns>", "Min timestamp (nanoseconds)")
      .option("--timestamp-max <ns>", "Max timestamp (nanoseconds)")
      .option("--duration-min <ns>", "Min duration (nanoseconds)")
      .option("--duration-max <ns>", "Max duration (nanoseconds)")
      .option(
        "--span-attr <key=value>",
        "Span attribute filter (repeatable)",
        collect,
        []
      )
      .option(
        "--resource-attr <key=value>",
        "Resource attribute filter (repeatable)",
        collect,
        []
      )
      .option("--sort <order>", "Sort order (ASC|DESC)")
  ).action(async (opts: TracesSearchOptions) => {
    const format = detectFormat(opts.json, opts.table);
    const fields = parseFields(opts.fields);
    try {
      const client = createClient(opts);
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

      const filter = {
        traceId: opts.traceId,
        spanId: opts.spanId,
        parentSpanId: opts.parentSpanId,
        serviceName: opts.service,
        spanName: opts.spanName,
        spanKind: opts.spanKind,
        statusCode: opts.statusCode,
        scopeName: opts.scope,
        timestampMin: opts.timestampMin,
        timestampMax: opts.timestampMax,
        durationMin: opts.durationMin,
        durationMax: opts.durationMax,
        spanAttributes: parseAttributes(opts.spanAttr),
        resourceAttributes: parseAttributes(opts.resourceAttr),
        limit,
        sortOrder: opts.sort as "ASC" | "DESC" | undefined,
      };

      const result = await client.searchTracesPage(filter);
      output(result.data, { format, fields });
    } catch (err) {
      outputError(err, format === "json");
      process.exit(1);
    }
  });

  return traces;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
