import { describe, it, expect } from "vitest";
import { nanosToDateTime64, dateTime64ToNanos } from "./timestamp.js";

describe("nanosToDateTime64", () => {
  it("converts epoch zero", () => {
    expect(nanosToDateTime64("0")).toBe("1970-01-01 00:00:00.000000000");
  });

  it("converts a timestamp with nanosecond precision", () => {
    // 2024-01-01 00:00:00.123456789 UTC
    expect(nanosToDateTime64("1704067200123456789")).toBe(
      "2024-01-01 00:00:00.123456789"
    );
  });

  it("converts a timestamp with zero fractional", () => {
    // 2024-01-01 00:00:00.000000000 UTC
    expect(nanosToDateTime64("1704067200000000000")).toBe(
      "2024-01-01 00:00:00.000000000"
    );
  });

  it("converts a timestamp with milliseconds only", () => {
    // 2024-01-01 00:00:00.500000000 UTC
    expect(nanosToDateTime64("1704067200500000000")).toBe(
      "2024-01-01 00:00:00.500000000"
    );
  });
});

describe("dateTime64ToNanos", () => {
  it("converts epoch zero", () => {
    expect(dateTime64ToNanos("1970-01-01 00:00:00.000000000")).toBe("0");
  });

  it("converts a timestamp with nanosecond precision", () => {
    expect(dateTime64ToNanos("2024-01-01 00:00:00.123456789")).toBe(
      "1704067200123456789"
    );
  });

  it("converts a timestamp with zero fractional", () => {
    expect(dateTime64ToNanos("2024-01-01 00:00:00.000000000")).toBe(
      "1704067200000000000"
    );
  });

  it("handles missing fractional part", () => {
    expect(dateTime64ToNanos("2024-01-01 00:00:00")).toBe(
      "1704067200000000000"
    );
  });
});

describe("round-trip", () => {
  it("preserves nanosecond precision through round-trip", () => {
    const original = "1704067200123456789";
    const dt64 = nanosToDateTime64(original);
    const roundTripped = dateTime64ToNanos(dt64);
    expect(roundTripped).toBe(original);
  });

  it("preserves various timestamps through round-trip", () => {
    const timestamps = [
      "0",
      "1000000000000000000", // 2001-09-09
      "1704067200000000000", // 2024-01-01
      "1704067200999999999", // max nanos in a second
    ];

    for (const ts of timestamps) {
      const dt64 = nanosToDateTime64(ts);
      const roundTripped = dateTime64ToNanos(dt64);
      expect(roundTripped).toBe(ts);
    }
  });
});
