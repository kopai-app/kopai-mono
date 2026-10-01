/**
 * The names /mcp answers for, in both its Host and Origin allow-lists.
 * Bracketed IPv6 is the form the validators compare against.
 *
 * NOTE neither list is network access control: a client on the LAN can send
 * any Host it likes. Always loopback, whatever HOST the server binds to —
 * widening this to a LAN address weakens the rebinding check and gains
 * nothing, since a LAN client can send Host: localhost anyway.
 */
export const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

const WILDCARD_HOSTS = ["0.0.0.0", "::"];

/**
 * The URL an MCP client on this machine should use, given the HOST the server
 * binds to, or undefined when there is none: bound to one specific non-loopback
 * address, nothing listens on loopback, and /mcp refuses the address itself.
 *
 * The banner and /documentation both print this, so they cannot disagree with
 * each other about whether MCP is reachable.
 */
export function localMcpUrl(host: string, port: number): string | undefined {
  const name = host.toLowerCase();
  if (WILDCARD_HOSTS.includes(name)) return `http://localhost:${port}/mcp`;
  if (name === "::1") return `http://[::1]:${port}/mcp`;
  if (name === "localhost" || name === "127.0.0.1") {
    return `http://${name}:${port}/mcp`;
  }
  return undefined;
}

/** What to print instead of a URL when {@link localMcpUrl} has none. */
export const MCP_UNAVAILABLE_HINT = "bind HOST to localhost";
