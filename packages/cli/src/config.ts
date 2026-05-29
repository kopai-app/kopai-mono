import { readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadConfig,
  DEFAULT_URL,
  CONFIG_FILENAME,
  type KopaiConfig,
} from "@kopai/sdk/node";

// `.kopairc` reading lives in `@kopai/sdk/node` (the single source of truth for
// the config format, shared with code-mode scripts). Re-export the reader and
// constants; the write helpers below (used by `login`/`logout`) stay here.
export { loadConfig, DEFAULT_URL, CONFIG_FILENAME };
export type Config = KopaiConfig;

export const TOKEN_PREFIX_LENGTH = 10;

/** Owner read+write only (rw-------). Used for files containing secrets. */
const OWNER_READ_WRITE = 0o600;

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
  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n", {
    encoding: "utf-8",
    mode: OWNER_READ_WRITE,
  });
  chmodSync(targetPath, OWNER_READ_WRITE);
}

export function removeConfigToken(targetPath: string): boolean {
  if (!existsSync(targetPath)) return false;
  try {
    const content = readFileSync(targetPath, "utf-8");
    const config = JSON.parse(content) as Config;
    if (!config.token) return false;
    delete config.token;
    writeFileSync(targetPath, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf-8",
      mode: OWNER_READ_WRITE,
    });
  } catch {
    return false;
  }
  try {
    chmodSync(targetPath, OWNER_READ_WRITE);
  } catch {
    // chmod failure does not affect the successful token removal
  }
  return true;
}
