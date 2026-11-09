import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

// Process helpers for commands that drive other tools. Commands take these as
// injectable dependencies so tests never start a real process.

export interface RunResult {
  /** Exit code. 127 when the command could not be started at all. */
  code: number;
  /** Everything the command wrote to stdout and stderr, in arrival order. */
  output: string;
}

/**
 * Runs `command` in the current directory and waits for it to finish, with
 * stdin closed and output captured. Never rejects.
 */
export function runCaptured(
  command: string,
  args: string[]
): Promise<RunResult> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (err) =>
      finish({ code: 127, output: `${output}${err.message}\n` })
    );
    child.on("close", (code) => finish({ code: code ?? 1, output }));
  });
}

/**
 * Runs `command` attached to this terminal and resolves with its exit code.
 * While it runs, Ctrl-C belongs to the child: this process ignores SIGINT so
 * it does not exit and leave the child holding the terminal.
 */
export function runInteractive(
  command: string,
  args: string[]
): Promise<number> {
  return new Promise((resolve) => {
    const ignoreInterrupt = () => {};
    process.on("SIGINT", ignoreInterrupt);
    const done = (code: number) => {
      process.off("SIGINT", ignoreInterrupt);
      resolve(code);
    };

    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", () => done(127));
    child.on("close", (code) => done(code ?? 1));
  });
}

/** True when an executable file named `name` is in a directory on PATH. */
export function isOnPath(name: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];

  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // not here; keep looking
      }
    }
  }
  return false;
}

/**
 * Asks a yes/no question on stderr and reads the answer from stdin. An empty
 * answer means yes. Closing stdin without answering means no.
 */
export function askYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.on("close", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    rl.question(`${question} [Y/n] `, (answer) => {
      settled = true;
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "" || normalized === "y" || normalized === "yes");
    });
  });
}
