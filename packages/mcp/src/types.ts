import type { datasource } from "@kopai/core";
import type { McpServer } from "@modelcontextprotocol/server";
import type { FastifyRequest } from "fastify";

/**
 * How a tool call ended. These labels are the server's whole error
 * vocabulary: they are the `error` code on a failed result, the `outcome` on
 * the observer event, and the values a counter is grouped by.
 *
 * `not_found` and `forbidden` are produced only by host tools (see
 * {@link HostTools}); the built-in tools never return them.
 */
export const TOOL_CALL_OUTCOMES = [
  "ok",
  "invalid_input",
  "result_too_large",
  "upstream_error",
  "not_found",
  "forbidden",
] as const;

export type ToolCallOutcome = (typeof TOOL_CALL_OUTCOMES)[number];

/**
 * The one method this package calls on a logger.
 *
 * Structural rather than Fastify's own type: the tool layer knows nothing
 * about HTTP, and a host that mounts this plugin somewhere else should not
 * have to produce a `FastifyBaseLogger` to get its failures written down.
 * `routes.ts` passes `request.log`, which satisfies it.
 */
export interface ToolLogger {
  error(payload: unknown, message?: string): void;
}

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

/**
 * Tools the host application adds to the same server as `query` and
 * `metrics_discover`, for data only the host has.
 *
 * Host tools follow the built-ins' conventions:
 *
 * - Results are built with `okResult` and `errorResult`, so the
 *   error contract holds for every tool on the server.
 * - The package observes them as it observes the built-ins: a throw becomes
 *   a logged `upstream_error` ("The tool call could not be completed."), the
 *   outcome is read from the result's `error` code, and `onToolCall` fires
 *   once per call (without `rowCount`).
 *   A host tool never calls `onToolCall` itself. An error result without a
 *   known code is counted as `upstream_error` and logged.
 * - `inputSchema` is built with `fromJsonSchema(schema, passThroughValidator)`
 *   and the handler validates, returning `invalid_input` with `issues`. The
 *   SDK's own validator rejects before dispatch, so the rejection would go
 *   uncounted and lose its `issues`; see `validator.ts`.
 * - No `outputSchema`; registering one, or adding one through `update`,
 *   throws. The SDK checks it after the
 *   callback returns, so a mismatch would be counted `ok` while the caller
 *   got the SDK's bare error.
 * - `McpServer` and `fromJsonSchema` are imported from `@kopai/mcp`, not from
 *   `@modelcontextprotocol/server`. They are the SDK's own, re-exported, at
 *   the version this package pins (2.3.1). `McpServer` has private fields, so
 *   a second copy of the SDK is a different, incompatible type.
 *
 * `register` is for tools. Prompts and resources registered through it are
 * neither checked nor observed.
 */
export interface HostTools {
  /**
   * Every name `register` may register. Checked once, at plugin registration:
   * a name that is not an MCP tool name (`[A-Za-z0-9._-]`, 1 to 128
   * characters), a duplicate, or a built-in name is refused with a
   * `TypeError`. An empty list is allowed.
   */
  names: string[];
  /**
   * Runs on each request's server, after the built-in tools are registered.
   * Registering, or renaming a tool to, a name not in `names` throws, and so
   * does renaming a tool onto a name already registered.
   *
   * Synchronous, because the SDK's server factory is; a returned promise
   * fails the request. Do the I/O that decides
   * which tools this caller gets in an async `preHandler`, attach the result
   * to the request, and read it here. A tool not registered for a request is
   * absent from that caller's `tools/list`.
   *
   * A throw fails the request; the server does not fall back to the built-in
   * tools alone.
   */
  register: (server: McpServer, request: FastifyRequest) => void;
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
   * An empty list is not the same as omitting it: it mounts a validator that
   * refuses every browser origin, which is a coherent thing to ask for and a
   * surprising thing to arrive at by accident. Non-browser clients send no
   * `Origin` and pass either way, so an accidental `[]` looks like "works for
   * my MCP client, broken for every page". Omit the option when the intent is
   * no validation. Any other wrong shape — `null` from a config that had no
   * list, a bare string — is refused at registration rather than mounted.
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
  /**
   * Where an upstream failure is written. Defaults to the Fastify instance's
   * own request logger; pass one only to send these somewhere else.
   */
  logger?: ToolLogger;
  /** Called once per completed tool call. Errors thrown here are swallowed. */
  onToolCall?: (event: ToolCallEvent) => void;
  /** Tools the host adds to the server. See {@link HostTools}. */
  hostTools?: HostTools;
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
