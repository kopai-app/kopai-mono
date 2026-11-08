import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { KopaiClient } from "@kopai/ui-core";
import type { kopaiQuery } from "@kopai/core";
import { DynamicDashboard, type UITree } from "../DynamicDashboard/index.js";
import { ServiceMap } from "./ServiceMapLazy.js";
import { pairRows, seedNodeRows } from "./engine/test-utils.js";
import type { ServiceMapClient } from "./engine/types.js";

/**
 * The public `ServiceMap` outside the observability page: on its own in a
 * card, and as a `ServiceMap` tile of a dashboard tree. Both read from an
 * in-memory demo client (the engine runs in-process with it), so the map
 * builds itself just like against a live server.
 */

const CALLS: [string, string][] = [
  ["web-frontend", "api-gateway"],
  ["api-gateway", "checkout"],
  ["api-gateway", "catalog"],
  ["api-gateway", "user-auth"],
  ["checkout", "cart"],
  ["checkout", "payments"],
  ["checkout", "shipping"],
  ["catalog", "search"],
  ["catalog", "pricing"],
];
const SERVICES = [...new Set(CALLS.flat()), "report-cron"];

/** A client that answers the map's four calls from the CALLS topology. */
function demoClient(): ServiceMapClient & KopaiClient {
  let page = 0;
  const pause = () => new Promise((r) => setTimeout(r, 120));
  const client = {
    async getServices() {
      await pause();
      return { services: SERVICES };
    },
    async queryTracesAggregate(q: kopaiQuery.TraceAggregateQuery) {
      await pause();
      return {
        data: q.filters?.length
          ? []
          : seedNodeRows(Object.fromEntries(SERVICES.map((s) => [s, 100]))),
      };
    },
    async searchTracesPage(f: { sortOrder?: string; serviceName?: string }) {
      await pause();
      if (f.sortOrder === "ASC" || f.serviceName) {
        return { data: [], nextCursor: null };
      }
      const now = Date.now();
      const p = page++;
      return {
        data: CALLS.flatMap(([from, to], i) =>
          pairRows(`p${p}-${i}`, from, to, now - 60_000 - p * 1000 - i)
        ),
        nextCursor: p < 3 ? `page-${p + 1}` : null,
      };
    },
    async getTrace() {
      return [];
    },
  };
  return client as unknown as ServiceMapClient & KopaiClient;
}

function Standalone({ height }: { height: number }) {
  const [client] = useState(demoClient);
  const [clicked, setClicked] = useState<string | null>(null);
  return (
    <div className="max-w-5xl rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-base font-semibold">Service dependencies</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {clicked ? `Clicked: ${clicked}` : "Click a service."}
      </p>
      <ServiceMap client={client} height={height} onServiceClick={setClicked} />
    </div>
  );
}

const meta: Meta<typeof Standalone> = {
  title: "Observability/ServiceMapStandalone",
  component: Standalone,
  parameters: { layout: "padded" },
  args: { height: 420 },
};
export default meta;
type Story = StoryObj<typeof Standalone>;

/** `<ServiceMap client={…} height={420} onServiceClick={…} />` in a card. */
export const InACard: Story = {};

const DASHBOARD_TREE: UITree = {
  root: "stack-1",
  elements: {
    "stack-1": {
      key: "stack-1",
      type: "Stack",
      props: { direction: "vertical", gap: "md", align: null },
      children: ["heading-1", "card-1"],
      parentKey: "",
    },
    "heading-1": {
      key: "heading-1",
      type: "Heading",
      props: { text: "Checkout overview", level: "h2" },
      children: [],
      parentKey: "stack-1",
    },
    "card-1": {
      key: "card-1",
      type: "Card",
      props: {
        title: "Service map",
        description: "Calls between services in the past 60 minutes",
        padding: null,
      },
      children: ["map-1"],
      parentKey: "stack-1",
    },
    "map-1": {
      key: "map-1",
      type: "ServiceMap",
      props: { height: 420 },
      children: [],
      parentKey: "card-1",
    },
  },
};

/** The same map as a `ServiceMap` tile of a dashboard tree (no dataSource). */
export const InADashboard: Story = {
  render: () => <DashboardDemo />,
};

function DashboardDemo() {
  const [client] = useState(demoClient);
  return <DynamicDashboard kopaiClient={client} uiTree={DASHBOARD_TREE} />;
}
