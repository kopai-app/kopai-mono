import type { Meta, StoryObj } from "@storybook/react";
import type { denormalizedSignals } from "@kopai/core";
import { MetricLeaderboard } from "./index.js";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

const mockTopUsersRows: AggregatedMetricRow[] = [
  { groups: { "user.email": "vladimir.adamic@gmail.com" }, value: 970.51 },
  { groups: { "user.email": "alice@example.com" }, value: 124.32 },
  { groups: { "user.email": "bob@example.com" }, value: 89.1 },
  { groups: { "user.email": "carol@example.com" }, value: 45.0 },
  { groups: { "user.email": "dave@example.com" }, value: 12.4 },
];

const mockCostBySkillRows: AggregatedMetricRow[] = [
  { groups: { "skill.name": "" }, value: 967.0 },
  { groups: { "skill.name": "third-party-skill" }, value: 3.0 },
  { groups: { "skill.name": "vercel-react-best-practices" }, value: 0.6 },
];

const meta: Meta<typeof MetricLeaderboard> = {
  title: "Observability/MetricLeaderboard",
  component: MetricLeaderboard,
};
export default meta;
type Story = StoryObj<typeof MetricLeaderboard>;

export const Default: Story = {
  args: { rows: mockTopUsersRows, label: "Top Users by Cost", unit: "USD" },
};

export const WithSkills: Story = {
  args: {
    rows: mockCostBySkillRows,
    label: "Cost by Skill",
    unit: "USD",
  },
};

export const NoBar: Story = {
  args: { rows: mockTopUsersRows, label: "Top Users", showBar: false },
};

export const MaxRows3: Story = {
  args: { rows: mockTopUsersRows, label: "Top 3 Users", maxRows: 3 },
};

export const Loading: Story = {
  args: { rows: [], isLoading: true },
};

export const Error: Story = {
  args: {
    rows: [],
    error: new globalThis.Error("Failed to fetch leaderboard"),
  },
};

export const Empty: Story = { args: { rows: [] } };
