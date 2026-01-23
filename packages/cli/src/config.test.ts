import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";
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
