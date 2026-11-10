import { Command } from "commander";
import { hostname } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { resolveConfigPath, saveConfig, type Config } from "../config.js";
import {
  addKopaircToGitignore,
  isWritable,
  kopaircGitignoreStatus,
  pathExists,
  readTextFile,
  writeTextFile,
  type GitignoreStatus,
} from "../project-files.js";
import {
  askYesNo,
  isOnPath,
  runCaptured,
  runInteractive,
  type RunResult,
} from "../system.js";

const DEFAULT_API = "https://api.kopai.app";
const DEFAULT_SKILLS_SOURCE = "kopai-app/kopai-mono";
const SKILLS = [
  "kopai-get-started",
  "otel-instrumentation",
  "root-cause-analysis",
  "create-dashboard",
] as const;
const SERVER_NAME = "kopai";
const FIRST_PROMPT =
  "Add observability to this app and confirm telemetry reaches Kopai.";
const CONFIG_DISPLAY_PATH = "./.kopairc";
const CURSOR_CONFIG_DISPLAY_PATH = "./.cursor/mcp.json";
const MCP_URL_PLACEHOLDER = "<MCP URL from the exchange>";
const EXCHANGE_TIMEOUT_MS = 30_000;
const MAX_LABEL_LENGTH = 80;
const OUTPUT_TAIL_LINES = 5;

const EXIT_OK = 0;
const EXIT_RUNTIME = 1;
const EXIT_INVALID_ARGS = 2;
const EXIT_CONFIG = 3;

const AGENT_NAMES = ["claude", "codex", "cursor"] as const;
type AgentName = (typeof AGENT_NAMES)[number];
const AGENT_TITLES: Record<AgentName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

/** Everything `setup` does outside its own process, replaceable in tests. */
export interface SetupDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Runs a command to completion with its output captured. */
  run: (command: string, args: string[]) => Promise<RunResult>;
  /** Runs a command attached to this terminal; resolves with its exit code. */
  runInteractive: (command: string, args: string[]) => Promise<number>;
  isOnPath: (name: string) => boolean;
  /** Asks a yes/no question on the terminal. */
  confirm: (question: string) => Promise<boolean>;
  /** True when stdin is a terminal, so a question can be answered. */
  isInteractive: () => boolean;
  hostname: () => string;
}

const defaultDeps: SetupDeps = {
  fetch: (url, init) => fetch(url, init),
  run: runCaptured,
  runInteractive,
  isOnPath,
  confirm: askYesNo,
  isInteractive: () => Boolean(process.stdin.isTTY),
  hostname,
};

interface SetupOptions {
  code?: string;
  api: string;
  skillsSource: string;
  agent?: string;
  skills: boolean;
  mcp: boolean;
  dryRun?: boolean;
  yes?: boolean;
  launch?: boolean;
}

/** The body of a successful `POST /v1/setup/exchange`. */
interface ExchangeResponse {
  workspace: { id: string; name: string };
  apiUrl: string;
  otlpUrl: string;
  mcpUrl: string | null;
  backendToken: string;
  cliToken: string;
}

type RegistrationOutcome =
  | { status: "added" }
  | { status: "exists" }
  | { status: "failed"; reason: string; output?: string };

export function createSetupCommand(
  overrides: Partial<SetupDeps> = {}
): Command {
  const deps: SetupDeps = { ...defaultDeps, ...overrides };

  return new Command("setup")
    .description(
      "Connect this project to Kopai: save tokens to ./.kopairc, install the skills, and register the MCP connector in your coding agent"
    )
    .option("--code <code>", "one-time setup code from the Kopai dashboard")
    .option("--api <url>", "Kopai API origin", DEFAULT_API)
    .option(
      "--skills-source <src>",
      "source passed to `npx skills add` (a local checkout path works)",
      DEFAULT_SKILLS_SOURCE
    )
    .option(
      "--agent <names>",
      "coding agents to register, comma-separated: claude,codex,cursor (default: every one found)"
    )
    .option("--no-skills", "skip installing the skills")
    .option("--no-mcp", "skip registering the MCP connector")
    .option("--dry-run", "print the plan; send nothing and write nothing")
    .option("--yes", "do not ask before editing .gitignore or launching")
    .option(
      "--launch",
      "start Claude Code with the first prompt when setup is done"
    )
    .addHelpText(
      "after",
      `
Examples:
  $ npx @kopai/cli setup --code kps_…                         # the command the dashboard shows
  $ kopai setup --code kps_… --api http://localhost:3000     # a local Kopai stack
  $ kopai setup --code kps_… --agent claude --launch         # register Claude Code only, then start it
  $ kopai setup --code kps_… --dry-run                       # print the plan, change nothing`
    )
    .action(async (opts: SetupOptions) => {
      const exitCode = await runSetup(opts, deps);
      if (exitCode !== EXIT_OK) process.exitCode = exitCode;
    });
}

