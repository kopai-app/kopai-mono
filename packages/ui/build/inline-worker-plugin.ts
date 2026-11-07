import path from "node:path";
import { rolldown, type Plugin } from "rolldown";

const SUFFIX = "?worker&inline";
const PREFIX = "\0inline-worker:";

/**
 * Vite-compatible `import W from "./x.worker.ts?worker&inline"` for the
 * tsdown library build (plan §3).
 *
 * The worker entry is bundled with everything it imports (`@kopai/sdk`,
 * `@kopai/core`, `zod`) into one minified IIFE. The importing module gets a
 * default-exported constructor that starts the worker from a Blob URL, so a
 * consumer's bundler sees only a string and a function: no worker asset to
 * copy, no `import.meta.url`, and no bare imports left inside the worker. It
 * works the same in the ESM and the CJS build.
 */
export function inlineWorkerPlugin(): Plugin {
  return {
    name: "kopai:inline-worker",
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null;
      const request = source.slice(0, -SUFFIX.length);
      const resolved = await this.resolve(request, importer, {
        skipSelf: true,
      });
      const file =
        resolved?.id ??
        (importer ? path.resolve(path.dirname(importer), request) : request);
      // Relative to the cwd, like rolldown's own module ids: the id shows up
      // in the output's region comments, and a published dist must not
      // carry the builder's absolute paths.
      return PREFIX + toPosix(path.relative(process.cwd(), file));
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = path.resolve(process.cwd(), id.slice(PREFIX.length));
      this.addWatchFile(file);
      const code = await bundleWorker(file);
      for (const f of code.watchFiles) {
        if (f !== file && !f.startsWith("\0")) this.addWatchFile(f);
      }
      return workerModule(code.iife);
    },
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Bundles one worker entry into a self-contained, minified IIFE. */
export async function bundleWorker(
  file: string
): Promise<{ iife: string; watchFiles: string[] }> {
  const build = await rolldown({
    input: file,
    platform: "browser",
    // The shell exports its handler for tests; the IIFE needs no global name.
    onLog(level, log, handler) {
      if (log.code === "MISSING_NAME_OPTION_FOR_IIFE_EXPORT") return;
      handler(level, log);
    },
    transform: {
      define: { "process.env.NODE_ENV": '"production"' },
    },
  });
  try {
    const { output } = await build.generate({
      format: "iife",
      minify: true,
      codeSplitting: false,
    });
    const chunk = output.find((o) => o.type === "chunk");
    if (!chunk || chunk.type !== "chunk") {
      throw new Error(`inline-worker: no chunk produced for ${file}`);
    }
    return { iife: chunk.code, watchFiles: await build.watchFiles };
  } finally {
    await build.close();
  }
}

/**
 * The module that replaces the `?worker&inline` import: the same contract
 * (and the same revoke-after-construct pattern) as Vite's inline worker.
 */
function workerModule(iife: string): string {
  return [
    `const src = ${JSON.stringify(iife)};`,
    `export default function InlineWorker(options) {`,
    `  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));`,
    `  try {`,
    `    return new Worker(url, { name: options && options.name });`,
    `  } finally {`,
    `    URL.revokeObjectURL(url);`,
    `  }`,
    `}`,
    ``,
  ].join("\n");
}
