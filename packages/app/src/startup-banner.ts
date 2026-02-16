import { networkInterfaces } from "node:os";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const cyan = "\x1b[36m";
const reset = "\x1b[0m";

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

  lines.push("");
  console.log(lines.join("\n"));
}
