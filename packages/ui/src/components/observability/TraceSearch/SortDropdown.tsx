/**
 * SortDropdown - Sort control for trace results.
 */

export interface SortDropdownProps {
  value: string;
  onChange: (sort: string) => void;
}

const SORT_OPTIONS = [
  { value: "recent", label: "Most Recent" },
  { value: "longest", label: "Longest First" },
  { value: "shortest", label: "Shortest First" },
  { value: "mostSpans", label: "Most Spans" },
  { value: "leastSpans", label: "Least Spans" },
] as const;

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-muted/50 border border-border rounded px-2 py-1.5 text-sm text-foreground"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
