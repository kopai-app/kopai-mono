import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlineWorkerPlugin } from "./inline-worker-plugin.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("inlineWorkerPlugin", () => {
  // A dot directory inside packages/ui, so `@kopai/sdk` resolves through
  // packages/ui/node_modules and tsc/eslint globs skip it.
  let dir: string;
  let output: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(here, ".tmp-inline-worker-"));
    fs.writeFileSync(
      path.join(dir, "w.ts"),
      [
        `import { KopaiClient } from "@kopai/sdk";`,
        `const client = new KopaiClient({ baseUrl: "http://example.test" });`,
        `postMessage({ marker: "inline-worker-test-marker", ok: typeof client.searchTracesPage });`,
        ``,
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      [
        `export async function make() {`,
        `  const { default: W } = await import("./w.ts?worker&inline");`,
        `  return new W({ name: "test-worker" });`,
        `}`,
        ``,
      ].join("\n")
    );
    const build = await rolldown({
      input: path.join(dir, "entry.ts"),
      platform: "browser",
      plugins: [inlineWorkerPlugin()],
    });
    const { output: chunks } = await build.generate({
      format: "esm",
      codeSplitting: false,
    });
    await build.close();
    output = chunks
      .filter((c) => c.type === "chunk")
      .map((c) => c.code)
      .join("\n");
  }, 30_000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Runs the generated module's default export under a fake Worker, URL and
   * Blob, and returns what the constructor handed to the Worker.
   */
  async function construct() {
    const created: { url: string; opts: unknown }[] = [];
    const revoked: string[] = [];
    const blobs: { parts: unknown[]; type: string | undefined }[] = [];
    const g = globalThis as Record<string, unknown>;
    const saved = {
      Worker: g.Worker,
      Blob: g.Blob,
      create: URL.createObjectURL,
      revoke: URL.revokeObjectURL,
    };
    g.Worker = class {
      constructor(url: string, opts: unknown) {
        created.push({ url, opts });
      }
    };
    g.Blob = class {
      constructor(parts: unknown[], opts?: { type?: string }) {
        blobs.push({ parts, type: opts?.type });
      }
    };
    URL.createObjectURL = () => "blob:fake/1";
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    try {
      const modFile = path.join(dir, `out-${Math.random()}.mjs`);
      fs.writeFileSync(modFile, output);
      const mod = (await import(modFile)) as { make(): Promise<unknown> };
      const worker = await mod.make();
      return { worker, created, revoked, blobs };
    } finally {
      g.Worker = saved.Worker;
      g.Blob = saved.Blob;
      URL.createObjectURL = saved.create;
      URL.revokeObjectURL = saved.revoke;
    }
  }

  it("replaces the import with a default-exported constructor", () => {
    expect(output).toMatch(/function InlineWorker\(options\)/);
    expect(output).toContain("URL.createObjectURL");
    expect(output).toContain("URL.revokeObjectURL");
    expect(output).not.toContain("?worker&inline");
    expect(output).not.toMatch(/from\s*["']@kopai\/sdk/);
  });

  it("starts a Worker from a Blob URL, passes the name, and revokes the URL", async () => {
    const { created, revoked, blobs } = await construct();
    expect(created).toEqual([
      { url: "blob:fake/1", opts: { name: "test-worker" } },
    ]);
    expect(revoked).toEqual(["blob:fake/1"]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe("text/javascript");
    expect(blobs[0]!.parts).toHaveLength(1);
    expect(typeof blobs[0]!.parts[0]).toBe("string");
  });

  it("the Blob holds a self-contained IIFE with the SDK bundled in", async () => {
    const { blobs } = await construct();
    const src = blobs[0]!.parts[0] as string;
    expect(src).toContain("inline-worker-test-marker");
    // IIFE: parses as a classic script (so no static import/export), with
    // no dynamic import or require of anything, and no SDK reference left.
    expect(src.trimStart()).toMatch(/^\(function|^\(\(\)\s*=>|^!function/);
    expect(() => new Function(src)).not.toThrow();
    expect(src).not.toMatch(/\bimport\(\s*["'`]/);
    expect(src).not.toMatch(/\brequire\(\s*["'`]/);
    expect(src).not.toContain("@kopai/sdk");
    // The SDK itself is in the string (its request path is).
    expect(src).toContain("/signals/traces/search");
  });
});
