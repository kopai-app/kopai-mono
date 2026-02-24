import { readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  url?: string;
  token?: string;
}

export const CONFIG_FILENAME = ".kopairc";
export const TOKEN_PREFIX_LENGTH = 10;

/** Owner read+write only (rw-------). Used for files containing secrets. */
const OWNER_READ_WRITE = 0o600;

function loadConfigFile(path: string): Config | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Config;
  } catch {
    return null;
  }
}

export function loadConfig(configPath?: string): Config {
  // Priority: --config flag > ./.kopairc > ~/.kopairc
  const paths = configPath
    ? [configPath]
    : [join(process.cwd(), CONFIG_FILENAME), join(homedir(), CONFIG_FILENAME)];

  for (const path of paths) {
    const config = loadConfigFile(path);
    if (config) return config;
  }

  return {};
}

export function resolveConfigPath(global: boolean): string {
  return global
    ? join(homedir(), CONFIG_FILENAME)
    : join(process.cwd(), CONFIG_FILENAME);
}

export function saveConfig(updates: Partial<Config>, targetPath: string): void {
  let existing: Config = {};
  if (existsSync(targetPath)) {
    try {
      const content = readFileSync(targetPath, "utf-8");
      existing = JSON.parse(content) as Config;
    } catch {
      // ignore parse errors, overwrite
    }
  }
  const merged = { ...existing, ...updates };
  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  chmodSync(targetPath, OWNER_READ_WRITE);
}

export function removeConfigToken(targetPath: string): boolean {
  if (!existsSync(targetPath)) return false;
  try {
    const content = readFileSync(targetPath, "utf-8");
    const config = JSON.parse(content) as Config;
    if (!config.token) return false;
    delete config.token;
    writeFileSync(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    chmodSync(targetPath, OWNER_READ_WRITE);
    return true;
  } catch {
    return false;
  }
}
