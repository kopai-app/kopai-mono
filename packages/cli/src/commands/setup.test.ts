import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { Command } from "commander";
import { join } from "node:path";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    saveConfig: vi.fn(),
    resolveConfigPath: vi.fn(),
  };
});

// Every file setup touches goes through this module; the tests back it with
// an in-memory map so nothing reaches the real disk.
vi.mock("../project-files.js", () => ({
  pathExists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  isWritable: vi.fn(),
  kopaircGitignoreStatus: vi.fn(),
  addKopaircToGitignore: vi.fn(),
}));

import { saveConfig, resolveConfigPath } from "../config.js";
import {
  addKopaircToGitignore,
  isWritable,
  kopaircGitignoreStatus,
  pathExists,
  readTextFile,
  writeTextFile,
} from "../project-files.js";
import { createSetupCommand, type SetupDeps } from "./setup.js";

const CWD = process.cwd();
const CONFIG_PATH = join(CWD, ".kopairc");
const CURSOR_PATH = join(CWD, ".cursor", "mcp.json");
const MCP_URL = "http://localhost:3000/v2/mcp";
const FIRST_PROMPT =
  "Add observability to this app and confirm telemetry reaches Kopai.";
const NPX_SKILLS_ARGS = [
  "-y",
  "skills",
  "add",
  "kopai-app/kopai-mono",
  "--skill",
  "otel-instrumentation",
  "root-cause-analysis",
  "create-dashboard",
  "-y",
];

const EXCHANGE_BODY = {
  workspace: { id: "tenant-1", name: "Acme" },
  apiUrl: "http://localhost:3000",
  otlpUrl: "http://localhost:4318",
  mcpUrl: MCP_URL,
  backendToken: "kpi_backend_token",
  cliToken: "kpi_cli_token",
};

const files = new Map<string, string>();
const dirs = new Set<string>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FakeDeps = { [K in keyof SetupDeps]: Mock<SetupDeps[K]> };

/** Every dependency as a mock; tests override some with their own `vi.fn`. */
function fakeDeps(overrides: Partial<SetupDeps> = {}): FakeDeps {
  const defaults: FakeDeps = {
    fetch: vi.fn<SetupDeps["fetch"]>(async () =>
      jsonResponse(200, EXCHANGE_BODY)
    ),
    run: vi.fn<SetupDeps["run"]>(async () => ({ code: 0, output: "" })),
    runInteractive: vi.fn<SetupDeps["runInteractive"]>(async () => 0),
    isOnPath: vi.fn<SetupDeps["isOnPath"]>(
      (name) => name === "claude" || name === "codex"
    ),
    confirm: vi.fn<SetupDeps["confirm"]>(async () => true),
    isInteractive: vi.fn<SetupDeps["isInteractive"]>(() => false),
    hostname: vi.fn<SetupDeps["hostname"]>(() => "dev-laptop"),
  };
  return { ...defaults, ...overrides } as FakeDeps;
}

async function runSetup(args: string[], deps: SetupDeps) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });

  const program = new Command();
  program.exitOverride();
  program.addCommand(createSetupCommand(deps));
  await program.parseAsync(["node", "test", "setup", ...args]);

  return {
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    exitCode: process.exitCode,
  };
}

