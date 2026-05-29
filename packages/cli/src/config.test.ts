import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveConfig,
  resolveConfigPath,
  removeConfigToken,
  CONFIG_FILENAME,
} from "./config.js";
import * as fs from "node:fs";
import * as os from "node:os";

// `loadConfig` lives in (and is tested by) `@kopai/sdk/node`; `config.ts` only
// re-exports it. The CLI-owned write/path helpers are tested below.
vi.mock("node:fs");
vi.mock("node:os");

describe("resolveConfigPath", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns CWD path when global=false", () => {
    const result = resolveConfigPath(false);
    expect(result).toContain(CONFIG_FILENAME);
    expect(result).not.toContain("/home/user");
  });

  it("returns home directory path when global=true", () => {
    const result = resolveConfigPath(true);
    expect(result).toBe(`/home/user/${CONFIG_FILENAME}`);
  });
});

describe("saveConfig", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.chmodSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes new file when none exists", () => {
    saveConfig({ token: "abc123" }, "/tmp/.kopairc");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/.kopairc",
      JSON.stringify({ token: "abc123" }, null, 2) + "\n",
      { encoding: "utf-8", mode: 0o600 }
    );
  });

  it("merges into existing config (preserves url when writing token)", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://example.com" })
    );

    saveConfig({ token: "new-token" }, "/tmp/.kopairc");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/.kopairc",
      JSON.stringify(
        { url: "http://example.com", token: "new-token" },
        null,
        2
      ) + "\n",
      { encoding: "utf-8", mode: 0o600 }
    );
  });

  it("sets 0600 permissions via chmodSync", () => {
    saveConfig({ token: "abc" }, "/tmp/.kopairc");

    expect(fs.chmodSync).toHaveBeenCalledWith("/tmp/.kopairc", 0o600);
  });
});

describe("removeConfigToken", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.chmodSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes token and preserves url", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://example.com", token: "secret" })
    );

    const result = removeConfigToken("/tmp/.kopairc");

    expect(result).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/.kopairc",
      JSON.stringify({ url: "http://example.com" }, null, 2) + "\n",
      { encoding: "utf-8", mode: 0o600 }
    );
  });

  it("sets 0600 permissions after removing token", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://example.com", token: "secret" })
    );

    removeConfigToken("/tmp/.kopairc");

    expect(fs.chmodSync).toHaveBeenCalledWith("/tmp/.kopairc", 0o600);
  });

  it("returns false when no token exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://example.com" })
    );

    const result = removeConfigToken("/tmp/.kopairc");
    expect(result).toBe(false);
  });

  it("returns false when file does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = removeConfigToken("/tmp/.kopairc");
    expect(result).toBe(false);
  });
});
