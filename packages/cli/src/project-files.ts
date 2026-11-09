import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILENAME } from "./config.js";

// Small file helpers for the files the CLI reads and writes in the user's
// project. Commands go through these instead of `node:fs` so tests can replace
// the whole module.

/** True when a file or directory exists at `path`. */
export function pathExists(path: string): boolean {
  return existsSync(path);
}

/** The file's text, or `undefined` when there is no file at `path`. */
export function readTextFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf-8");
}

/** Writes `content` to `path`, creating the parent directory when missing. */
export function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

/** True when the current user may write to the file or directory at `path`. */
export function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `.kopairc` in `dir` is kept out of git:
 * - `not-in-repo`: neither `dir` nor any parent holds a `.git`.
 * - `ignored`: a `.gitignore` in `dir`, or in a parent up to the repository
 *   root, has a `.kopairc` line.
 * - `missing`: inside a repository, and no such line exists.
 */
export type GitignoreStatus = "not-in-repo" | "ignored" | "missing";

export function kopaircGitignoreStatus(dir: string): GitignoreStatus {
  const start = resolve(dir);
  const root = findRepoRoot(start);
  if (root === undefined) return "not-in-repo";

  for (let current = start; ; current = dirname(current)) {
    if (hasKopaircLine(join(current, ".gitignore"))) return "ignored";
    if (current === root) return "missing";
  }
}

/** Appends a `.kopairc` line to `dir/.gitignore`, creating the file if needed. */
export function addKopaircToGitignore(dir: string): void {
  const path = join(dir, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(path, `${separator}${CONFIG_FILENAME}\n`, "utf-8");
}

function findRepoRoot(start: string): string | undefined {
  for (let current = start; ;) {
    // `.git` is a directory in a normal clone and a file in a worktree or
    // submodule; either marks the repository root.
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function hasKopaircLine(gitignorePath: string): boolean {
  if (!existsSync(gitignorePath)) return false;
  return readFileSync(gitignorePath, "utf-8")
    .split("\n")
    .some((line) => line.trim() === CONFIG_FILENAME);
}
