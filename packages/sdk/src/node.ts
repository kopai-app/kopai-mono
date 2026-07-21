/**
 * Node-only entry point: `@kopai/sdk/node`.
 *
 * Reads `.kopairc` and builds a configured {@link KopaiClient}. This lives in a
 * separate subpath — not the package root — because the root entry is
 * platform-neutral (browser-safe) and must not depend on `node:fs`/`node:os`.
 *
 * This module is the single source of truth for `.kopairc` resolution:
 * `@kopai/cli` re-exports {@link loadConfig} and delegates its connection
 * resolution here, so the CLI and code-mode scripts read config identically.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KopaiClient } from "./client.js";
import type { KopaiClientOptions } from "./types.js";

/** Parsed contents of a `.kopairc` file. */
export interface KopaiConfig {
  url?: string;
  token?: string;
}

export const CONFIG_FILENAME = ".kopairc";
export const DEFAULT_URL = "http://localhost:8000";

function loadConfigFile(path: string): KopaiConfig | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as KopaiConfig;
  } catch {
    return null;
  }
}

/**
 * Load `.kopairc`. Priority: explicit `configPath` > `./.kopairc` >
 * `~/.kopairc`. Returns `{}` when none is found or parsing fails.
 */
export function loadConfig(configPath?: string): KopaiConfig {
  const paths = configPath
    ? [configPath]
    : [join(process.cwd(), CONFIG_FILENAME), join(homedir(), CONFIG_FILENAME)];

  for (const path of paths) {
    const config = loadConfigFile(path);
    if (config) return config;
  }

  return {};
}

/** Explicit connection overrides; each wins over the `.kopairc` file. */
export interface ResolveConnectionOptions {
  /** Explicit base URL; overrides the config file. */
  url?: string;
  /** Explicit auth token; overrides the config file. */
  token?: string;
  /** Explicit `.kopairc` path; overrides the `./` then `~/` lookup. */
  configPath?: string;
}

/** Resolved connection: normalized base URL + optional token. */
export interface ResolvedConnection {
  url: string;
  token: string | undefined;
}

/**
 * Resolve the connection from explicit options and `.kopairc`.
 * Precedence: `url` > config file > {@link DEFAULT_URL}. A trailing `/signals`
 * (and any trailing slash) is stripped from the URL.
 */
export function resolveConnection(
  opts: ResolveConnectionOptions = {}
): ResolvedConnection {
  const fileConfig = loadConfig(opts.configPath);
  const raw = opts.url ?? fileConfig.url ?? DEFAULT_URL;
  const url = raw.replace(/\/signals\/?$/, "").replace(/\/$/, "");
  return {
    url,
    token: opts.token ?? fileConfig.token,
  };
}

/** Options for {@link clientFromConfig}: connection inputs + client tunables. */
export interface ClientFromConfigOptions
  extends
    ResolveConnectionOptions,
    Pick<KopaiClientOptions, "headers" | "fetch" | "timeout"> {}

/**
 * Build a {@link KopaiClient} from `.kopairc` plus explicit overrides, using the
 * same resolution `@kopai/cli` applies. Intended for code-mode scripts:
 *
 * ```ts
 * import { clientFromConfig } from "@kopai/sdk/node";
 * const client = clientFromConfig();
 * ```
 */
export function clientFromConfig(
  opts: ClientFromConfigOptions = {}
): KopaiClient {
  const { url, token } = resolveConnection(opts);
  return new KopaiClient({
    baseUrl: url,
    token,
    headers: opts.headers,
    fetch: opts.fetch,
    timeout: opts.timeout,
  });
}
