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
      url: "https://example.com",
    });
    mockSearchTracesPage.mockResolvedValue({ data: [] });

    const output = await runCommand([]);

    expect(output).toContain("kpi_test_t");
    expect(output).toContain("https://example.com");
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

  describe("backend token", () => {
    const OTLP = {
      endpoint: "https://otlp.example.com/",
      token: "kpi_backend_1234567890",
    };

    function stubFetch(response: Response | Error) {
      const fetchMock = vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("sends an empty OTLP request with the token and reports it valid", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        token: "kpi_test_token_12345678901234567890123456",
        otlp: OTLP,
      });
      mockSearchTracesPage.mockResolvedValue({ data: [] });
      const fetchMock = stubFetch(new Response(null, { status: 200 }));

      process.exitCode = 0;
      const output = await runCommand([]);

      expect(output).toContain("OTLP endpoint: https://otlp.example.com/");
      expect(output).toContain("Backend token: kpi_backen...");
      expect(output).not.toContain(OTLP.token);
      expect(output).toContain("Backend token is valid.");
      expect(process.exitCode).toBe(0);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://otlp.example.com/v1/traces",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: `Bearer ${OTLP.token}`,
          }),
          body: '{"resourceSpans":[]}',
        })
      );
    });

    it("reports a rejected backend token and exits 1", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        token: "kpi_test_token_12345678901234567890123456",
        otlp: OTLP,
      });
      mockSearchTracesPage.mockResolvedValue({ data: [] });
      stubFetch(new Response(null, { status: 401 }));

      process.exitCode = 0;
      const output = await runCommand([]);

      expect(output).toContain("Token is valid.");
      expect(output).toContain("Backend token is invalid or revoked.");
      expect(process.exitCode).toBe(1);
    });

    it("reports an unreachable OTLP endpoint and exits 1", async () => {
      vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
      stubFetch(new TypeError("fetch failed"));

      process.exitCode = 0;
      const output = await runCommand([]);

      expect(output).toContain("Not logged in.");
      expect(output).toContain(
        "Could not reach the OTLP endpoint to validate the backend token."
      );
      expect(process.exitCode).toBe(1);
    });

    it("says nothing about the backend token when .kopairc has no otlp block", async () => {
      vi.mocked(loadConfig).mockReturnValue({
        token: "kpi_test_token_12345678901234567890123456",
      });
      mockSearchTracesPage.mockResolvedValue({ data: [] });
      const fetchMock = stubFetch(new Response(null, { status: 200 }));

      const output = await runCommand([]);

      expect(output).not.toContain("OTLP endpoint");
      expect(fetchMock).not.toHaveBeenCalled();
    });
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
