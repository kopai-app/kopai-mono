import { networkInterfaces } from "node:os";

import { localMcpUrl, MCP_UNAVAILABLE_HINT } from "./loopback.js";

const isTTY = process.stdout.isTTY;
const bold = isTTY ? "\x1b[1m" : "";
const dim = isTTY ? "\x1b[2m" : "";
const green = isTTY ? "\x1b[32m" : "";
const cyan = isTTY ? "\x1b[36m" : "";
const reset = isTTY ? "\x1b[0m" : "";

function getNetworkAddress(): string | undefined {
  const nets = networkInterfaces();
  for (const interfaces of Object.values(nets)) {
    if (!interfaces) continue;
    for (const net of interfaces) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return undefined;
}

/**
 * Prints the URLs the app is reachable at. The MCP row shows only the local
 * URL, from {@link localMcpUrl}, because `/mcp` refuses the network address.
 */
export function printStartupBanner({
  host,
  port,
  collectorPort,
  version,
}: {
  host: string;
  port: number;
  collectorPort: number;
  version: string;
}) {
  const localHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  const networkAddress = getNetworkAddress();

  const lines: string[] = [
    "",
    `  ${bold}${green}|--k> @kopai/app${reset} ${dim}v${version}${reset}`,
    "",
  ];

  const rows: [string, string, string][] = [
    ["Dashboard", `http://${localHost}:${port}`, ""],
    ["API Docs", `http://${localHost}:${port}/documentation`, "/documentation"],
    ["Collector", `http://${localHost}:${collectorPort}`, ""],
  ];

  const mcpUrl = localMcpUrl(host, port);

  const maxLocalLen = Math.max(...rows.map(([, url]) => url.length));

  for (const [label, localUrl, path] of rows) {
    const padded = localUrl.padEnd(maxLocalLen);
    let line = `  ${green}▸${reset} ${bold}${label.padEnd(16)}${reset}${cyan}${padded}${reset}`;
    if (networkAddress) {
      const netPort = label === "Collector" ? collectorPort : port;
      const netUrl = `http://${networkAddress}:${netPort}${path}`;
      line += `  ${dim}${cyan}${netUrl}${reset}`;
    }
    lines.push(line);
  }

  // Local URL only: the endpoint refuses the network address by design.
  lines.push(
    mcpUrl
      ? `  ${green}▸${reset} ${bold}${"MCP".padEnd(16)}${reset}${cyan}${mcpUrl}${reset}`
      : `  ${green}▸${reset} ${bold}${"MCP".padEnd(16)}${reset}${dim}unavailable (${MCP_UNAVAILABLE_HINT})${reset}`
  );

  lines.push("");
  console.log(lines.join("\n"));
}
