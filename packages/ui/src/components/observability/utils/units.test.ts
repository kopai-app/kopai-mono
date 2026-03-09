import { describe, it, expect } from "vitest";
import {
  resolveUnitScale,
  formatTickValue,
  formatDisplayValue,
  formatOtelValue,
} from "./units.js";

describe("resolveUnitScale", () => {
  it("scales bytes to MB", () => {
    const s = resolveUnitScale("By", 3_500_000);
    expect(s.suffix).toBe("MB");
    expect(s.divisor).toBe(1e6);
    expect(s.label).toBe("MB");
  });

  it("keeps small bytes as B", () => {
    const s = resolveUnitScale("By", 500);
    expect(s.suffix).toBe("B");
    expect(s.divisor).toBe(1);
  });

  it("scales bytes to GB", () => {
    const s = resolveUnitScale("By", 2e9);
    expect(s.suffix).toBe("GB");
    expect(s.divisor).toBe(1e9);
  });

  it("scales seconds to ms for small values", () => {
    const s = resolveUnitScale("s", 0.005);
    expect(s.suffix).toBe("ms");
    expect(s.divisor).toBe(0.001);
  });

  it("keeps seconds as s for values >= 1", () => {
    const s = resolveUnitScale("s", 5);
    expect(s.suffix).toBe("s");
  });

  it("scales ms to s for large values", () => {
    const s = resolveUnitScale("ms", 5000);
    expect(s.suffix).toBe("s");
  });

  it("handles unit '1' as percent", () => {
    const s = resolveUnitScale("1", 0.75);
    expect(s.isPercent).toBe(true);
    expect(s.suffix).toBe("%");
    expect(s.label).toBe("Percent");
  });

  it("handles curly-brace units", () => {
    const s = resolveUnitScale("{requests}", 1_500_000);
    expect(s.suffix).toBe("M requests");
    expect(s.label).toBe("requests");
  });

  it("handles empty/null unit with generic scaling", () => {
    const s = resolveUnitScale("", 1_500_000);
    expect(s.suffix).toBe("M");
    expect(s.label).toBe("");
  });

  it("handles null unit", () => {
    const s = resolveUnitScale(null, 500);
    expect(s.suffix).toBe("");
  });
});

describe("formatTickValue", () => {
  it("formats scaled byte value", () => {
    const s = resolveUnitScale("By", 3_500_000);
    expect(formatTickValue(1_400_000, s)).toBe("1.4");
  });

  it("formats percent value", () => {
    const s = resolveUnitScale("1", 0.75);
    expect(formatTickValue(0.75, s)).toBe("75.0");
  });
});

describe("formatDisplayValue", () => {
  it("includes suffix for bytes", () => {
    const s = resolveUnitScale("By", 3_500_000);
    expect(formatDisplayValue(1_400_000, s)).toBe("1.4 MB");
  });

  it("includes suffix for percent", () => {
    const s = resolveUnitScale("1", 0.75);
    expect(formatDisplayValue(0.75, s)).toBe("75.0%");
  });

  it("includes suffix for curly-brace units", () => {
    const s = resolveUnitScale("{requests}", 1_500_000);
    expect(formatDisplayValue(1_500_000, s)).toBe("1.5 M requests");
  });

  it("no suffix for empty unit small values", () => {
    const s = resolveUnitScale("", 50);
    expect(formatDisplayValue(42, s)).toBe("42");
  });
});

describe("formatOtelValue", () => {
  it("convenience: bytes", () => {
    expect(formatOtelValue(3_500_000, "By")).toBe("3.5 MB");
  });

  it("convenience: percent", () => {
    expect(formatOtelValue(0.75, "1")).toBe("75.0%");
  });

  it("convenience: small value no unit", () => {
    expect(formatOtelValue(42, "")).toBe("42");
  });
});
