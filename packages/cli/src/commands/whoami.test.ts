import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({}),
  };
});

const mockSearchTracesPage = vi.fn();

vi.mock("@kopai/sdk", () => ({
  KopaiClient: class MockKopaiClient {
    searchTracesPage = mockSearchTracesPage;
  },
}));

import { loadConfig } from "../config.js";
import { createWhoamiCommand } from "./whoami.js";

function runCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );

    const program = new Command();
    program.exitOverride();
    program.addCommand(createWhoamiCommand());

    program.parseAsync(["node", "test", "whoami", ...args]).then(
      () => resolve(logs.join("\n")),
      (err) => reject(err)
    );
  });
}

describe("whoami command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints "Not logged in." when no token configured', async () => {
    vi.mocked(loadConfig).mockReturnValue({});

    const output = await runCommand([]);

    expect(output).toContain("Not logged in.");
  });

  it("prints token prefix and URL when token configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      token: "kpi_test_token_12345678901234567890123456",
      url: "https://example.com/signals",
    });
    mockSearchTracesPage.mockResolvedValue({ data: [] });

    const output = await runCommand([]);

    expect(output).toContain("kpi_test_t");
    expect(output).toContain("https://example.com/signals");
  });

  it('prints "Token is valid." on successful server validation', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      token: "kpi_test_token_12345678901234567890123456",
    });
    mockSearchTracesPage.mockResolvedValue({ data: [] });

    const output = await runCommand([]);

    expect(output).toContain("Token is valid.");
  });

  it('prints "Token is invalid or expired." on auth error', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      token: "kpi_test_token_12345678901234567890123456",
    });

    const authError = Object.assign(new Error("Unauthorized"), {
      status: 401,
    });
    mockSearchTracesPage.mockRejectedValue(authError);

    const output = await runCommand([]);

    expect(output).toContain("Token is invalid or expired.");
  });

  it('prints "Could not reach server to validate token." on network error', async () => {
    vi.mocked(loadConfig).mockReturnValue({
      token: "kpi_test_token_12345678901234567890123456",
    });
    mockSearchTracesPage.mockRejectedValue(new TypeError("fetch failed"));

    const output = await runCommand([]);

    expect(output).toContain("Could not reach server to validate token.");
  });

  it("sets non-zero exit code on validation failure", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      token: "kpi_test_token_12345678901234567890123456",
    });
    mockSearchTracesPage.mockRejectedValue(new Error("any error"));

    process.exitCode = 0;
    await runCommand([]);
    expect(process.exitCode).toBe(1);
  });
});
