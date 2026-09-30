import { jsonSchemaTransform } from "fastify-type-provider-zod";

type Transform = typeof jsonSchemaTransform;

const uiRoutes = ["/", "/*"];

/**
 * The swagger `transform` for the app: hides the UI routes, and describes the
 * MCP endpoint in words, since JSON-RPC over Streamable HTTP has no meaningful
 * OpenAPI shape.
 *
 * `/documentation` is what the README points to for "available endpoints",
 * so `/mcp` stays listed — with how to connect to it, rather than a request
 * body the page could not send anyway. GET and DELETE are hidden: they exist
 * only so the SDK can answer them 405.
 */
export function createOpenapiTransform({ port }: { port: number }): Transform {
  return ({ schema, url, route, ...rest }) => {
    if (uiRoutes.includes(url)) return { schema: { hide: true }, url };
    if (url === "/mcp") {
      if (route.method !== "POST") return { schema: { hide: true }, url };
      return {
        schema: {
          summary: "MCP server (Streamable HTTP, JSON-RPC)",
          description: [
            "Read-only MCP server exposing the `query` and `metrics_discover` tools over this app's telemetry.",
            "",
            "Connect from Claude Code with:",
            "",
            `\`claude mcp add --transport http local-kopai http://localhost:${port}/mcp\``,
            "",
            "Accepts only loopback `Host` and browser `Origin` headers.",
          ].join("\n"),
        },
        url,
      };
    }
    return jsonSchemaTransform({ schema, url, route, ...rest });
  };
}
