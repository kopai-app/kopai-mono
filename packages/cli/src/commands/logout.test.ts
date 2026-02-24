import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../config.js", () => ({
  removeConfigToken: vi.fn().mockReturnValue(true),
  resolveConfigPath: vi.fn().mockReturnValue("/mock/.kopairc"),
}));

import { removeConfigToken, resolveConfigPath } from "../config.js";
import { createLogoutCommand } from "./logout.js";

function runCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );

    const program = new Command();
    program.exitOverride();
    program.addCommand(createLogoutCommand());

    program.parseAsync(["node", "test", "logout", ...args]).then(
      () => resolve(logs.join("\n")),
      (err) => reject(err)
    );
  });
}

describe("logout command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveConfigPath).mockReturnValue("/mock/.kopairc");
    vi.mocked(removeConfigToken).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls removeConfigToken with correct path", async () => {
    await runCommand([]);

    expect(removeConfigToken).toHaveBeenCalledWith("/mock/.kopairc");
  });

  it('prints "Logged out." when token was removed', async () => {
    vi.mocked(removeConfigToken).mockReturnValue(true);

    const output = await runCommand([]);

    expect(output).toContain("Logged out.");
  });

  it('prints "Not logged in." when no token existed', async () => {
    vi.mocked(removeConfigToken).mockReturnValue(false);

    const output = await runCommand([]);

    expect(output).toContain("Not logged in.");
  });

  it("uses global path when --global flag set", async () => {
    vi.mocked(resolveConfigPath).mockReturnValue("/home/user/.kopairc");

    await runCommand(["--global"]);

    expect(resolveConfigPath).toHaveBeenCalledWith(true);
    expect(removeConfigToken).toHaveBeenCalledWith("/home/user/.kopairc");
  });
});
