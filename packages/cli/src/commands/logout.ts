import { Command } from "commander";
import { removeConfigToken, resolveConfigPath } from "../config.js";

export function createLogoutCommand(): Command {
  return new Command("logout")
    .description("Remove saved API token from .kopairc")
    .option("--global", "Remove from ~/.kopairc instead of ./.kopairc")
    .action((opts: { global?: boolean }) => {
      const targetPath = resolveConfigPath(opts.global ?? false);
      const removed = removeConfigToken(targetPath);

      if (removed) {
        console.log("Logged out.");
      } else {
        console.log("Not logged in.");
      }
    });
}
