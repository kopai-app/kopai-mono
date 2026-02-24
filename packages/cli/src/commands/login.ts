import { Command } from "commander";
import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  saveConfig,
  resolveConfigPath,
  TOKEN_PREFIX_LENGTH,
  DEFAULT_URL,
  type Config,
} from "../config.js";

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
        url: opts.url ?? DEFAULT_URL,
      };

      const targetPath = resolveConfigPath(opts.global ?? false);
      saveConfig(updates, targetPath);

      // Warn if in a git repo and .kopairc is not gitignored
      if (!opts.global) {
        const gitDir = join(process.cwd(), ".git");
        if (existsSync(gitDir)) {
          const gitignorePath = join(process.cwd(), ".gitignore");
          let isIgnored = false;
          if (existsSync(gitignorePath)) {
            const content = readFileSync(gitignorePath, "utf-8");
            isIgnored = content
              .split("\n")
              .some((line) => line.trim() === ".kopairc");
          }
          if (!isIgnored) {
            console.error(
              "Warning: .kopairc is not in .gitignore. Add it to avoid committing secrets."
            );
          }
        }
      }

      console.log(
        `Logged in. Token: ${token.slice(0, TOKEN_PREFIX_LENGTH)}...`
      );
    });
}
