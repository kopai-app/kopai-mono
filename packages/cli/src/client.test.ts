import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

import { resolveConnectionOpts } from "./client.js";

describe("resolveConnectionOpts default URL", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/user");
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to localhost:8000 when no config or --url", () => {
    const { url } = resolveConnectionOpts({});
    expect(url).toBe("http://localhost:8000");
  });

  it("uses --url when provided, ignoring default", () => {
    const { url } = resolveConnectionOpts({ url: "https://api.kopai.app/v2" });
    expect(url).toBe("https://api.kopai.app/v2");
  });

  it("uses url from config file when no --url", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ url: "https://custom.example.com" })
    );

    const { url } = resolveConnectionOpts({});
    expect(url).toBe("https://custom.example.com");
  });
});
