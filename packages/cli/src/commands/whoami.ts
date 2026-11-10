import { Command } from "commander";
import { KopaiClient } from "@kopai/sdk";
import {
  loadConfig,
  TOKEN_PREFIX_LENGTH,
  DEFAULT_URL,
  type Config,
} from "../config.js";

const OTLP_CHECK_TIMEOUT_MS = 10_000;

export function createWhoamiCommand(): Command {
  return new Command("whoami")
    .description(
      "Show current authentication status: the CLI token, and the app's exporter token when kopai setup wrote one"
    )
    .option("-c, --config <path>", "Config file path")
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);

      if (!config.token) {
        console.log("Not logged in.");
      } else {
        console.log(`Token: ${config.token.slice(0, TOKEN_PREFIX_LENGTH)}...`);
        console.log(`URL: ${config.url ?? `${DEFAULT_URL} (default)`}`);
        if (!(await cliTokenIsValid(config))) process.exitCode = 1;
      }

      if (config.otlp) {
        console.log(`OTLP endpoint: ${config.otlp.endpoint}`);
        console.log(
          `Backend token: ${config.otlp.token.slice(0, TOKEN_PREFIX_LENGTH)}...`
        );
        if (!(await backendTokenIsValid(config.otlp))) process.exitCode = 1;
      }
    });
}

/** Prints the verdict on the CLI token; true when the server accepted it. */
async function cliTokenIsValid(config: Config): Promise<boolean> {
  try {
    const client = new KopaiClient({
      baseUrl: config.url ?? DEFAULT_URL,
      token: config.token,
    });
    await client.searchTracesPage({ limit: 1 });
    console.log("Token is valid.");
    return true;
  } catch (err: unknown) {
    const status =
      err && typeof err === "object" && "status" in err
        ? (err as { status: number }).status
        : undefined;
    if (status === 401) {
      console.log("Token is invalid or expired.");
    } else {
      console.log("Could not reach server to validate token.");
    }
    return false;
  }
}

/**
 * Prints the verdict on the backend token by sending an empty OTLP request,
 * the same check an instrumented app's first export would make. This is
 * how an agent confirms the token works without ever reading it.
 */
async function backendTokenIsValid(
  otlp: NonNullable<Config["otlp"]>
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${otlp.endpoint.replace(/\/+$/, "")}/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${otlp.token}`,
      },
      body: '{"resourceSpans":[]}',
      signal: AbortSignal.timeout(OTLP_CHECK_TIMEOUT_MS),
    });
  } catch {
    console.log(
      "Could not reach the OTLP endpoint to validate the backend token."
    );
    return false;
  }
  if (res.ok) {
    console.log("Backend token is valid.");
    return true;
  }
  if (res.status === 401 || res.status === 403) {
    console.log("Backend token is invalid or revoked.");
  } else {
    console.log(
      `OTLP endpoint answered ${res.status}; could not validate the backend token.`
    );
  }
  return false;
}
