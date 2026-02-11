export interface Tab {
  key: string;
  label: string;
  shortcutKey?: string;
}

export interface TabBarProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}

function renderLabel(label: string, shortcutKey?: string) {
  if (!shortcutKey) return label;
  const idx = label.toLowerCase().indexOf(shortcutKey.toLowerCase());
  if (idx === -1) return label;
  return (
    <>
      {label.slice(0, idx)}
      <span className="underline underline-offset-4">{label[idx]}</span>
      {label.slice(idx + 1)}
    </>
  );
}

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div role="tablist" className="flex border-b border-border mb-6">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.key
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {renderLabel(t.label, t.shortcutKey)}
        </button>
      ))}
    </div>
  );
}
