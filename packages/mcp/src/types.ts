import type { datasource } from "@kopai/core";
import type { FastifyRequest } from "fastify";

/**
 * How a tool call ended. These four labels are the server's whole error
 * vocabulary: they are the `error` code on a failed result, the `outcome` on
 * the observer event, and the values a counter is grouped by.
 */
export type ToolCallOutcome =
  "ok" | "invalid_input" | "result_too_large" | "upstream_error";

/**
 * One completed tool call, handed to `onToolCall`.
 *
 * WHY the raw request is included: this plugin is open source and mounts in
 * two applications that know different things about a caller. It deliberately
 * does not learn about tenants or credentials; the host application reads
 * whatever it attached to the request and does its own counting and logging.
 */
export interface ToolCallEvent {
  tool: string;
  outcome: ToolCallOutcome;
  durationMs: number;
  /** Rows returned, when the tool returned rows. */
  rowCount?: number;
  request: FastifyRequest;
}

export interface McpRoutesOptions {
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  /**
   * Hostnames the MCP endpoint answers for, compared port-agnostically. A
   * request whose `Host` is not on this list is refused, which is what stops
   * a DNS-rebinding page from reaching a local server.
   */
  allowedHosts: string[];
  /**
   * Hostnames that may appear in a browser's `Origin` header. Omit to mount no
   * origin validation at all, which is the default.
   *
   * WHY hostnames, and why a separate list from {@link allowedHosts}: the two
   * answer different questions. `allowedHosts` is the hostname this server is
   * reached at; this is the hostname of a page allowed to reach it. On a local
   * app they coincide, both being loopback. On a deployed one they do not —
   * the API and the dashboard live at different names — so conflating them
   * either refuses the dashboard or forces the host list wide enough to weaken
   * the rebinding check.
   *
   * WHY hostnames and not origins: the underlying validator compares
   * hostnames, port-agnostically. Passing a full origin such as
   * `"https://app.example.com"` refuses that very origin, and passing `"*"`
   * refuses everything — both silently, since either is a valid `string[]`.
   * Anything shaped like a CORS `origin` list belongs in a CORS plugin, not
   * here.
   *
   * A request with no `Origin` header passes by design, so non-browser clients
   * are unaffected; only browsers are constrained.
   */
  allowedOriginHostnames?: string[];
  /** Called once per completed tool call. Errors thrown here are swallowed. */
  onToolCall?: (event: ToolCallEvent) => void;
}

// Mirrors the identical augmentation in `@kopai/api`. Both packages mount into
// the same Fastify instance and neither depends on the other, so each declares
// what it reads. The declarations are structurally identical, which is what
// keeps them compatible when both are present.
declare module "fastify" {
  interface FastifyRequest {
    requestContext?: unknown;
  }
}
