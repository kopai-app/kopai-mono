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
import { DEFAULT_URL } from "./config.js";
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
  $ kopai login                                                  # save a token for the hosted default (requires auth)
  $ kopai traces search                                          # ${DEFAULT_URL} (default, requires auth)
  $ kopai traces search --url http://localhost:8000              # local @kopai/app, no auth
  $ kopai logs search --url https://example.com --token kpi_…    # custom instance

Run "kopai login" once to authenticate against ${DEFAULT_URL}, or pass --url http://localhost:8000 to target a local @kopai/app.`
  );

program.parse();
void checkForUpdates(pkg.version);
