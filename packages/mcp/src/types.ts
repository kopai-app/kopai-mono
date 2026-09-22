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
