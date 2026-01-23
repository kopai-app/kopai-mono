import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  url?: string;
  token?: string;
}

const CONFIG_FILENAME = ".kopairc";

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
