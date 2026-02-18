import { describe, it, expect } from "vitest";
import { toNumber, toNumberArray } from "./row-mappers.js";

describe("toNumber", () => {
  it("parses numeric string", () => {
    expect(toNumber("123")).toBe(123);
  });

  it("returns undefined for empty string", () => {
    expect(toNumber("")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(toNumber(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(toNumber(undefined)).toBeUndefined();
  });

  it("passes through numbers", () => {
    expect(toNumber(42)).toBe(42);
  });

  it("returns undefined for non-numeric string", () => {
    expect(toNumber("abc")).toBeUndefined();
  });
});

describe("toNumberArray", () => {
  it("filters out non-numeric values", () => {
    expect(toNumberArray(["1", "abc", "3"])).toEqual([1, 3]);
  });

  it("returns undefined for empty array", () => {
    expect(toNumberArray([])).toBeUndefined();
  });

  it("converts valid string array", () => {
    expect(toNumberArray(["10", "20"])).toEqual([10, 20]);
  });
});
