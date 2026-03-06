import { Command } from "commander";
import {
  resolveConnectionOpts,
  withConnectionOptions,
  type ClientOptions,
} from "../client.js";
import { outputError } from "../output.js";

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

  return dashboards;
}
