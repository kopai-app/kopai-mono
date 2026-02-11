import { resolve } from "node:path";
import viteReact from "@vitejs/plugin-react";
import viteFastify from "@fastify/vite/plugin";

export default {
  root: resolve(import.meta.dirname, "src", "client"),
  plugins: [viteFastify({ spa: true, useRelativePaths: true }), viteReact()],
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "dist", "client"),
  },
};
