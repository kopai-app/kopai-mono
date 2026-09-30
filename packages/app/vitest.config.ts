// Every other package inherits the repo-root vitest config by lookup. This one
// has a vite.config.ts for the client build, whose `root` is src/client — found
// first, it would point vitest at a directory with no tests and drop the
// shared timeout. Vitest prefers vitest.config.ts, so this restores the root.
export { default } from "../../vitest.config.js";
