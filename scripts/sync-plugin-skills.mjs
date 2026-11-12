#!/usr/bin/env node
// Copies Kopai's own skills from skills/ into the Claude plugins that ship them.
//
// WHY copies: a plugin install (and the Claude Directory) takes only the
// plugin's folder, and the Directory rejects symlinks, so a plugin has to
// carry every file it needs. skills/ stays the source of truth (it is also
// what `npx skills add` and the Tessl publish read); CI fails when a copy
// drifts from it.
//
// Usage:
//   node scripts/sync-plugin-skills.mjs          write the copies
//   node scripts/sync-plugin-skills.mjs --check  exit 1 if any copy is stale

import console from "node:console";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Which skills/ entries each plugin ships. */
const PLUGIN_SKILLS = {
  "kopai-oncall": ["root-cause-analysis", "create-live-page"],
};

/** Registry metadata for the Tessl publish workflow; not part of a skill. */
const EXCLUDED_FILES = new Set(["tile.json"]);

const { values: args } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
  },
});

async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (!EXCLUDED_FILES.has(entry.name)) files.push(path);
  }
  return files.sort();
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function compare(sourceDir, targetDir) {
  const problems = [];
  if (!(await exists(targetDir)))
    return [`missing: ${relative(ROOT, targetDir)}`];
  const source = (await listFiles(sourceDir)).map((f) =>
    relative(sourceDir, f)
  );
  const target = (await listFiles(targetDir)).map((f) =>
    relative(targetDir, f)
  );
  for (const file of source) {
    if (!target.includes(file)) {
      problems.push(`missing: ${relative(ROOT, join(targetDir, file))}`);
      continue;
    }
    const [a, b] = await Promise.all([
      readFile(join(sourceDir, file)),
      readFile(join(targetDir, file)),
    ]);
    if (!a.equals(b))
      problems.push(`stale: ${relative(ROOT, join(targetDir, file))}`);
  }
  for (const file of target) {
    if (!source.includes(file)) {
      problems.push(`extra: ${relative(ROOT, join(targetDir, file))}`);
    }
  }
  return problems;
}

async function sync(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => !EXCLUDED_FILES.has(src.split(/[\\/]/).pop()),
  });
}

const problems = [];
for (const [plugin, skills] of Object.entries(PLUGIN_SKILLS)) {
  for (const skill of skills) {
    const sourceDir = join(ROOT, "skills", skill);
    const targetDir = join(ROOT, "plugins", plugin, "skills", skill);
    if (!(await exists(sourceDir))) {
      problems.push(`not in skills/: ${skill}`);
      continue;
    }
    if (args.check) problems.push(...(await compare(sourceDir, targetDir)));
    else {
      await sync(sourceDir, targetDir);
      console.log(`synced skills/${skill} → plugins/${plugin}/skills/${skill}`);
    }
  }
}

if (problems.length > 0) {
  if (args.check) console.error("Plugin skill copies don't match skills/:");
  for (const problem of problems) console.error(`  ${problem}`);
  if (args.check) console.error("Run: node scripts/sync-plugin-skills.mjs");
  process.exit(1);
}
if (args.check) console.log("Plugin skill copies match skills/.");
