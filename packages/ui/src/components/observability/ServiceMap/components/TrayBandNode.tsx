/**
 * Background band behind the tray (R2-8): services not connected to the
 * hub's part of the map yet. The tray nodes themselves are normal, findable
 * service nodes laid out in wrapping rows on top of this band.
 */
import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface TrayBandData extends Record<string, unknown> {
  count: number;
  width: number;
  height: number;
}

export type TrayBandFlowNode = Node<TrayBandData, "trayBand">;

export function trayBandLabel(count: number): string {
  return `Not connected to the map yet · ${count.toLocaleString("en-US")}`;
}

function TrayBandNodeImpl({ data }: NodeProps<TrayBandFlowNode>) {
  return (
    <div
      className="sm-tray-band pointer-events-none rounded-lg border border-dashed border-border bg-card/60"
      style={{ width: data.width, height: data.height }}
      role="group"
      aria-label={trayBandLabel(data.count)}
    >
      <div className="px-3 pt-2 text-xs text-muted-foreground">
        {trayBandLabel(data.count)}
      </div>
    </div>
  );
}

export const TrayBandNode = memo(TrayBandNodeImpl);
