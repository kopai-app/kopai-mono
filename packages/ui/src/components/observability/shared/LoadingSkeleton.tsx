export function LoadingSkeleton() {
  return (
    <div className="flex flex-col h-full bg-background animate-pulse">
      <div className="border-b border-border p-4">
        <div className="h-4 bg-muted rounded w-1/4 mb-3"></div>
        <div className="flex gap-4">
          <div className="h-3 bg-muted rounded w-32"></div>
          <div className="h-3 bg-muted rounded w-24"></div>
          <div className="h-3 bg-muted rounded w-20"></div>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-2">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-4 bg-muted rounded w-32"></div>
            <div
              className="h-4 rounded w-16"
              style={{
                backgroundColor:
                  i % 4 === 0
                    ? "#ef4444"
                    : i % 4 === 1
                      ? "#f97316"
                      : i % 4 === 2
                        ? "#3b82f6"
                        : "#6b7280",
                opacity: 0.3,
              }}
            ></div>
            <div
              className="h-4 bg-muted rounded"
              style={{ width: `${80 + ((i * 7) % 40)}px` }}
            ></div>
            <div
              className="h-4 bg-muted/80 rounded flex-1"
              style={{ maxWidth: `${300 + ((i * 13) % 200)}px` }}
            ></div>
          </div>
        ))}
      </div>
    </div>
  );
}
