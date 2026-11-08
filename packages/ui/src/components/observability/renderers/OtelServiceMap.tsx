import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import { ServiceMap } from "../ServiceMap/ServiceMapLazy.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.ServiceMap
>;

/** Canvas height when the tree leaves it null. */
export const DASHBOARD_MAP_HEIGHT = 480;
/** Smallest canvas height a dashboard can ask for. */
export const DASHBOARD_MAP_MIN_HEIGHT = 240;

/**
 * The Service Map as a dashboard tile. It takes no dataSource: the map
 * fetches its own data. It reads from the nearest `ServiceMapSourceProvider`
 * (the observability page sets one, so tiles share the page's worker
 * session), else in-process with the dashboard's client. Every map tile with
 * the same source shares one session.
 */
export function OtelServiceMap({ element }: Props) {
  const h = element.props.height;
  const height =
    typeof h === "number" && Number.isFinite(h)
      ? Math.max(DASHBOARD_MAP_MIN_HEIGHT, Math.round(h))
      : DASHBOARD_MAP_HEIGHT;
  return <ServiceMap height={height} />;
}
