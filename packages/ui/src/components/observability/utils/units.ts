export interface ResolvedScale {
  divisor: number;
  suffix: string;
  label: string;
  isPercent: boolean;
}

interface ScaleEntry {
  threshold: number;
  divisor: number;
  suffix: string;
}

const BYTE_SCALES: ScaleEntry[] = [
  { threshold: 1e12, divisor: 1e12, suffix: "TB" },
  { threshold: 1e9, divisor: 1e9, suffix: "GB" },
  { threshold: 1e6, divisor: 1e6, suffix: "MB" },
  { threshold: 1e3, divisor: 1e3, suffix: "KB" },
  { threshold: 0, divisor: 1, suffix: "B" },
];

const SECOND_SCALES: ScaleEntry[] = [
  { threshold: 3600, divisor: 3600, suffix: "h" },
  { threshold: 60, divisor: 60, suffix: "min" },
  { threshold: 1, divisor: 1, suffix: "s" },
  { threshold: 0, divisor: 0.001, suffix: "ms" },
];

const MS_SCALES: ScaleEntry[] = [
  { threshold: 1000, divisor: 1000, suffix: "s" },
  { threshold: 0, divisor: 1, suffix: "ms" },
];

const US_SCALES: ScaleEntry[] = [
  { threshold: 1e6, divisor: 1e6, suffix: "s" },
  { threshold: 1000, divisor: 1000, suffix: "ms" },
  { threshold: 0, divisor: 1, suffix: "\u03BCs" },
];

const GENERIC_SCALES: ScaleEntry[] = [
  { threshold: 1e9, divisor: 1e9, suffix: "B" },
  { threshold: 1e6, divisor: 1e6, suffix: "M" },
  { threshold: 1e3, divisor: 1e3, suffix: "K" },
  { threshold: 0, divisor: 1, suffix: "" },
];

const UNIT_SCALE_MAP: Record<string, ScaleEntry[]> = {
  By: BYTE_SCALES,
  s: SECOND_SCALES,
  ms: MS_SCALES,
  us: US_SCALES,
};

function pickScale(scales: ScaleEntry[], maxValue: number): ScaleEntry {
  const abs = Math.abs(maxValue);
  for (const s of scales) {
    if (abs >= s.threshold && s.threshold > 0) return s;
  }
  return scales[scales.length - 1]!;
}

export function resolveUnitScale(
  unit: string | null | undefined,
  maxValue: number
): ResolvedScale {
  if (!unit) {
    const s = pickScale(GENERIC_SCALES, maxValue);
    return {
      divisor: s.divisor,
      suffix: s.suffix,
      label: "",
      isPercent: false,
    };
  }

  // Dimensionless ratio → percent
  if (unit === "1") {
    return { divisor: 0.01, suffix: "%", label: "Percent", isPercent: true };
  }

  // Known unit families
  const scales = UNIT_SCALE_MAP[unit];
  if (scales) {
    const s = pickScale(scales, maxValue);
    return {
      divisor: s.divisor,
      suffix: s.suffix,
      label: s.suffix,
      isPercent: false,
    };
  }

  // Curly-brace units like {requests}
  const braceMatch = unit.match(/^\{(.+)\}$/);
  if (braceMatch) {
    const cleaned = braceMatch[1]!;
    const s = pickScale(GENERIC_SCALES, maxValue);
    const suffix = s.suffix ? `${s.suffix} ${cleaned}` : cleaned;
    return { divisor: s.divisor, suffix, label: cleaned, isPercent: false };
  }

  // Unknown unit — generic scaling + append unit
  const s = pickScale(GENERIC_SCALES, maxValue);
  const suffix = s.suffix ? `${s.suffix} ${unit}` : unit;
  return { divisor: s.divisor, suffix, label: unit, isPercent: false };
}

export function formatTickValue(value: number, scale: ResolvedScale): string {
  const scaled = value / scale.divisor;
  if (scale.isPercent) return `${scaled.toFixed(1)}`;
  if (Number.isInteger(scaled) && Math.abs(scaled) < 1e4)
    return scaled.toString();
  return scaled.toFixed(1);
}

export function formatDisplayValue(
  value: number,
  scale: ResolvedScale
): string {
  const tick = formatTickValue(value, scale);
  if (!scale.suffix) return tick;
  if (scale.isPercent) return `${tick}${scale.suffix}`;
  return `${tick} ${scale.suffix}`;
}

/** Convenience: resolve + format in one call (for MetricStat) */
export function formatOtelValue(value: number, unit: string): string {
  const scale = resolveUnitScale(unit, Math.abs(value));
  return formatDisplayValue(value, scale);
}
