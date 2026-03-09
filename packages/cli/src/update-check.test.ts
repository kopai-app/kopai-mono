import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compareVersions,
  getCacheDir,
  shouldCheck,
  checkForUpdates,
} from "./update-check.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";

vi.mock("node:fs/promises");
vi.mock("node:os");

describe("compareVersions", () => {
  it("returns true when latest is greater (patch)", () => {
    expect(compareVersions("0.6.0", "0.7.0")).toBe(true);
  });

  it("returns true when latest is greater (major)", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when latest is greater (minor)", () => {
    expect(compareVersions("1.2.0", "1.3.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(compareVersions("0.7.0", "0.7.0")).toBe(false);
  });

  it("returns false when current is greater", () => {
    expect(compareVersions("0.8.0", "0.7.0")).toBe(false);
  });

  it("returns false for malformed versions", () => {
    expect(compareVersions("abc", "0.7.0")).toBe(false);
    expect(compareVersions("0.7.0", "abc")).toBe(false);
  });
});

describe("getCacheDir", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns Library/Caches path on macOS", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    expect(getCacheDir()).toBe("/home/user/Library/Caches/kopai");
  });

  it("returns LOCALAPPDATA path on Windows", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\user\\AppData\\Local");
    const result = getCacheDir();
    expect(result).toContain("kopai");
    expect(result).toContain("cache");
    expect(result.startsWith("C:\\Users\\user\\AppData\\Local")).toBe(true);
  });

  it("returns XDG_CACHE_HOME path on Linux when set", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    vi.stubEnv("XDG_CACHE_HOME", "/custom/cache");
    expect(getCacheDir()).toBe("/custom/cache/kopai");
  });

  it("returns ~/.cache path on Linux when XDG not set", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    vi.stubEnv("XDG_CACHE_HOME", "");
    expect(getCacheDir()).toBe("/home/user/.cache/kopai");
  });
});

describe("shouldCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns false when KOPAI_NO_UPDATE_CHECK is set", () => {
    vi.stubEnv("KOPAI_NO_UPDATE_CHECK", "1");
    expect(shouldCheck()).toBe(false);
  });

  it("returns false when CI env is set", () => {
    vi.stubEnv("CI", "true");
    expect(shouldCheck()).toBe(false);
  });

  it("returns false when BUILD_NUMBER env is set", () => {
    vi.stubEnv("BUILD_NUMBER", "123");
    expect(shouldCheck()).toBe(false);
  });

  it("returns false when stderr is not a TTY", () => {
    const original = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      configurable: true,
    });
    expect(shouldCheck()).toBe(false);
    Object.defineProperty(process.stderr, "isTTY", {
      value: original,
      configurable: true,
    });
  });

  it("returns true when no opt-out conditions met", () => {
    vi.stubEnv("KOPAI_NO_UPDATE_CHECK", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("BUILD_NUMBER", "");
    vi.stubEnv("RUN_ID", "");
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
    expect(shouldCheck()).toBe(true);
  });
});

describe("checkForUpdates", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    vi.stubEnv("KOPAI_NO_UPDATE_CHECK", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("BUILD_NUMBER", "");
    vi.stubEnv("RUN_ID", "");
    Object.defineProperty(process.stderr, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prints notice when cache shows newer version", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "0.8.0" })
    );

    await checkForUpdates("0.7.0");

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0.7.0"));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0.8.0"));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("KOPAI_NO_UPDATE_CHECK")
    );
  });

  it("does not print when cache shows same version", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ lastCheck: Date.now(), latestVersion: "0.7.0" })
    );

    await checkForUpdates("0.7.0");

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("fetches from registry when cache is stale", async () => {
    const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ lastCheck: staleTimestamp, latestVersion: "0.7.0" })
    );
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.9.0" }),
    });

    await checkForUpdates("0.7.0", { fetchFn: mockFetch });

    expect(mockFetch).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0.9.0"));
  });

  it("fetches from registry when no cache exists", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.8.0" }),
    });

    await checkForUpdates("0.7.0", { fetchFn: mockFetch });

    expect(mockFetch).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("0.8.0"));
  });

  it("does not crash when fetch fails", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));

    await expect(
      checkForUpdates("0.7.0", { fetchFn: mockFetch })
    ).resolves.not.toThrow();

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("does not crash when cache write fails", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.mkdir).mockRejectedValue(new Error("EPERM"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.8.0" }),
    });

    await expect(
      checkForUpdates("0.7.0", { fetchFn: mockFetch })
    ).resolves.not.toThrow();
  });

  it("skips everything when KOPAI_NO_UPDATE_CHECK is set", async () => {
    vi.stubEnv("KOPAI_NO_UPDATE_CHECK", "1");

    const mockFetch = vi.fn();
    await checkForUpdates("0.7.0", { fetchFn: mockFetch });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("writes cache after successful fetch", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "0.8.0" }),
    });

    await checkForUpdates("0.7.0", { fetchFn: mockFetch });

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("update-check.json"),
      expect.stringContaining("0.8.0")
    );
  });
});
