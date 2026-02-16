import { describe, it, expect } from "vitest";
import {
  coerceAttributeValue,
  coerceAttributes,
  coerceAttributesArray,
} from "./attributes.js";

describe("coerceAttributeValue", () => {
  it("returns true for 'true'", () => {
    expect(coerceAttributeValue("true")).toBe(true);
  });

  it("returns false for 'false'", () => {
    expect(coerceAttributeValue("false")).toBe(false);
  });

  it("returns number for integer string", () => {
    expect(coerceAttributeValue("123")).toBe(123);
  });

  it("returns number for float string", () => {
    expect(coerceAttributeValue("3.14")).toBe(3.14);
  });

  it("returns number for zero", () => {
    expect(coerceAttributeValue("0")).toBe(0);
  });

  it("returns number for negative number", () => {
    expect(coerceAttributeValue("-42")).toBe(-42);
  });

  it("returns string for plain text", () => {
    expect(coerceAttributeValue("hello")).toBe("hello");
  });

  it("returns string for empty string", () => {
    expect(coerceAttributeValue("")).toBe("");
  });

  it("returns number for zip code-like value", () => {
    // JSON.parse("90210") is a valid number
    expect(coerceAttributeValue("90210")).toBe(90210);
  });

  it("returns string for Infinity", () => {
    // JSON.parse("Infinity") throws
    expect(coerceAttributeValue("Infinity")).toBe("Infinity");
  });

  it("returns string for NaN", () => {
    // JSON.parse("NaN") throws
    expect(coerceAttributeValue("NaN")).toBe("NaN");
  });
});

describe("coerceAttributes", () => {
  it("returns undefined for null", () => {
    expect(coerceAttributes(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(coerceAttributes(undefined)).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(coerceAttributes({})).toBeUndefined();
  });

  it("coerces mixed attribute types", () => {
    const result = coerceAttributes({
      "http.method": "GET",
      "http.status_code": "200",
      error: "true",
      retries: "3",
    });
    expect(result).toEqual({
      "http.method": "GET",
      "http.status_code": 200,
      error: true,
      retries: 3,
    });
  });
});

describe("coerceAttributesArray", () => {
  it("returns undefined for empty array", () => {
    expect(coerceAttributesArray([])).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(coerceAttributesArray(null)).toBeUndefined();
  });

  it("coerces array of attribute maps", () => {
    const result = coerceAttributesArray([
      { key1: "value1", key2: "42" },
      { key3: "true" },
    ]);
    expect(result).toEqual([{ key1: "value1", key2: 42 }, { key3: true }]);
  });
});
