import { resolve } from "node:path";
import FastifyVite from "@fastify/vite";
import type { FastifyPluginAsync } from "fastify";

export const uiPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(FastifyVite, {
    root: resolve(import.meta.dirname, ".."),
    distDir: resolve(import.meta.dirname, "..", "dist", "client"),
    dev: false,
    spa: true,
  });

  // SPA routes
  fastify.get("/", (_req, reply) => reply.html());
  fastify.get("/dashboard", (_req, reply) => reply.html());
  fastify.get("/dashboard/*", (_req, reply) => reply.html());

  // Stub API for dashboard widget generation
  fastify.post("/api/generate", async () => {
    return { elements: {}, rootIds: [] };
  });

  await fastify.vite.ready();
};
