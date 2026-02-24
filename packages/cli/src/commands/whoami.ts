import { Command } from "commander";
import { KopaiClient } from "@kopai/sdk";
import { loadConfig, TOKEN_PREFIX_LENGTH, DEFAULT_URL } from "../config.js";

export function createWhoamiCommand(): Command {
  return new Command("whoami")
    .description("Show current authentication status")
    .option("-c, --config <path>", "Config file path")
    .action(async (opts: { config?: string }) => {
      const config = loadConfig(opts.config);

      if (!config.token) {
        console.log("Not logged in.");
        return;
      }

      console.log(`Token: ${config.token.slice(0, TOKEN_PREFIX_LENGTH)}...`);
      console.log(`URL: ${config.url ?? `${DEFAULT_URL} (default)`}`);

      // Try to validate token against server
      try {
        const client = new KopaiClient({
          baseUrl: config.url ?? DEFAULT_URL,
          token: config.token,
        });
        await client.searchTracesPage({ limit: 1 });
        console.log("Token is valid.");
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
        process.exitCode = 1;
      }
    });
}
