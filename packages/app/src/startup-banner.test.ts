/// <reference types="vitest/globals" />
import { stripVTControlCharacters } from "node:util";

import { printStartupBanner } from "./startup-banner.js";

/**
 * The banner's MCP row for a given HOST, with ANSI stripped so the assertions
 * hold whether or not the runner has a TTY.
 */
function mcpLine(host: string): string {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    printStartupBanner({ host, port: 8000, collectorPort: 4318, version: "0" });
    const out = stripVTControlCharacters(String(log.mock.calls[0]?.[0]));
    return out.split("\n").find((l) => l.includes("MCP")) ?? "";
  } finally {
    log.mockRestore();
  }
}

describe("the MCP row of the startup banner", () => {
  it.each([
    ["localhost", "http://localhost:8000/mcp"],
    ["LOCALHOST", "http://localhost:8000/mcp"],
    ["127.0.0.1", "http://127.0.0.1:8000/mcp"],
    ["::1", "http://[::1]:8000/mcp"],
    ["0.0.0.0", "http://localhost:8000/mcp"],
    ["::", "http://localhost:8000/mcp"],
  ])("with HOST=%s shows %s", (host, url) => {
    expect(mcpLine(host)).toContain(url);
  });

  // The endpoint refuses non-loopback Host headers, so a LAN URL would 403.
  it("never shows a network URL, even when bound to every interface", () => {
    expect(mcpLine("0.0.0.0").match(/http:\/\//g)).toHaveLength(1);
  });

  // Bound to one LAN address, nothing listens on loopback and the LAN name
  // is refused: no URL would work, so none is printed.
  it("says MCP is unavailable when bound to a specific non-loopback address", () => {
    const line = mcpLine("192.168.1.5");
    expect(line).not.toContain("http://");
    expect(line).toContain("unavailable");
    expect(line).toContain("bind HOST to localhost");
    // 0.0.0.0 would expose the whole unauthenticated API to the network.
    expect(line).not.toContain("0.0.0.0");
  });
});
