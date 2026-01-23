import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";
import {
  KopaiError,
  KopaiNetworkError,
  KopaiTimeoutError,
  KopaiValidationError,
} from "./errors.js";

describe("KopaiError", () => {
  it("creates error with all properties", () => {
    const error = new KopaiError({
      message: "Bad Request",
      code: "INVALID_FILTER",
      status: 400,
      type: "https://api.kopai.io/errors/invalid-filter",
      detail: "Filter field 'foo' is invalid",
    });

    expect(error.name).toBe("KopaiError");
    expect(error.message).toBe("Bad Request");
    expect(error.code).toBe("INVALID_FILTER");
    expect(error.status).toBe(400);
    expect(error.type).toBe("https://api.kopai.io/errors/invalid-filter");
    expect(error.detail).toBe("Filter field 'foo' is invalid");
    expect(error).toBeInstanceOf(Error);
  });

  it("creates error without optional detail", () => {
    const error = new KopaiError({
      message: "Unauthorized",
      code: "UNAUTHORIZED",
      status: 401,
      type: "about:blank",
    });

    expect(error.detail).toBeUndefined();
  });
});

describe("KopaiNetworkError", () => {
  it("creates error with message", () => {
    const error = new KopaiNetworkError("Connection refused");

    expect(error.name).toBe("KopaiNetworkError");
    expect(error.message).toBe("Connection refused");
    expect(error.cause).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
  });

  it("creates error with cause", () => {
    const cause = new TypeError("Failed to fetch");
    const error = new KopaiNetworkError("Network request failed", cause);

    expect(error.cause).toBe(cause);
  });
});

describe("KopaiTimeoutError", () => {
  it("creates error with timeout", () => {
    const error = new KopaiTimeoutError(5000);

    expect(error.name).toBe("KopaiTimeoutError");
    expect(error.message).toBe("Request timed out after 5000ms");
    expect(error.timeout).toBe(5000);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("KopaiValidationError", () => {
  it("creates error with ZodError", () => {
    const schema = z.object({ id: z.string() });
    let zodError: ZodError;

    try {
      schema.parse({ id: 123 });
    } catch (e) {
      zodError = e as ZodError;
    }

    const error = new KopaiValidationError(zodError!);

    expect(error.name).toBe("KopaiValidationError");
    expect(error.message).toContain("Response validation failed");
    expect(error.zodError).toBe(zodError!);
    expect(error).toBeInstanceOf(Error);
  });
});
