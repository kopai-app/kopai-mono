import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["zod", "fastify", "@fastify/swagger", "@fastify/swagger-ui"],
});
