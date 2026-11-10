import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({}),
  };
});

import { loadConfig } from "../config.js";
import { createRunCommand, exporterEnv, type RunDeps } from "./run.js";

const OTLP = {
  endpoint: "https://otlp-http.kopai.app",
  token: "kpi_backend_token_1234567890",
};

async function runCommand(args: string[], deps: Partial<RunDeps> = {}) {
  const stderr: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });

  const program = new Command();
  program.exitOverride();
  // The real program turns this on (index.ts); `run` needs it so that
  // options after the started command belong to that command.
  program.enablePositionalOptions();
  program.addCommand(createRunCommand(deps));
  await program.parseAsync(["node", "test", "run", ...args]);

  return { stderr: stderr.join("\n"), exitCode: process.exitCode };
}

describe("run command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("builds the three exporter variables from the otlp block", () => {
    expect(exporterEnv(OTLP)).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-http.kopai.app",
      OTEL_EXPORTER_OTLP_HEADERS:
        "Authorization=Bearer%20kpi_backend_token_1234567890",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    });
  });

  it("starts the command with the exporter settings added to the environment", async () => {
    vi.mocked(loadConfig).mockReturnValue({ token: "kpi_cli", otlp: OTLP });
    vi.stubEnv("OTEL_SERVICE_NAME", "shop-api");
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    const result = await runCommand(
      ["--", "node", "server.js", "--port", "3000"],
      {
        runInteractive,
      }
    );

    expect(runInteractive).toHaveBeenCalledTimes(1);
    expect(runInteractive).toHaveBeenCalledWith(
      "node",
      ["server.js", "--port", "3000"],
      expect.objectContaining({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-http.kopai.app",
        OTEL_EXPORTER_OTLP_HEADERS:
          "Authorization=Bearer%20kpi_backend_token_1234567890",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_SERVICE_NAME: "shop-api",
      })
    );
    expect(result.exitCode).toBe(0);
    vi.unstubAllEnvs();
  });

  it("replaces exporter variables that were already set", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    await runCommand(["--", "npm", "start"], { runInteractive });

    expect(runInteractive).toHaveBeenCalledWith(
      "npm",
      ["start"],
      expect.objectContaining({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp-http.kopai.app",
      })
    );
    vi.unstubAllEnvs();
  });

  it("passes options after the command through to it", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    await runCommand(["go", "run", "./cmd/api", "--port", "8080"], {
      runInteractive,
    });

    expect(runInteractive).toHaveBeenCalledWith(
      "go",
      ["run", "./cmd/api", "--port", "8080"],
      expect.anything()
    );
  });

  it("prints the endpoint and only a prefix of the token", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    const result = await runCommand(["--", "node", "server.js"], {
      runInteractive,
    });

    expect(result.stderr).toContain("https://otlp-http.kopai.app");
    expect(result.stderr).toContain("kpi_backen…");
    expect(result.stderr).not.toContain(OTLP.token);
  });

  it("exits with the child's exit code", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 7);

    const result = await runCommand(["--", "node", "server.js"], {
      runInteractive,
    });

    expect(result.exitCode).toBe(7);
  });

  it("explains when the command cannot be started", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 127);

    const result = await runCommand(["--", "no-such-tool"], {
      runInteractive,
    });

    expect(result.stderr).toContain('Could not start "no-such-tool"');
    expect(result.exitCode).toBe(127);
  });

  it("refuses without an otlp block and points at setup", async () => {
    vi.mocked(loadConfig).mockReturnValue({ token: "kpi_cli" });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    const result = await runCommand(["--", "node", "server.js"], {
      runInteractive,
    });

    expect(runInteractive).not.toHaveBeenCalled();
    expect(result.stderr).toContain("npx @kopai/cli setup");
    expect(result.exitCode).toBe(3);
  });

  it("reads the config file given with --config", async () => {
    vi.mocked(loadConfig).mockReturnValue({ otlp: OTLP });
    const runInteractive = vi.fn<RunDeps["runInteractive"]>(async () => 0);

    await runCommand(["--config", "/tmp/other.kopairc", "--", "node", "a.js"], {
      runInteractive,
    });

    expect(loadConfig).toHaveBeenCalledWith("/tmp/other.kopairc");
  });
});
