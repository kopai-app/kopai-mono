import type { Command } from "commander";
import { KopaiClient } from "@kopai/sdk";
import { loadConfig } from "./config.js";

export function withConnectionOptions<T extends Command>(cmd: T): T {
  return cmd
    .option("--url <url>", "API base URL")
    .option("--token <token>", "Auth token")
    .option("-c, --config <path>", "Config file path")
    .option("--timeout <ms>", "Request timeout") as T;
}

export interface ClientOptions {
  config?: string;
  url?: string;
  token?: string;
  timeout?: number;
}

const DEFAULT_URL = "http://localhost:8000/signals";

export function createClient(opts: ClientOptions): KopaiClient {
  const fileConfig = loadConfig(opts.config);

  const url = opts.url ?? fileConfig.url ?? DEFAULT_URL;
  const token = opts.token ?? fileConfig.token;

  const timeout =
    opts.timeout != null ? parseInt(String(opts.timeout), 10) : undefined;

  return new KopaiClient({
    baseUrl: url,
    token,
    timeout: Number.isNaN(timeout) ? undefined : timeout,
  });
}

export function parseAttributes(attrs?: string[]): Record<string, string> {
  if (!attrs || attrs.length === 0) return {};
  const result: Record<string, string> = {};
  for (const attr of attrs) {
    const idx = attr.indexOf("=");
    if (idx === -1) {
      console.error(`Invalid attribute format: ${attr}. Use key=value`);
      process.exit(2);
    }
    result[attr.slice(0, idx)] = attr.slice(idx + 1);
  }
  return result;
}
