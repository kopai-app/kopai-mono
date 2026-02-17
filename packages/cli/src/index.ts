#!/usr/bin/env node

import { Command } from "commander";
import { createTracesCommand } from "./commands/traces.js";
import { createLogsCommand } from "./commands/logs.js";
import { createMetricsCommand } from "./commands/metrics.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

program
  .name("@kopai/cli")
  .description("|--k> kopai - Query OpenTelemetry data")
  .version(pkg.version)
  .addCommand(createTracesCommand())
  .addCommand(createLogsCommand())
  .addCommand(createMetricsCommand());

program.parse();
