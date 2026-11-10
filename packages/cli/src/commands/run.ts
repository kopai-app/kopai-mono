import { Command } from "commander";
import { loadConfig, TOKEN_PREFIX_LENGTH, type Config } from "../config.js";
import { runInteractive } from "../system.js";

const EXIT_CONFIG = 3;
const EXIT_NOT_FOUND = 127;

/** Everything `run` does outside its own process, replaceable in tests. */
export interface RunDeps {
  /** Starts the command attached to this terminal; resolves with its exit code. */
  runInteractive: (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ) => Promise<number>;
}

const defaultDeps: RunDeps = { runInteractive };

/**
 * The exporter variables an app needs to send telemetry to Kopai Cloud,
 * built from the `otlp` block `kopai setup` wrote. `run` puts them in the
 * child's environment so the token never has to be typed, echoed or read
 * by whoever launches the app.
 */
export function exporterEnv(
  otlp: NonNullable<Config["otlp"]>
): Record<string, string> {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: otlp.endpoint,
    // W3C Baggage format: a raw space is not allowed, so the one after
    // "Bearer" is percent-encoded. Every OTel SDK decodes it before sending.
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer%20${otlp.token}`,
    // Kopai accepts OTLP over HTTP only; some SDKs default to gRPC.
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
  };
}

export function createRunCommand(overrides: Partial<RunDeps> = {}): Command {
  const deps: RunDeps = { ...defaultDeps, ...overrides };

  return new Command("run")
    .description(
      "Start a command with the exporter settings from .kopairc in its environment, so the app sends telemetry to Kopai Cloud"
    )
    .option("-c, --config <path>", "Config file path")
    .argument("<command>", "the program to start")
    .argument("[args...]", "its arguments")
    .passThroughOptions()
    .addHelpText(
      "after",
      `
Sets OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS and
OTEL_EXPORTER_OTLP_PROTOCOL from the otlp block in ./.kopairc, replacing any
existing values. Everything else in the environment passes through unchanged,
so OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES work as usual.

Examples:
  $ npx @kopai/cli run -- node server.js
  $ OTEL_SERVICE_NAME=shop-api npx @kopai/cli run -- npm start
  $ npx @kopai/cli run -- go run ./cmd/api --port 8080`
    )
    .action(
      async (
        command: string,
        args: string[],
        opts: { config?: string }
      ): Promise<void> => {
        const config = loadConfig(opts.config);
        if (config.otlp === undefined) {
          console.error(
            "No exporter settings in .kopairc. Run `npx @kopai/cli setup` from the project root first, then run this command from the same directory."
          );
          process.exitCode = EXIT_CONFIG;
          return;
        }

        const env = { ...process.env, ...exporterEnv(config.otlp) };
        console.error(
          `|--k> telemetry goes to ${config.otlp.endpoint} (token ${config.otlp.token.slice(0, TOKEN_PREFIX_LENGTH)}…)`
        );

        const code = await deps.runInteractive(command, args, env);
        if (code === EXIT_NOT_FOUND) {
          console.error(`Could not start "${command}": command not found.`);
        }
        process.exitCode = code;
      }
    );
}
