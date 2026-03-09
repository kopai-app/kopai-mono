#!/usr/bin/env node

import { Command } from "commander";
import { createTracesCommand } from "./commands/traces.js";
import { createLogsCommand } from "./commands/logs.js";
import { createMetricsCommand } from "./commands/metrics.js";
import { createDashboardsCommand } from "./commands/dashboards.js";
import { createLoginCommand } from "./commands/login.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createWhoamiCommand } from "./commands/whoami.js";
import { checkForUpdates } from "./update-check.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("@kopai/cli")
  .description("|--k> kopai - Query OpenTelemetry data")
  .version(pkg.version)
  .addCommand(createTracesCommand())
  .addCommand(createLogsCommand())
  .addCommand(createMetricsCommand())
  .addCommand(createDashboardsCommand())
  .addCommand(createLoginCommand())
  .addCommand(createLogoutCommand())
  .addCommand(createWhoamiCommand())
  .addHelpText(
    "after",
    `
Examples:
  $ kopai traces search                                          # localhost:8000 (default, for @kopai/app running locally)
  $ kopai traces search --url https://example.com                # remote instance
  $ kopai logs search --url https://example.com --token kpi_…    # with auth`
  );

program.parse();
void checkForUpdates(pkg.version);
