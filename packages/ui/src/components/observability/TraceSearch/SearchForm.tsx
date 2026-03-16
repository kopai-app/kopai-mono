/**
 * SearchForm - Jaeger-style sidebar search form for trace filtering.
 * Owns its own form state; parent only receives values on submit.
 */

import { useState, useEffect } from "react";

export interface SearchFormValues {
  service: string;
  operation: string;
  tags: string;
  lookback: string;
  minDuration: string;
  maxDuration: string;
  limit: number;
}

export interface SearchFormProps {
  services: string[];
  operations: string[];
  initialValues?: Partial<SearchFormValues>;
  onSubmit: (values: SearchFormValues) => void;
  isLoading?: boolean;
}

const LOOKBACK_OPTIONS = [
  { label: "Last 5 Minutes", value: "5m" },
  { label: "Last 15 Minutes", value: "15m" },
  { label: "Last 30 Minutes", value: "30m" },
  { label: "Last 1 Hour", value: "1h" },
  { label: "Last 2 Hours", value: "2h" },
  { label: "Last 6 Hours", value: "6h" },
  { label: "Last 12 Hours", value: "12h" },
  { label: "Last 24 Hours", value: "24h" },
] as const;

const inputClass =
  "w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground";

export function SearchForm({
  services,
  operations,
  initialValues,
  onSubmit,
  isLoading,
}: SearchFormProps) {
  const [service, setService] = useState(initialValues?.service ?? "");
  const [operation, setOperation] = useState(initialValues?.operation ?? "");
  const [tags, setTags] = useState(initialValues?.tags ?? "");
  const [lookback, setLookback] = useState(initialValues?.lookback ?? "");
  const [minDuration, setMinDuration] = useState(
    initialValues?.minDuration ?? ""
  );
  const [maxDuration, setMaxDuration] = useState(
    initialValues?.maxDuration ?? ""
  );
  const [limit, setLimit] = useState(initialValues?.limit ?? 20);

  // Sync service from URL-driven changes
  useEffect(() => {
    if (initialValues?.service != null) setService(initialValues.service);
  }, [initialValues?.service]);

  const handleSubmit = () => {
    onSubmit({
      service,
      operation,
      tags,
      lookback,
      minDuration,
      maxDuration,
      limit,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
        Search
      </h3>

      {/* Service */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Service</span>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className={inputClass}
        >
          <option value="">All Services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {/* Operation */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Operation</span>
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
          className={inputClass}
        >
          <option value="">All Operations</option>
          {operations.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </label>

      {/* Tags */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Tags</span>
        <textarea
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder={'key=value key2="quoted value"'}
          rows={3}
          className={`${inputClass} placeholder:text-muted-foreground/50 resize-y`}
        />
      </label>

      {/* Lookback */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Lookback</span>
        <select
          value={lookback}
          onChange={(e) => setLookback(e.target.value)}
          className={inputClass}
        >
          <option value="">All time</option>
          {LOOKBACK_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {/* Min / Max Duration */}
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Min Duration</span>
          <input
            type="text"
            placeholder="e.g. 100ms"
            value={minDuration}
            onChange={(e) => setMinDuration(e.target.value)}
            className={`${inputClass} placeholder:text-muted-foreground/50`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Max Duration</span>
          <input
            type="text"
            placeholder="e.g. 5s"
            value={maxDuration}
            onChange={(e) => setMaxDuration(e.target.value)}
            className={`${inputClass} placeholder:text-muted-foreground/50`}
          />
        </label>
      </div>

      {/* Limit */}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Limit</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={limit}
          onChange={(e) => {
            const n = Number(e.target.value);
            setLimit(Number.isNaN(n) ? 20 : Math.max(1, Math.min(1000, n)));
          }}
          className={inputClass}
        />
      </label>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isLoading}
        className="w-full px-4 py-2 text-sm font-medium bg-foreground text-background rounded hover:bg-foreground/90 transition-colors disabled:opacity-50"
      >
        {isLoading ? "Searching..." : "Find Traces"}
      </button>
    </div>
  );
}
