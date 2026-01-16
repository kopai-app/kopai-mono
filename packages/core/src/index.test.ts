import { describe, it, expect } from "vitest";
import { name } from "./index.js";

describe("@kopai/core", () => {
  it("should export name", () => {
    expect(name).toBe("@kopai/core");
  });
});
