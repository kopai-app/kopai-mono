export interface ServiceEntry {
  name: string;
}

export interface ServiceListProps {
  services: ServiceEntry[];
  isLoading?: boolean;
  error?: Error;
  onSelect: (name: string) => void;
}

export function ServiceList({
  services,
  isLoading,
  error,
  onSelect,
}: ServiceListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        Loading services...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 py-4">
        Error loading services: {error.message}
      </div>
    );
  }

  if (services.length === 0) {
    return <div className="text-muted-foreground py-8">No services found</div>;
  }

  return (
    <div className="space-y-1">
      {services.map((svc) => (
        <button
          key={svc.name}
          onClick={() => onSelect(svc.name)}
          className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-foreground/30 hover:bg-muted/50 transition-colors group"
        >
          <span className="font-medium text-foreground">{svc.name}</span>
        </button>
      ))}
    </div>
  );
}