async function runSetup(opts: SetupOptions, deps: SetupDeps): Promise<number> {
  const code = opts.code?.trim();
  if (!code) {
    console.error(
      "Missing --code. Copy the setup command from the Kopai dashboard; it includes a one-time setup code."
    );
    return EXIT_INVALID_ARGS;
  }

  const api = parseApiOrigin(opts.api);
  if (api === undefined) {
    console.error(
      `Invalid --api URL "${opts.api}". Pass an http(s) origin such as ${DEFAULT_API}.`
    );
    return EXIT_INVALID_ARGS;
  }

  const requested = parseAgentList(opts.agent);
  if ("error" in requested) {
    console.error(requested.error);
    return EXIT_INVALID_ARGS;
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(false);
  const agents = opts.mcp ? (requested.agents ?? detectAgents(cwd, deps)) : [];

  console.error(`|--k> Setting up Kopai in ${cwd}`);

  if (opts.dryRun) {
    printPlan(api, opts, agents, gitignoreStatusOrMissing(cwd), deps);
    return EXIT_OK;
  }

  const configWritable = pathExists(configPath)
    ? isWritable(configPath)
    : isWritable(cwd);
  if (!configWritable) {
    console.error(
      `Cannot write ${CONFIG_DISPLAY_PATH} in ${cwd}. Fix the permissions and run the command again; the setup code is still unused.`
    );
    return EXIT_CONFIG;
  }

  const label = deps.hostname().trim().slice(0, MAX_LABEL_LENGTH) || undefined;
  const exchange = await exchangeSetupCode(api, code, label, deps.fetch);
  if (!exchange.ok) {
    console.error(exchange.message);
    return EXIT_RUNTIME;
  }
  const setup = exchange.response;
  console.error(`✓ signed in to workspace "${setup.workspace.name}"`);

  try {
    saveConfig(buildConfig(setup), configPath);
  } catch (err) {
    console.error(
      `Could not write ${CONFIG_DISPLAY_PATH}: ${errorMessage(err)}. The setup code is now used up: fix this, get a new code from the dashboard, and run the command again.`
    );
    return EXIT_CONFIG;
  }
  const gitignoreNote = await keepConfigOutOfGit(cwd, opts, deps);
  console.error(
    `✓ tokens issued and saved to ${CONFIG_DISPLAY_PATH}${gitignoreNote}`
  );

  const skillsOk = await installSkills(opts, deps);
  const connectorOk = await registerConnector(setup.mcpUrl, opts, agents, deps);

  console.log("→ Next, in your coding agent (fresh chat):");
  console.log(`  ${FIRST_PROMPT}`);

  if (opts.launch) await launchClaude(opts, deps);

  return skillsOk && connectorOk ? EXIT_OK : EXIT_RUNTIME;
}

// ---------------------------------------------------------------------------
// Arguments

function parseApiOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function parseAgentList(
  value: string | undefined
): { agents?: AgentName[] } | { error: string } {
  if (value === undefined) return {};
  const names = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) {
    return {
      error:
        "--agent needs at least one of claude, codex, cursor. Use --no-mcp to skip the connector.",
    };
  }
  const agents: AgentName[] = [];
  for (const name of names) {
    if (!isAgentName(name)) {
      return {
        error: `Unknown agent "${name}" in --agent. Use claude, codex, or cursor, separated by commas.`,
      };
    }
    if (!agents.includes(name)) agents.push(name);
  }
  return { agents };
}

function isAgentName(name: string): name is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(name);
}

/** The coding agents installed here: on PATH, or a `.cursor` directory. */
function detectAgents(cwd: string, deps: SetupDeps): AgentName[] {
  return AGENT_NAMES.filter((agent) =>
    agent === "cursor"
      ? pathExists(join(cwd, ".cursor")) ||
        deps.isOnPath("cursor") ||
        deps.isOnPath("cursor-agent")
      : deps.isOnPath(agent)
  );
}

// ---------------------------------------------------------------------------
// Dry run

