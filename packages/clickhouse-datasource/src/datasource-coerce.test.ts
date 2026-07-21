/// <reference types="vitest/globals" />
import {
  coerceAggregateCellValue,
  coerceMeasureCellValue,
} from "./datasource.js";

// N1: ClickHouse aggregate cells must coerce to the same value union as the
// sqlite backend. The key parity point is bigint precision: a value beyond the
// 53-bit safe-integer range is preserved as a string, not silently rounded by
// Number() (which is what the previous inline coercion did).
describe("coerceAggregateCellValue", () => {
  it("preserves a bigint beyond MAX_SAFE_INTEGER as a string (not rounded)", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
    expect(coerceAggregateCellValue(big)).toBe(big.toString());
  });

  it("preserves a bigint below MIN_SAFE_INTEGER as a string", () => {
    const small = BigInt(Number.MIN_SAFE_INTEGER) - 10n;
    expect(coerceAggregateCellValue(small)).toBe(small.toString());
  });

  it("coerces a safe-range bigint to a number", () => {
    expect(coerceAggregateCellValue(42n)).toBe(42);
  });

  it("passes through strings and numbers", () => {
    expect(coerceAggregateCellValue("svc")).toBe("svc");
    expect(coerceAggregateCellValue(3.14)).toBe(3.14);
  });

  it("maps booleans to 0/1 and null/undefined to null", () => {
    expect(coerceAggregateCellValue(true)).toBe(1);
    expect(coerceAggregateCellValue(false)).toBe(0);
    expect(coerceAggregateCellValue(null)).toBeNull();
    expect(coerceAggregateCellValue(undefined)).toBeNull();
  });
});

// CH-3: ClickHouse serializes integer aggregates (count/sum/min/max →
// UInt64/Int64) as JSON strings, while Float64 aggregates (avg/percentiles)
// arrive as numbers. SQLite returns numbers for all of them, so measure cells
// must coerce string integers/floats to numbers — while preserving the
// huge-integer-stays-string guard that keeps the two backends consistent.
describe("coerceMeasureCellValue", () => {
  it("coerces a UInt64 count serialized as a string to a number", () => {
    expect(coerceMeasureCellValue("42")).toBe(42);
  });

  it("coerces a Float64 string to a number", () => {
    expect(coerceMeasureCellValue("3.14")).toBe(3.14);
  });

  it("passes through values already numeric", () => {
    expect(coerceMeasureCellValue(7)).toBe(7);
    expect(coerceMeasureCellValue(0.5)).toBe(0.5);
  });

  it("preserves an integer string beyond MAX_SAFE_INTEGER as a string", () => {
    const big = (BigInt(Number.MAX_SAFE_INTEGER) + 10n).toString();
    expect(coerceMeasureCellValue(big)).toBe(big);
  });

  it("preserves an integer string below MIN_SAFE_INTEGER as a string", () => {
    const small = (BigInt(Number.MIN_SAFE_INTEGER) - 10n).toString();
    expect(coerceMeasureCellValue(small)).toBe(small);
  });

  it("preserves a safe-range bigint and stringifies an out-of-range one", () => {
    expect(coerceMeasureCellValue(42n)).toBe(42);
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
    expect(coerceMeasureCellValue(big)).toBe(big.toString());
  });

  it("maps booleans to 0/1 and null/undefined to null", () => {
    expect(coerceMeasureCellValue(true)).toBe(1);
    expect(coerceMeasureCellValue(false)).toBe(0);
    expect(coerceMeasureCellValue(null)).toBeNull();
    expect(coerceMeasureCellValue(undefined)).toBeNull();
  });

  it("leaves a non-numeric string intact (defensive)", () => {
    expect(coerceMeasureCellValue("nan-ish")).toBe("nan-ish");
  });
});
