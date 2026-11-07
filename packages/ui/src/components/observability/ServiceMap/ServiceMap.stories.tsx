import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { ServiceMapSnapshot } from "./engine/types.js";
import { FIXTURES, discover, type Fixture } from "./layout/fixtures.js";
import { ServiceMapView } from "./components/ServiceMap.js";
import {
  fixtureSnapshot,
  fixtureSnapshots,
  perfFixture,
} from "./test-utils/fixture-snapshot.js";

/**
 * The Service Map at every fixture size. Each story replays the fixture's
 * discovery frames (frame 1 = aggregate seed … frame 5 = scan done, live);
 * move the "frame" control to watch the map grow. Earlier frames are laid
 * out first, so anchoring and Q19 block shifts match a live session.
 */
interface ReplayProps {
  snapshots: readonly ServiceMapSnapshot[];
  frame: number;
}

function Replay({ snapshots, frame }: ReplayProps) {
  const i = Math.max(1, Math.min(snapshots.length, Math.round(frame))) - 1;
  const layoutFrames = useMemo(() => snapshots.slice(0, i), [snapshots, i]);
  return (
    <ServiceMapView
      snapshot={snapshots[i] ?? null}
      layoutFrames={layoutFrames}
      height="calc(100vh - 190px)"
      onRetry={() => {}}
    />
  );
}

const meta: Meta<typeof Replay> = {
  title: "Observability/ServiceMap",
  component: Replay,
  parameters: { layout: "padded" },
  args: { frame: 5 },
  argTypes: {
    frame: { control: { type: "range", min: 1, max: 5, step: 1 } },
    snapshots: { control: false, table: { disable: true } },
  },
};
export default meta;
type Story = StoryObj<typeof Replay>;

const cache = new Map<string, ServiceMapSnapshot[]>();
function frames(
  name: string,
  make: () => Fixture,
  inactive: string[] = []
): ServiceMapSnapshot[] {
  let s = cache.get(name);
  if (!s) {
    s = fixtureSnapshots(make(), { inactive });
    cache.set(name, s);
  }
  return s;
}

/** A fixture story whose snapshots are built only when it renders. */
function fixtureStory(
  name: string,
  make: () => Fixture,
  inactive: string[] = []
): Story {
  return {
    render: (args) => (
      <Replay {...args} snapshots={frames(name, make, inactive)} />
    ),
  };
}

export const Empty: Story = {
  render: (args) => (
    <Replay
      {...args}
      snapshots={[fixtureSnapshot({ nodes: [], edges: [], hub: null })]}
    />
  ),
};

export const OneService: Story = fixtureStory("one", FIXTURES.one);
export const OneServiceWithDbs: Story = fixtureStory(
  "oneWithDbs",
  FIXTURES.oneWithDbs
);
export const TwoUnconnected: Story = fixtureStory(
  "twoUnconnected",
  FIXTURES.twoUnconnected
);
export const Chain15: Story = fixtureStory("chain15", FIXTURES.chain15);
export const Shop20: Story = fixtureStory("shop20", FIXTURES.shop20, [
  "report-cron",
  "recommendations",
]);
export const Star150: Story = fixtureStory("star150", FIXTURES.star150);
export const Generated120: Story = fixtureStory("gen120", FIXTURES.gen120);
export const Generated400: Story = fixtureStory("gen400", FIXTURES.gen400);
export const LongNames: Story = fixtureStory("longNames", FIXTURES.longNames);

/** Scan error on the shop map: the graph is kept and Retry is offered. */
export const ScanError: Story = {
  render: (args) => {
    const shop = frames("shop20", FIXTURES.shop20, [
      "report-cron",
      "recommendations",
    ]);
    const last = shop[2] as ServiceMapSnapshot;
    const snap: ServiceMapSnapshot = {
      ...last,
      scan: { ...last.scan, state: "error" },
      error: "HTTP 503 Service Unavailable",
      diagnostics: {
        ...last.diagnostics,
        lateUnpaired: 312,
        dupes: 18,
        nodeCapHit: true,
      },
    };
    return <Replay {...args} frame={1} snapshots={[snap]} />;
  },
};

let perf: ServiceMapSnapshot[] | null = null;
/**
 * React Flow perf check: about 500 nodes and 900 edges in one frame, with
 * 10 % of the services dimmed. Pan and zoom should stay smooth thanks to
 * `onlyRenderVisibleElements`.
 */
export const Perf500x900: Story = {
  args: { frame: 1 },
  render: (args) => {
    if (!perf) {
      const f = perfFixture(500, 900);
      const last = discover(f).at(-1)!;
      const inactive = f.nodes.filter((_, i) => i % 10 === 7).map((n) => n.id);
      perf = [fixtureSnapshot(last, { inactive })];
    }
    return <Replay {...args} snapshots={perf} />;
  },
};
