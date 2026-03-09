import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_FILENAME = "update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CacheData {
  lastCheck: number;
  latestVersion: string | null;
}

interface CheckOptions {
  fetchFn?: typeof fetch;
}

export function getCacheDir(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Caches", "kopai");
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) return join(localAppData, "kopai", "cache");
      return join(homedir(), "AppData", "Local", "kopai", "cache");
    }
    default: {
      const xdg = process.env.XDG_CACHE_HOME;
      if (xdg) return join(xdg, "kopai");
      return join(homedir(), ".cache", "kopai");
    }
  }
}

export function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const parts = v.split(".").map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    return [parts[0]!, parts[1]!, parts[2]!];
  };
  const c = parse(current);
  const l = parse(latest);
  if (!c || !l) return false;
  if (l[0] !== c[0]) return l[0] > c[0];
  if (l[1] !== c[1]) return l[1] > c[1];
  return l[2] > c[2];
}

export function shouldCheck(): boolean {
  if (process.env.KOPAI_NO_UPDATE_CHECK) return false;
  if (process.env.CI || process.env.BUILD_NUMBER || process.env.RUN_ID)
    return false;
  if (!process.stderr.isTTY) return false;
  return true;
}

async function readCache(cacheDir: string): Promise<CacheData | null> {
  try {
    const raw = await readFile(join(cacheDir, CACHE_FILENAME), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.lastCheck !== "number") return null;
    const latestVersion =
      typeof parsed.latestVersion === "string" && parsed.latestVersion
        ? parsed.latestVersion
        : null;
    return { lastCheck: parsed.lastCheck, latestVersion };
  } catch {
    return null;
  }
}

async function writeCache(cacheDir: string, data: CacheData): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, CACHE_FILENAME), JSON.stringify(data));
  } catch {
    // ignore cache write failures
  }
}

async function fetchLatestVersion(
  fetchFn: typeof fetch
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetchFn("https://registry.npmjs.org/@kopai/cli/latest", {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data?.version !== "string" || !data.version.trim()) return null;
    return data.version;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function printNotice(current: string, latest: string): void {
  process.stderr.write(
    `\n  Update available: ${current} → ${latest}\n  Run: npx @kopai/cli@latest\n  Set KOPAI_NO_UPDATE_CHECK=1 to disable.\n\n`
  );
}

export async function checkForUpdates(
  currentVersion: string,
  opts?: CheckOptions
): Promise<void> {
  if (!shouldCheck()) return;

  const cacheDir = getCacheDir();
  const cache = await readCache(cacheDir);

  if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
    if (
      cache.latestVersion &&
      compareVersions(currentVersion, cache.latestVersion)
    ) {
      printNotice(currentVersion, cache.latestVersion);
    }
    return;
  }

  const fetchFn = opts?.fetchFn ?? fetch;
  const latest = await fetchLatestVersion(fetchFn);

  await writeCache(cacheDir, { lastCheck: Date.now(), latestVersion: latest });

  if (latest && compareVersions(currentVersion, latest)) {
    printNotice(currentVersion, latest);
  }
}
