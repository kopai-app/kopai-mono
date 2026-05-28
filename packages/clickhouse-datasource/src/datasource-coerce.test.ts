/// <reference types="vitest/globals" />
import { coerceAggregateCellValue } from "./datasource.js";

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