describe("setup command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    files.clear();
    dirs.clear();
    vi.mocked(resolveConfigPath).mockReturnValue(CONFIG_PATH);
    vi.mocked(pathExists).mockImplementation(
      (path) => files.has(path) || dirs.has(path)
    );
    vi.mocked(readTextFile).mockImplementation((path) => files.get(path));
    vi.mocked(writeTextFile).mockImplementation((path, content) => {
      files.set(path, content);
    });
    vi.mocked(isWritable).mockReturnValue(true);
    vi.mocked(kopaircGitignoreStatus).mockReturnValue("missing");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  describe("arguments", () => {
    it("exits 2 with a clear message when --code is missing", async () => {
      const deps = fakeDeps();

      const result = await runSetup([], deps);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Missing --code");
      expect(result.stderr).toContain("dashboard");
      expect(deps.fetch).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it("exits 2 on an unknown --agent name", async () => {
      const deps = fakeDeps();

      const result = await runSetup(
        ["--code", "kps_abc", "--agent", "claude,vim"],
        deps
      );

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Unknown agent "vim"');
      expect(deps.fetch).not.toHaveBeenCalled();
    });

    it("exits 2 on an --api value that is not an http(s) URL", async () => {
      const deps = fakeDeps();

      const result = await runSetup(
        ["--code", "kps_abc", "--api", "localhost:3000"],
        deps
      );

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Invalid --api URL");
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  });

  describe("exchange", () => {
    it("explains an invalid or expired code on 404 and exits 1", async () => {
      const deps = fakeDeps({
        fetch: vi.fn(async () =>
          jsonResponse(404, { code: "SETUP-NOT-FOUND-001" })
        ),
      });

      const result = await runSetup(["--code", "kps_used"], deps);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Setup code is invalid or expired. Get a new one from the dashboard."
      );
      expect(saveConfig).not.toHaveBeenCalled();
      expect(deps.run).not.toHaveBeenCalled();
      expect(result.stdout).toBe("");
    });

    it("exits 1 when the API cannot be reached", async () => {
      const deps = fakeDeps({
        fetch: vi.fn(async () => {
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNREFUSED" },
          });
        }),
      });

      const result = await runSetup(
        ["--code", "kps_abc", "--api", "http://localhost:3000"],
        deps
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Could not reach http://localhost:3000: fetch failed (ECONNREFUSED)"
      );
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it("exits 3 without spending the code when ./.kopairc cannot be written", async () => {
      vi.mocked(isWritable).mockReturnValue(false);
      const deps = fakeDeps();

      const result = await runSetup(["--code", "kps_abc"], deps);

      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain("the setup code is still unused");
      expect(deps.fetch).not.toHaveBeenCalled();
    });
  });

  describe("happy path", () => {
    it("saves the config, installs skills, registers every agent found, and prints the next step", async () => {
      dirs.add(join(CWD, ".cursor"));
      const deps = fakeDeps();

      const result = await runSetup(
        ["--code", "kps_abc", "--api", "http://localhost:3000/"],
        deps
      );

      expect(deps.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = deps.fetch.mock.calls[0]!;
      expect(url).toBe("http://localhost:3000/v1/setup/exchange");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        code: "kps_abc",
        label: "dev-laptop",
      });

      expect(saveConfig).toHaveBeenCalledWith(
        {
          url: "http://localhost:3000/v2",
          token: "kpi_cli_token",
          otlp: {
            endpoint: "http://localhost:4318",
            token: "kpi_backend_token",
          },
        },
        CONFIG_PATH
      );
      expect(addKopaircToGitignore).toHaveBeenCalledWith(CWD);

      expect(deps.run.mock.calls).toEqual([
        ["npx", NPX_SKILLS_ARGS],
        ["claude", ["mcp", "add", "--transport", "http", "kopai", MCP_URL]],
        ["codex", ["mcp", "add", "kopai", "--url", MCP_URL]],
      ]);
      expect(JSON.parse(files.get(CURSOR_PATH)!)).toEqual({
        mcpServers: { kopai: { url: MCP_URL } },
      });

      expect(result.stderr.split("\n")).toEqual([
        `|--k> Setting up Kopai in ${CWD}`,
        '✓ signed in to workspace "Acme"',
        "✓ tokens issued and saved to ./.kopairc (added to .gitignore)",
        "✓ skills installed: otel-instrumentation, root-cause-analysis, create-dashboard",
        "✓ Kopai connector registered in Claude Code",
        "✓ Kopai connector registered in Codex",
        "✓ Kopai connector registered in Cursor",
        "  The first time your agent calls Kopai, a browser tab asks you to approve it once.",
      ]);
      expect(result.stdout).toBe(
        `→ Next, in your coding agent (fresh chat):\n  ${FIRST_PROMPT}`
      );
      expect(result.exitCode).toBeUndefined();
      expect(deps.runInteractive).not.toHaveBeenCalled();
    });

    it("passes --skills-source through to npx skills add", async () => {
      const deps = fakeDeps();

      await runSetup(
        ["--code", "kps_abc", "--skills-source", "/src/kopai-mono", "--no-mcp"],
        deps
      );

      expect(deps.run).toHaveBeenCalledWith("npx", [
        "-y",
        "skills",
        "add",
        "/src/kopai-mono",
        "--skill",
        "otel-instrumentation",
        "root-cause-analysis",
        "create-dashboard",
        "-y",
      ]);
    });
  });

  describe("dry run", () => {
    it("prints the plan and runs, sends, and writes nothing", async () => {
      const deps = fakeDeps({ isInteractive: vi.fn(() => true) });

      const result = await runSetup(
        [
          "--dry-run",
          "--code",
          "kps_abc",
          "--api",
          "http://localhost:3000",
          "--launch",
        ],
        deps
      );

      expect(result.exitCode).toBeUndefined();
      expect(deps.fetch).not.toHaveBeenCalled();
      expect(deps.run).not.toHaveBeenCalled();
      expect(deps.runInteractive).not.toHaveBeenCalled();
      expect(deps.confirm).not.toHaveBeenCalled();
      expect(saveConfig).not.toHaveBeenCalled();
      expect(writeTextFile).not.toHaveBeenCalled();
      expect(addKopaircToGitignore).not.toHaveBeenCalled();

      expect(result.stdout).toContain("the setup code is not exchanged");
      expect(result.stdout).toContain(
        "POST http://localhost:3000/v1/setup/exchange (skipped in this dry run)"
      );
      expect(result.stdout).toContain(`npx ${NPX_SKILLS_ARGS.join(" ")}`);
      expect(result.stdout).toContain(
        "claude mcp add --transport http kopai <MCP URL from the exchange>"
      );
      expect(result.stdout).toContain(
        "codex mcp add kopai --url <MCP URL from the exchange>"
      );
      expect(result.stdout).toContain(
        "ask before adding .kopairc to .gitignore"
      );
      expect(result.stdout).toContain(`claude '${FIRST_PROMPT}'`);
    });
  });

  describe("skipping steps", () => {
    it("--no-skills skips only the skills", async () => {
      const deps = fakeDeps();

      const result = await runSetup(["--code", "kps_abc", "--no-skills"], deps);

      expect(deps.run).not.toHaveBeenCalledWith("npx", expect.anything());
      expect(deps.run).toHaveBeenCalledWith("claude", expect.anything());
      expect(result.stderr).toContain("– skills skipped (--no-skills)");
      expect(result.exitCode).toBeUndefined();
    });

    it("--no-mcp skips only the connector", async () => {
      dirs.add(join(CWD, ".cursor"));
      const deps = fakeDeps();

      const result = await runSetup(["--code", "kps_abc", "--no-mcp"], deps);

      expect(deps.run.mock.calls).toEqual([["npx", NPX_SKILLS_ARGS]]);
      expect(writeTextFile).not.toHaveBeenCalled();
      expect(result.stderr).toContain("– Kopai connector skipped (--no-mcp)");
      expect(result.stderr).not.toContain("browser tab");
      expect(result.exitCode).toBeUndefined();
    });

    it("skips registration and says why when the workspace has no MCP URL", async () => {
      dirs.add(join(CWD, ".cursor"));
      const deps = fakeDeps({
        fetch: vi.fn(async () =>
          jsonResponse(200, { ...EXCHANGE_BODY, mcpUrl: null })
        ),
      });

      const result = await runSetup(["--code", "kps_abc"], deps);

      expect(deps.run.mock.calls).toEqual([["npx", NPX_SKILLS_ARGS]]);
      expect(writeTextFile).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "– Kopai connector not registered: MCP is not enabled for this workspace yet"
      );
      expect(result.stderr).not.toContain("browser tab");
      expect(result.exitCode).toBeUndefined();
    });

    it("prints the MCP URL when no coding agent is found", async () => {
      const deps = fakeDeps({ isOnPath: vi.fn(() => false) });

      const result = await runSetup(["--code", "kps_abc"], deps);

      expect(deps.run.mock.calls).toEqual([["npx", NPX_SKILLS_ARGS]]);
      expect(result.stderr).toContain(
        `– no coding agent found, add it yourself: ${MCP_URL}`
      );
      expect(result.exitCode).toBeUndefined();
    });
  });

  describe("MCP registration", () => {
    it('treats "already exists" from claude as done', async () => {
      const deps = fakeDeps({
        run: vi.fn(async (command: string) =>
          command === "claude"
            ? {
                code: 1,
                output: "MCP server kopai already exists in local config\n",
              }
            : { code: 0, output: "" }
        ),
      });

      const result = await runSetup(
        ["--code", "kps_abc", "--agent", "claude"],
        deps
      );

      expect(result.stderr).toContain(
        "✓ Kopai connector already registered in Claude Code"
      );
      expect(result.stderr).toContain("browser tab");
      expect(result.exitCode).toBeUndefined();
    });

    it("reports a failed registration with the manual command and exits 1", async () => {
      const deps = fakeDeps({
        run: vi.fn(async (command: string) =>
          command === "codex"
            ? { code: 2, output: "error: config is read-only\n" }
            : { code: 0, output: "" }
        ),
      });

      const result = await runSetup(
        ["--code", "kps_abc", "--agent", "codex"],
        deps
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "✗ Kopai connector not registered in Codex: codex exited with code 2"
      );
      expect(result.stderr).toContain("    error: config is read-only");
      expect(result.stderr).toContain(
        `  Add it yourself: codex mcp add kopai --url ${MCP_URL}`
      );
      expect(result.stdout).toContain("→ Next");
    });

    it("merges into ./.cursor/mcp.json and keeps the other servers", async () => {
      files.set(
        CURSOR_PATH,
        JSON.stringify({
          mcpServers: {
            github: {
              url: "https://example.com/mcp",
              headers: { "X-Team": "a" },
            },
            kopai: { url: "https://api.kopai.app/v2/mcp" },
          },
          theme: "dark",
        })
      );
      const deps = fakeDeps();

      const result = await runSetup(
        ["--code", "kps_abc", "--agent", "cursor"],
        deps
      );

      expect(JSON.parse(files.get(CURSOR_PATH)!)).toEqual({
        mcpServers: {
          github: {
            url: "https://example.com/mcp",
            headers: { "X-Team": "a" },
          },
          kopai: { url: MCP_URL },
        },
        theme: "dark",
      });
      expect(result.stderr).toContain("✓ Kopai connector registered in Cursor");
      expect(deps.run).not.toHaveBeenCalledWith("claude", expect.anything());
    });

    it("leaves an unparseable ./.cursor/mcp.json untouched", async () => {
      files.set(CURSOR_PATH, "{ not json");
      const deps = fakeDeps();

      const result = await runSetup(
        ["--code", "kps_abc", "--agent", "cursor"],
        deps
      );

      expect(files.get(CURSOR_PATH)).toBe("{ not json");
      expect(writeTextFile).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "✗ Kopai connector not registered in Cursor: ./.cursor/mcp.json is not valid JSON"
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("skills failure", () => {
    it("still registers the connector, prints the command to retry, and exits 1", async () => {
      const deps = fakeDeps({
        run: vi.fn(async (command: string) =>
          command === "npx"
            ? { code: 1, output: "npm error 404 Not Found\n" }
            : { code: 0, output: "" }
        ),
      });

      const result = await runSetup(["--code", "kps_abc"], deps);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "✗ skills not installed: npx skills add exited with code 1"
      );
      expect(result.stderr).toContain(
        `  Run it yourself: npx ${NPX_SKILLS_ARGS.join(" ")}`
      );
      expect(result.stderr).toContain(
        "✓ Kopai connector registered in Claude Code"
      );
    });
  });

  describe(".gitignore", () => {
    it("asks first in a terminal and respects a no", async () => {
      const deps = fakeDeps({
        isInteractive: vi.fn(() => true),
        confirm: vi.fn(async () => false),
      });

      const result = await runSetup(["--code", "kps_abc", "--no-mcp"], deps);

      expect(deps.confirm).toHaveBeenCalledTimes(1);
      expect(addKopaircToGitignore).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "✓ tokens issued and saved to ./.kopairc (not in .gitignore; add it before you commit)"
      );
    });

    it("does not ask with --yes", async () => {
      const deps = fakeDeps({ isInteractive: vi.fn(() => true) });

      await runSetup(["--code", "kps_abc", "--no-mcp", "--yes"], deps);

      expect(deps.confirm).not.toHaveBeenCalled();
      expect(addKopaircToGitignore).toHaveBeenCalledWith(CWD);
    });

    it("leaves .gitignore alone outside a git repository", async () => {
      vi.mocked(kopaircGitignoreStatus).mockReturnValue("not-in-repo");
      const deps = fakeDeps();

      const result = await runSetup(["--code", "kps_abc", "--no-mcp"], deps);

      expect(addKopaircToGitignore).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "✓ tokens issued and saved to ./.kopairc\n"
      );
    });
  });

  describe("--launch", () => {
    it("starts claude with the first prompt when --yes is given", async () => {
      const deps = fakeDeps();

      await runSetup(["--code", "kps_abc", "--launch", "--yes"], deps);

      expect(deps.runInteractive).toHaveBeenCalledWith("claude", [
        FIRST_PROMPT,
      ]);
    });

    it("does not start claude outside a terminal without --yes", async () => {
      const deps = fakeDeps();

      const result = await runSetup(["--code", "kps_abc", "--launch"], deps);

      expect(deps.runInteractive).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "– not starting Claude Code: not running in a terminal"
      );
    });

    it("does not start claude when it is not on PATH", async () => {
      const deps = fakeDeps({ isOnPath: vi.fn(() => false) });

      const result = await runSetup(
        ["--code", "kps_abc", "--launch", "--yes"],
        deps
      );

      expect(deps.runInteractive).not.toHaveBeenCalled();
      expect(result.stderr).toContain(
        "– not starting Claude Code: claude is not on PATH"
      );
    });
  });
});
