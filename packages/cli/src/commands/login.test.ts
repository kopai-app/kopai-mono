import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    saveConfig: vi.fn(),
    resolveConfigPath: vi.fn().mockReturnValue("/mock/.kopairc"),
  };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(""),
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
      cb("kpi_test_token_12345678901234567890123456");
    }),
    close: vi.fn(),
  }),
}));

import { saveConfig, resolveConfigPath, DEFAULT_URL } from "../config.js";
import { existsSync, readFileSync } from "node:fs";
import { createLoginCommand } from "./login.js";

function runCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );

    const program = new Command();
    program.exitOverride();
    program.addCommand(createLoginCommand());

    program.parseAsync(["node", "test", "login", ...args]).then(
      () => resolve(logs.join("\n")),
      (err) => reject(err)
    );
  });
}

describe("login command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveConfigPath).mockReturnValue("/mock/.kopairc");
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls saveConfig with token and default url", async () => {
    await runCommand([]);

    expect(saveConfig).toHaveBeenCalledWith(
      { token: "kpi_test_token_12345678901234567890123456", url: DEFAULT_URL },
      "/mock/.kopairc"
    );
  });

  it("includes url in updates when --url provided", async () => {
    await runCommand(["--url", "https://example.com/signals"]);

    expect(saveConfig).toHaveBeenCalledWith(
      {
        token: "kpi_test_token_12345678901234567890123456",
        url: "https://example.com/signals",
      },
      "/mock/.kopairc"
    );
  });

  it("uses global path when --global flag set", async () => {
    vi.mocked(resolveConfigPath).mockReturnValue("/home/user/.kopairc");

    await runCommand(["--global"]);

    expect(resolveConfigPath).toHaveBeenCalledWith(true);
    expect(saveConfig).toHaveBeenCalledWith(
      { token: "kpi_test_token_12345678901234567890123456", url: DEFAULT_URL },
      "/home/user/.kopairc"
    );
  });

  it("prints warning when in git repo without .kopairc in .gitignore", async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).endsWith(".git")) return true;
      if (String(p).endsWith(".gitignore")) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue("node_modules\n");

    const output = await runCommand([]);

    expect(output).toContain(".gitignore");
  });

  it("does not print warning when .kopairc is in .gitignore", async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).endsWith(".git")) return true;
      if (String(p).endsWith(".gitignore")) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue(".kopairc\nnode_modules\n");

    const output = await runCommand([]);

    expect(output).not.toContain(".gitignore");
  });

  it("prints confirmation with token prefix on success", async () => {
    const output = await runCommand([]);

    expect(output).toContain("Logged in.");
    expect(output).toContain("kpi_test_t");
  });
});
