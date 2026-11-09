import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addKopaircToGitignore,
  kopaircGitignoreStatus,
  readTextFile,
  writeTextFile,
} from "./project-files.js";

// These helpers exist to touch the disk, so they run against a real temporary
// directory rather than a mocked `node:fs`.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kopai-project-files-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("kopaircGitignoreStatus", () => {
  it("is not-in-repo when no parent holds a .git", () => {
    expect(kopaircGitignoreStatus(root)).toBe("not-in-repo");
  });

  it("is missing in a repository without a .kopairc line", () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".gitignore"), "node_modules\n");

    expect(kopaircGitignoreStatus(root)).toBe("missing");
  });

  it("is ignored when the repository root's .gitignore lists .kopairc", () => {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".gitignore"), "node_modules\n.kopairc\n");
    const subdir = join(root, "apps", "api");
    mkdirSync(subdir, { recursive: true });

    expect(kopaircGitignoreStatus(subdir)).toBe("ignored");
  });

  it("treats a .git file (worktree or submodule) as a repository root", () => {
    writeFileSync(join(root, ".git"), "gitdir: /elsewhere\n");

    expect(kopaircGitignoreStatus(root)).toBe("missing");
  });
});

describe("addKopaircToGitignore", () => {
  it("creates .gitignore when there is none", () => {
    addKopaircToGitignore(root);

    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(".kopairc\n");
  });

  it("starts a new line when the file does not end with one", () => {
    writeFileSync(join(root, ".gitignore"), "node_modules");

    addKopaircToGitignore(root);

    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(
      "node_modules\n.kopairc\n"
    );
  });
});

describe("writeTextFile / readTextFile", () => {
  it("creates the parent directory and reads the text back", () => {
    const path = join(root, ".cursor", "mcp.json");

    writeTextFile(path, "{}\n");

    expect(readTextFile(path)).toBe("{}\n");
  });

  it("reads a missing file as undefined", () => {
    expect(readTextFile(join(root, "nope.json"))).toBeUndefined();
  });
});
