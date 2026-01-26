#!/usr/bin/env node
import { parseArgs } from "node:util";
import { version } from "./version.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const command = positionals[0];

function showHelp() {
  console.log(`
@kopai/app v${version} - OpenTelemetry collector and API server

Usage: npx @kopai/app <command>

Commands:
  start    Start the server
  help     Show this help message

Options:
  -h, --help     Show this help message
  -v, --version  Show version

Environment:
  SQLITE_DB_FILE_PATH  Path to SQLite database (default: :memory:)
  PORT                 API server port (default: 8000)
  HOST                 Host to bind (default: localhost)
`);
}

if (values.version) {
  console.log(version);
  process.exit(0);
}

if (values.help || command === "help" || !command) {
  showHelp();
  process.exit(0);
}

if (command === "start") {
  import("./server.js");
} else {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}
