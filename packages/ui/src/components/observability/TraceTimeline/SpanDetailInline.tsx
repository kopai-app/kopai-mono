import { useState, useCallback } from "react";
import type { SpanNode } from "../types.js";
import { formatDuration, formatRelativeTime } from "../utils/time.js";
import { formatAttributeValue } from "../utils/attributes.js";
import { getServiceColor } from "../utils/colors.js";

interface SpanDetailInlineProps {
  span: SpanNode;
  traceStartMs: number;
}

interface CollapsibleSectionProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  count,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-blue-600 dark:hover:text-blue-400 py-1"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((p) => !p);
        }}
      >
        <span className="w-3 text-center">{open ? "▾" : "▸"}</span>
        {title}
        <span className="text-muted-foreground">({count})</span>
      </button>
      {open && <div className="ml-4 mt-1 space-y-1">{children}</div>}
    </div>
  );
}

function KeyValueRow({ k, v }: { k: string; v: unknown }) {
  const formatted = formatAttributeValue(v);
  return (
    <div className="flex gap-2 text-xs font-mono py-0.5">
      <span className="text-muted-foreground flex-shrink-0">{k}</span>
      <span className="text-foreground">=</span>
      <span className="text-foreground break-all">{formatted}</span>
    </div>
  );
}

export function SpanDetailInline({
  span,
  traceStartMs,
}: SpanDetailInlineProps) {
  const [copiedId, setCopiedId] = useState(false);
  const serviceColor = getServiceColor(span.serviceName);
  const relativeStartMs = span.startTimeUnixMs - traceStartMs;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(span.spanId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [span.spanId]);

  const spanAttrs = Object.entries(span.attributes).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const resourceAttrs = Object.entries(span.resourceAttributes).sort(
    ([a], [b]) => a.localeCompare(b)
  );

  return (
    <div
      className="border-b border-border bg-muted/50 px-4 py-3"
      style={{ borderLeft: `3px solid ${serviceColor}` }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-2">
        <div className="text-sm font-medium text-foreground">{span.name}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
          <span>
            Service: <span className="text-foreground">{span.serviceName}</span>
          </span>
          <span>
            Duration:{" "}
            <span className="text-foreground">
              {formatDuration(span.durationMs)}
            </span>
          </span>
          <span>
            Start:{" "}
            <span className="text-foreground">
              {formatDuration(relativeStartMs)}
            </span>
          </span>
          <span>
            Kind: <span className="text-foreground">{span.kind}</span>
          </span>
          {span.status !== "UNSET" && (
            <span>
              Status:{" "}
              <span
                className={
                  span.status === "ERROR" ? "text-red-500" : "text-foreground"
                }
              >
                {span.status}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Collapsible sections */}
      <div className="space-y-1">
        <CollapsibleSection title="Tags" count={spanAttrs.length}>
          {spanAttrs.map(([k, v]) => (
            <KeyValueRow key={k} k={k} v={v} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Process" count={resourceAttrs.length}>
          {resourceAttrs.map(([k, v]) => (
            <KeyValueRow key={k} k={k} v={v} />
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Events" count={span.events.length}>
          {span.events.map((event, i) => (
            <div
              key={i}
              className="text-xs border-l-2 border-border pl-2 py-1.5 space-y-0.5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground flex-shrink-0">
                  {formatRelativeTime(event.timeUnixMs, span.startTimeUnixMs)}
                </span>
                <span className="font-medium text-foreground">
                  {event.name}
                </span>
              </div>
              {Object.entries(event.attributes).map(([k, v]) => (
                <KeyValueRow key={k} k={k} v={v} />
              ))}
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection title="Links" count={span.links.length}>
          {span.links.map((link, i) => (
            <div key={i} className="text-xs font-mono py-0.5">
              <span className="text-muted-foreground">trace:</span>{" "}
              {link.traceId}{" "}
              <span className="text-muted-foreground">span:</span> {link.spanId}
            </div>
          ))}
        </CollapsibleSection>
      </div>

      {/* SpanID + copy */}
      <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground">SpanID:</span>
        <code className="text-xs font-mono text-foreground">{span.spanId}</code>
        <button
          onClick={handleCopy}
          className="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Copy span ID"
        >
          {copiedId ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