function printPlan(
  api: string,
  opts: SetupOptions,
  agents: AgentName[],
  gitignore: GitignoreStatus,
  deps: SetupDeps
): void {
  const lines = [
    "Dry run: the setup code is not exchanged, nothing is sent to Kopai, and nothing is written.",
    "The plan:",
    `- exchange the setup code: POST ${api}/v1/setup/exchange (skipped in this dry run)`,
    `- save the tokens to ${CONFIG_DISPLAY_PATH}${gitignorePlan(gitignore, opts, deps)}`,
  ];

  lines.push(
    opts.skills
      ? `- install the skills: ${formatCommand("npx", skillsAddArgs(opts.skillsSource))}`
      : "- skip the skills (--no-skills)"
  );

  if (!opts.mcp) {
    lines.push("- skip the Kopai connector (--no-mcp)");
  } else if (agents.length === 0) {
    lines.push(
      "- no coding agent found: print the MCP URL so you can add it yourself"
    );
  } else {
    for (const agent of agents) {
      const how =
        agent === "cursor"
          ? `add "${SERVER_NAME}" to ${CURSOR_CONFIG_DISPLAY_PATH}`
          : formatCommand(...mcpAddCommand(agent, MCP_URL_PLACEHOLDER));
      lines.push(
        `- register the Kopai connector in ${AGENT_TITLES[agent]}: ${how}`
      );
    }
  }

  if (opts.launch) lines.push(`- ${launchPlan(opts, deps)}`);

  console.log(lines.join("\n"));
}

function gitignorePlan(
  status: GitignoreStatus,
  opts: SetupOptions,
  deps: SetupDeps
): string {
  if (status === "not-in-repo") return "";
  if (status === "ignored") return " (.kopairc is already in .gitignore)";
  return opts.yes || !deps.isInteractive()
    ? " and add .kopairc to .gitignore"
    : " and ask before adding .kopairc to .gitignore";
}

function launchPlan(opts: SetupOptions, deps: SetupDeps): string {
  if (!deps.isOnPath("claude")) {
    return "not start Claude Code: claude is not on PATH";
  }
  if (!opts.yes && !deps.isInteractive()) {
    return "not start Claude Code: not running in a terminal (add --yes to start it anyway)";
  }
  const ask = opts.yes ? "" : ", after asking";
  return `start Claude Code${ask}: ${formatCommand("claude", [FIRST_PROMPT])}`;
}

function gitignoreStatusOrMissing(cwd: string): GitignoreStatus {
  try {
    return kopaircGitignoreStatus(cwd);
  } catch {
    return "missing";
  }
}

// ---------------------------------------------------------------------------
// Exchange

type ExchangeOutcome =
  { ok: true; response: ExchangeResponse } | { ok: false; message: string };

