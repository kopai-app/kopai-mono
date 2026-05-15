import {
  createRendererFromCatalog,
  type UITree,
  KopaiSDKProvider,
  type KopaiClient,
  observabilityCatalog,
} from "@kopai/ui-core";
import {
  Heading,
  Text,
  Card,
  Stack,
  Grid,
  Badge,
  Divider,
  Empty,
} from "../../dashboard/index.js";
import {
  OtelLogTimeline,
  OtelMetricBarChart,
  OtelMetricDiscovery,
  OtelMetricDonutChart,
  OtelMetricHistogram,
  OtelMetricLeaderboard,
  OtelMetricStat,
  OtelMetricTable,
  OtelMetricTimeSeries,
  OtelTraceDetail,
} from "../renderers/index.js";

const MetricsRenderer = createRendererFromCatalog(observabilityCatalog, {
  Card,
  Grid,
  Stack,
  Heading,
  Text,
  Badge,
  Divider,
  Empty,
  LogTimeline: OtelLogTimeline,
  TraceDetail: OtelTraceDetail,
  MetricTimeSeries: OtelMetricTimeSeries,
  MetricHistogram: OtelMetricHistogram,
  MetricStat: OtelMetricStat,
  MetricTable: OtelMetricTable,
  MetricDiscovery: OtelMetricDiscovery,
  MetricBarChart: OtelMetricBarChart,
  MetricDonutChart: OtelMetricDonutChart,
  MetricLeaderboard: OtelMetricLeaderboard,
});

export { type UITree };

export interface DynamicDashboardProps {
  kopaiClient: KopaiClient;
  uiTree: UITree;
}

export function DynamicDashboard({
  kopaiClient,
  uiTree,
}: DynamicDashboardProps) {
  return (
    <KopaiSDKProvider client={kopaiClient}>
      <MetricsRenderer tree={uiTree} />
    </KopaiSDKProvider>
  );
}
