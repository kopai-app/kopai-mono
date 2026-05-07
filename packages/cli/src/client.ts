import type { Command } from "commander";
import { KopaiClient } from "@kopai/sdk";
import { loadConfig, DEFAULT_URL } from "./config.js";

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

export interface ConnectionOpts {
  url: string;
  token: string | undefined;
}

export function resolveConnectionOpts(opts: ClientOptions): ConnectionOpts {
  const fileConfig = loadConfig(opts.config);
  const raw = opts.url ?? fileConfig.url ?? DEFAULT_URL;
  const url = raw.replace(/\/signals\/?$/, "").replace(/\/$/, "");
  return {
    url,
    token: opts.token ?? fileConfig.token,
  };
}

export function createClient(opts: ClientOptions): KopaiClient {
  const { url, token } = resolveConnectionOpts(opts);

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
