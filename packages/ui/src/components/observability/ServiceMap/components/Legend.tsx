/** Legend for the Service Map: shapes, hub, error cue, line thickness, dimming, virtual edges. */
import type { ReactNode } from "react";
import {
  DIM_OPACITY,
  EDGE_COLOR,
  VIRTUAL_DASH,
  VIRTUAL_FILL,
  VIRTUAL_STROKE,
} from "./edge-style.js";

const SVC_FILL = "hsl(210 70% 50% / 0.35)";
const SVC_STROKE = "hsl(210 70% 50%)";

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {children}
    </svg>
  );
}

export function Legend() {
  return (
    <ul
      className="sm-legend flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      <li className="flex items-center gap-1.5">
        <Swatch>
          <circle
            cx="9"
            cy="9"
            r="7"
            fill={SVC_FILL}
            stroke={SVC_STROKE}
            strokeWidth="1.6"
          />
        </Swatch>
        Service (size = spans)
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch>
          <rect
            x="2"
            y="2"
            width="14"
            height="14"
            rx="3"
            fill={VIRTUAL_FILL}
            stroke={VIRTUAL_STROKE}
            strokeWidth="1.6"
          />
        </Swatch>
        Database / cache
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch>
          <polygon
            points="9,1.5 16.5,9 9,16.5 1.5,9"
            fill={VIRTUAL_FILL}
            stroke={VIRTUAL_STROKE}
            strokeWidth="1.6"
          />
        </Swatch>
        Queue / topic
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch>
          <circle
            cx="9"
            cy="9"
            r="7"
            fill={VIRTUAL_FILL}
            stroke={VIRTUAL_STROKE}
            strokeWidth="1.6"
            strokeDasharray="3 2.5"
          />
        </Swatch>
        External API
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch>
          <circle
            cx="9"
            cy="9"
            r="7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="9" cy="9" r="4.5" fill={SVC_FILL} stroke={SVC_STROKE} />
        </Swatch>
        Centre (busiest connected service)
      </li>
      <li className="flex items-center gap-1.5">
        <svg width="28" height="10" aria-hidden="true">
          <line
            x1="0"
            y1="2"
            x2="28"
            y2="2"
            stroke={EDGE_COLOR}
            strokeWidth="1"
          />
          <line
            x1="0"
            y1="7"
            x2="28"
            y2="7"
            stroke={EDGE_COLOR}
            strokeWidth="3.5"
          />
        </svg>
        Line thickness = calls in the past 60 min (sampled)
      </li>
      <li
        className="flex items-center gap-1.5"
        title="Database, queue and external API connections come from client and producer span attributes (peer.service, db.system.name, messaging.destination.name, server.address). A server.address that names a host with no instrumented service also shows up as an external API."
      >
        <svg width="28" height="10" aria-hidden="true">
          <line
            x1="0"
            y1="5"
            x2="28"
            y2="5"
            stroke={EDGE_COLOR}
            strokeWidth="2"
            strokeDasharray={VIRTUAL_DASH}
          />
        </svg>
        Dashed = inferred from client spans
      </li>
      <li className="flex items-center gap-1.5">
        <span style={{ opacity: DIM_OPACITY }} aria-hidden="true">
          <Swatch>
            <circle
              cx="9"
              cy="9"
              r="7"
              fill={SVC_FILL}
              stroke={SVC_STROKE}
              strokeWidth="1.6"
            />
          </Swatch>
        </span>
        Dimmed = no traffic in the past 60 min
      </li>
    </ul>
  );
}
