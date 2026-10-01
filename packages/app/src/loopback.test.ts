/// <reference types="vitest/globals" />
import { localMcpUrl } from "./loopback.js";

describe("localMcpUrl", () => {
  it.each([
    ["localhost", "http://localhost:8000/mcp"],
    ["LOCALHOST", "http://localhost:8000/mcp"],
    ["127.0.0.1", "http://127.0.0.1:8000/mcp"],
    ["::1", "http://[::1]:8000/mcp"],
    ["0.0.0.0", "http://localhost:8000/mcp"],
    ["::", "http://localhost:8000/mcp"],
  ])("with HOST=%s is %s", (host, url) => {
    expect(localMcpUrl(host, 8000)).toBe(url);
  });

  // Bound to one LAN address, nothing listens on loopback and /mcp refuses the
  // LAN name, so no URL works.
  it.each(["192.168.1.5", "kopai.lan"])("with HOST=%s is undefined", (host) => {
    expect(localMcpUrl(host, 8000)).toBeUndefined();
  });
});