async function exchangeSetupCode(
  api: string,
  code: string,
  label: string | undefined,
  fetchFn: SetupDeps["fetch"]
): Promise<ExchangeOutcome> {
  const url = `${api}/v1/setup/exchange`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(label === undefined ? { code } : { code, label }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ${api}: ${describeFetchError(err)}`,
    };
  }

  if (res.status === 404) {
    return {
      ok: false,
      message:
        "Setup code is invalid or expired. Get a new one from the dashboard.",
    };
  }
  if (res.status === 429) {
    return {
      ok: false,
      message:
        "Too many setup attempts. Wait a few minutes, then run the command again.",
    };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    const detail = problemDetail(payload);
    return {
      ok: false,
      message: `Setup failed: ${url} answered ${res.status}${detail ? ` (${detail})` : ""}.`,
    };
  }

  const response = parseExchangeResponse(payload);
  if (response === undefined) {
    return {
      ok: false,
      message: `Setup failed: unexpected response from ${url}.`,
    };
  }
  return { ok: true, response };
}

function parseExchangeResponse(body: unknown): ExchangeResponse | undefined {
  if (!isRecord(body) || !isRecord(body.workspace)) return undefined;
  const { workspace, apiUrl, otlpUrl, backendToken, cliToken } = body;
  const mcpUrl = body.mcpUrl ?? null;
  if (
    typeof workspace.id !== "string" ||
    typeof workspace.name !== "string" ||
    typeof apiUrl !== "string" ||
    typeof otlpUrl !== "string" ||
    (mcpUrl !== null && typeof mcpUrl !== "string") ||
    typeof backendToken !== "string" ||
    typeof cliToken !== "string"
  ) {
    return undefined;
  }
  return {
    workspace: { id: workspace.id, name: workspace.name },
    apiUrl,
    otlpUrl,
    mcpUrl,
    backendToken,
    cliToken,
  };
}

function problemDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const detail = payload.detail ?? payload.title ?? payload.message;
  return typeof detail === "string" && detail ? detail : undefined;
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error && err.name === "TimeoutError") {
    return `no answer within ${EXCHANGE_TIMEOUT_MS / 1000} seconds`;
  }
  const cause = err instanceof Error ? err.cause : undefined;
  const causeCode =
    isRecord(cause) && typeof cause.code === "string" ? cause.code : undefined;
  return causeCode ? `${errorMessage(err)} (${causeCode})` : errorMessage(err);
}

// ---------------------------------------------------------------------------
// .kopairc and .gitignore

function buildConfig(setup: ExchangeResponse): Config {
  return {
    url: `${trimTrailingSlashes(setup.apiUrl)}/v2`,
    token: setup.cliToken,
    otlp: {
      endpoint: trimTrailingSlashes(setup.otlpUrl),
      token: setup.backendToken,
    },
  };
}

/** Returns the note that ends the "tokens saved" line. */
async function keepConfigOutOfGit(
  cwd: string,
  opts: SetupOptions,
  deps: SetupDeps
): Promise<string> {
  let status: GitignoreStatus;
  try {
    status = kopaircGitignoreStatus(cwd);
  } catch (err) {
    return ` (could not check .gitignore: ${errorMessage(err)}; make sure .kopairc is in it)`;
  }
  if (status === "not-in-repo") return "";
  if (status === "ignored") return " (already in .gitignore)";

  const add =
    opts.yes ||
    !deps.isInteractive() ||
    (await deps.confirm(
      "Add .kopairc to .gitignore? It holds your Kopai tokens."
    ));
  if (!add) return " (not in .gitignore; add it before you commit)";

  try {
    addKopaircToGitignore(cwd);
    return " (added to .gitignore)";
  } catch (err) {
    return ` (could not update .gitignore: ${errorMessage(err)}; add .kopairc to it yourself)`;
  }
}

// ---------------------------------------------------------------------------
// Skills

// `--skill` takes the names as separate arguments; a comma-joined list is read
// as one skill name that does not exist.
function skillsAddArgs(source: string): string[] {
  return ["-y", "skills", "add", source, "--skill", ...SKILLS, "-y"];
}

async function installSkills(
  opts: SetupOptions,
  deps: SetupDeps
): Promise<boolean> {
  if (!opts.skills) {
    console.error("– skills skipped (--no-skills)");
    return true;
  }

  const args = skillsAddArgs(opts.skillsSource);
  const result = await deps.run("npx", args);
  if (result.code === 0) {
    console.error(`✓ skills installed: ${SKILLS.join(", ")}`);
    return true;
  }

  console.error(
    `✗ skills not installed: npx skills add exited with code ${result.code}`
  );
  printOutputTail(result.output);
  console.error(`  Run it yourself: ${formatCommand("npx", args)}`);
  return false;
}

// ---------------------------------------------------------------------------
// MCP connector

function mcpAddCommand(
  agent: "claude" | "codex",
  mcpUrl: string
): [string, string[]] {
  return agent === "claude"
    ? ["claude", ["mcp", "add", "--transport", "http", SERVER_NAME, mcpUrl]]
    : ["codex", ["mcp", "add", SERVER_NAME, "--url", mcpUrl]];
}

async function registerConnector(
  mcpUrl: string | null,
  opts: SetupOptions,
  agents: AgentName[],
  deps: SetupDeps
): Promise<boolean> {
  if (!opts.mcp) {
    console.error("– Kopai connector skipped (--no-mcp)");
    return true;
  }
  if (mcpUrl === null) {
    console.error(
      "– Kopai connector not registered: MCP is not enabled for this workspace yet"
    );
    return true;
  }
  if (agents.length === 0) {
    console.error(`– no coding agent found, add it yourself: ${mcpUrl}`);
    return true;
  }

  let allOk = true;
  let anyRegistered = false;
  for (const agent of agents) {
    const title = AGENT_TITLES[agent];
    const outcome =
      agent === "cursor"
        ? registerInCursor(mcpUrl)
        : await registerWithCli(agent, mcpUrl, deps);

    if (outcome.status === "added") {
      console.error(`✓ Kopai connector registered in ${title}`);
      anyRegistered = true;
    } else if (outcome.status === "exists") {
      console.error(`✓ Kopai connector already registered in ${title}`);
      anyRegistered = true;
    } else {
      allOk = false;
      console.error(
        `✗ Kopai connector not registered in ${title}: ${outcome.reason}`
      );
      if (outcome.output) printOutputTail(outcome.output);
      console.error(`  Add it yourself: ${manualRegistration(agent, mcpUrl)}`);
    }
  }

  if (anyRegistered) {
    console.error(
      "  The first time your agent calls Kopai, a browser tab asks you to approve it once."
    );
  }
  return allOk;
}

async function registerWithCli(
  agent: "claude" | "codex",
  mcpUrl: string,
  deps: SetupDeps
): Promise<RegistrationOutcome> {
  const [command, args] = mcpAddCommand(agent, mcpUrl);
  if (!deps.isOnPath(command)) {
    return { status: "failed", reason: `${command} is not on PATH` };
  }
  const result = await deps.run(command, args);
  if (result.code === 0) return { status: "added" };
  if (/already exists/i.test(result.output)) return { status: "exists" };
  return {
    status: "failed",
    reason: `${command} exited with code ${result.code}`,
    output: result.output,
  };
}

/** Sets `mcpServers.kopai` in ./.cursor/mcp.json, keeping everything else. */
function registerInCursor(mcpUrl: string): RegistrationOutcome {
  const path = join(process.cwd(), ".cursor", "mcp.json");

  let text: string | undefined;
  try {
    text = readTextFile(path);
  } catch (err) {
    return {
      status: "failed",
      reason: `could not read ${CURSOR_CONFIG_DISPLAY_PATH}: ${errorMessage(err)}`,
    };
  }

  let doc: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        status: "failed",
        reason: `${CURSOR_CONFIG_DISPLAY_PATH} is not valid JSON`,
      };
    }
    if (!isRecord(parsed)) {
      return {
        status: "failed",
        reason: `${CURSOR_CONFIG_DISPLAY_PATH} is not a JSON object`,
      };
    }
    doc = parsed;
  }

  const servers = doc.mcpServers ?? {};
  if (!isRecord(servers)) {
    return {
      status: "failed",
      reason: `"mcpServers" in ${CURSOR_CONFIG_DISPLAY_PATH} is not an object`,
    };
  }
  const existing = servers[SERVER_NAME];
  if (isRecord(existing) && existing.url === mcpUrl)
    return { status: "exists" };

  const next = {
    ...doc,
    mcpServers: { ...servers, [SERVER_NAME]: { url: mcpUrl } },
  };
  try {
    writeTextFile(path, JSON.stringify(next, null, 2) + "\n");
  } catch (err) {
    return {
      status: "failed",
      reason: `could not write ${CURSOR_CONFIG_DISPLAY_PATH}: ${errorMessage(err)}`,
    };
  }
  return { status: "added" };
}

function manualRegistration(agent: AgentName, mcpUrl: string): string {
  if (agent === "cursor") {
    const entry = JSON.stringify({
      mcpServers: { [SERVER_NAME]: { url: mcpUrl } },
    });
    return `put ${entry} in ${CURSOR_CONFIG_DISPLAY_PATH}`;
  }
  return formatCommand(...mcpAddCommand(agent, mcpUrl));
}

// ---------------------------------------------------------------------------
// Launch

async function launchClaude(
  opts: SetupOptions,
  deps: SetupDeps
): Promise<void> {
  if (!deps.isOnPath("claude")) {
    console.error("– not starting Claude Code: claude is not on PATH");
    return;
  }
  if (!opts.yes && !deps.isInteractive()) {
    console.error(
      "– not starting Claude Code: not running in a terminal (add --yes to start it anyway)"
    );
    return;
  }
  if (
    !opts.yes &&
    !(await deps.confirm("Start Claude Code now with this prompt?"))
  ) {
    return;
  }
  await deps.runInteractive("claude", [FIRST_PROMPT]);
}

// ---------------------------------------------------------------------------
// Helpers

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Quotes an argument for display so the printed command can be pasted. */
function shellQuote(arg: string): string {
  if (arg === MCP_URL_PLACEHOLDER) return arg;
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

/** Prints the last few lines a failed command wrote, indented. */
function printOutputTail(output: string): void {
  const lines = stripVTControlCharacters(output)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-OUTPUT_TAIL_LINES);
  for (const line of lines) console.error(`    ${line}`);
}
