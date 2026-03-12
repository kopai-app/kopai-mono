export interface SpanSearchProps {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  currentMatch: number;
  onPrev: () => void;
  onNext: () => void;
}

export function SpanSearch({
  value,
  onChange,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
}: SpanSearchProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-background">
      <input
        type="text"
        placeholder="Find..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-muted text-foreground text-sm px-2 py-0.5 rounded border border-border outline-none focus:border-blue-500 w-48"
      />
      {value && (
        <>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : "0 matches"}
          </span>
          <button
            onClick={onPrev}
            disabled={matchCount === 0}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Previous match"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
          <button
            onClick={onNext}
            disabled={matchCount === 0}
            className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Next match"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
