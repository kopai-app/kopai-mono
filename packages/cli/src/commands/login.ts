import { Command } from "commander";
import { createInterface } from "node:readline";
import {
  saveConfig,
  resolveConfigPath,
  TOKEN_PREFIX_LENGTH,
  type Config,
} from "../config.js";
import { kopaircGitignoreStatus } from "../project-files.js";

const LOGIN_DEFAULT_URL = "https://api.kopai.app/v2";

function readTokenFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question("Token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Save an API token to .kopairc")
    .option("--url <url>", "API base URL to save alongside token")
    .option("--global", "Write to ~/.kopairc instead of ./.kopairc")
    .action(async (opts: { url?: string; global?: boolean }) => {
      const token = await readTokenFromStdin();
      if (!token) {
        console.error("Token cannot be empty.");
        process.exitCode = 2;
        return;
      }

      const updates: Partial<Config> = {
        token,
        url: opts.url ?? LOGIN_DEFAULT_URL,
      };

      const targetPath = resolveConfigPath(opts.global ?? false);
      saveConfig(updates, targetPath);

      // Warn if in a git repo and .kopairc is not gitignored
      if (!opts.global && kopaircGitignoreStatus(process.cwd()) === "missing") {
        console.error(
          "Warning: .kopairc is not in .gitignore. Add it to avoid committing secrets."
        );
      }

      console.log(
        `Logged in. Token: ${token.slice(0, TOKEN_PREFIX_LENGTH)}...`
      );
    });
}
