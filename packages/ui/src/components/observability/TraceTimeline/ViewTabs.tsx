export interface ViewTabsProps {
  activeView: string;
  onChange: (view: string) => void;
}

const VIEWS = ["timeline", "graph", "statistics", "flamegraph"] as const;

const VIEW_LABELS: Record<string, string> = {
  timeline: "Timeline",
  graph: "Graph",
  statistics: "Statistics",
  flamegraph: "Flamegraph",
};

export function ViewTabs({ activeView, onChange }: ViewTabsProps) {
  return (
    <div className="flex border-b border-border bg-background">
      {VIEWS.map((view) => (
        <button
          key={view}
          onClick={() => onChange(view)}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            activeView === view
              ? "text-foreground border-b-2 border-blue-500"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {VIEW_LABELS[view]}
        </button>
      ))}
    </div>
  );
}
