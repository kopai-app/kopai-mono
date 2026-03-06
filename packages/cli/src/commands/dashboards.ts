import { Command } from "commander";
import {
  createClient,
  resolveConnectionOpts,
  withConnectionOptions,
  type ClientOptions,
} from "../client.js";
import { detectFormat, output, outputError } from "../output.js";

interface DashboardCreateOptions extends ClientOptions {
  name: string;
  treeVersion: string;
  json?: boolean;
  table?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function createDashboardsCommand(): Command {
  const dashboards = new Command("dashboards").description("Manage dashboards");

  withConnectionOptions(
    dashboards
      .command("schema")
      .description("Print UI tree schema for AI agents")
  ).action(async (opts: ClientOptions) => {
    try {
      const { url, token } = resolveConnectionOpts(opts);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(`${url}/dashboards/schema`, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const schema = await response.text();
      process.stdout.write(schema);
    } catch (err) {
      outputError(err, false);
      process.exit(1);
    }
  });

  withConnectionOptions(
    dashboards
      .command("create")
      .description("Create a dashboard (reads uiTree JSON from stdin)")
      .requiredOption("--name <name>", "Dashboard name")
      .requiredOption("--tree-version <semver>", "UI tree version (semver)")
      .option("-j, --json", "JSON output")
      .option("-t, --table", "Table output")
      .addHelpText(
        "after",
        `
Example:
  $ echo '{"uiTree":{"root":"s1","elements":{"s1":{"key":"s1","type":"Stack","props":{"direction":"vertical","gap":"md","align":null},"children":[],"parentKey":""}}}}' | kopai dashboards create --name "My Dashboard" --tree-version "0.5.0" --json`
      )
  ).action(async (opts: DashboardCreateOptions) => {
    const isJson = opts.json ?? false;
    try {
      const client = createClient(opts);
      const raw = await readStdin();
      const body = JSON.parse(raw) as Record<string, unknown>;

      const result = await client.createDashboard({
        name: opts.name,
        uiTreeVersion: opts.treeVersion,
        uiTree: (body.uiTree ?? body) as Record<string, unknown>,
        metadata: body.metadata as Record<string, unknown> | undefined,
      });

      const format = detectFormat(opts.json, opts.table);
      output(result, { format });
    } catch (err) {
      outputError(err, isJson);
      process.exit(1);
    }
  });

  return dashboards;
}
