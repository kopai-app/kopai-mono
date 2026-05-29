import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

import {
  loadConfig,
  resolveConnection,
  DEFAULT_URL,
  CONFIG_FILENAME,
} from "./node.js";

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

describe("resolveConnection", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to localhost:8000 when no config or url", () => {
    expect(resolveConnection().url).toBe(DEFAULT_URL);
    expect(resolveConnection().url).toBe("http://localhost:8000");
  });

  it("uses explicit url, ignoring config file and default", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "https://from-file.example.com" })
    );

    expect(resolveConnection({ url: "https://api.kopai.app/v2" }).url).toBe(
      "https://api.kopai.app/v2"
    );
  });

  it("uses url from config file when no explicit url", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "https://custom.example.com" })
    );

    expect(resolveConnection().url).toBe("https://custom.example.com");
  });

  it("strips a trailing /signals (with or without slash) and trailing slash", () => {
    expect(
      resolveConnection({ url: "https://x.example.com/signals" }).url
    ).toBe("https://x.example.com");
    expect(
      resolveConnection({ url: "https://x.example.com/signals/" }).url
    ).toBe("https://x.example.com");
    expect(resolveConnection({ url: "https://x.example.com/" }).url).toBe(
      "https://x.example.com"
    );
  });

  it("prefers explicit token over the config-file token", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ token: "file-token" })
    );

    expect(resolveConnection({ token: "explicit" }).token).toBe("explicit");
    expect(resolveConnection().token).toBe("file-token");
  });

  it("CONFIG_FILENAME is .kopairc", () => {
    expect(CONFIG_FILENAME).toBe(".kopairc");
  });
});
