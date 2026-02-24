import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadConfig,
  saveConfig,
  resolveConfigPath,
  removeConfigToken,
  CONFIG_FILENAME,
} from "./config.js";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

describe("loadConfig", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty object when no config files exist", () => {
    expect(loadConfig()).toEqual({});
  });

  it("loads config from explicit path", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://custom.com", token: "abc" })
    );

    expect(loadConfig("/custom/path")).toEqual({
      url: "http://custom.com",
      token: "abc",
    });
    expect(fs.existsSync).toHaveBeenCalledWith("/custom/path");
  });

  it("loads config from cwd before homedir", () => {
    vi.mocked(fs.existsSync).mockImplementation((path) =>
      String(path).includes(".kopairc")
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "http://local.com" })
    );

    const result = loadConfig();

    expect(result).toEqual({ url: "http://local.com" });
    // Should check cwd first
    expect(fs.existsSync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(".kopairc")
    );
  });

  it("falls back to homedir config when cwd config missing", () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (path) => String(path) === "/home/user/.kopairc"
    );
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ token: "home-token" })
    );

    expect(loadConfig()).toEqual({ token: "home-token" });
  });

  it("returns empty object on invalid JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json");

    expect(loadConfig("/some/path")).toEqual({});
  });

  it("returns empty object on read error", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("read error");
    });

    expect(loadConfig("/some/path")).toEqual({});
  });
});

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
