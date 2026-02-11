import type { Meta, StoryObj } from "@storybook/react";
import { Grid } from "./index.js";

const meta: Meta<typeof Grid> = {
  title: "Dashboard/Grid",
  component: Grid,
};
export default meta;
type Story = StoryObj<typeof Grid>;

const GridItem = ({ label }: { label: string }) => (
  <div
    style={{
      padding: 16,
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "var(--radius)",
    }}
  >
    {label}
  </div>
);

export const TwoColumns: Story = {
  render: () => (
    <Grid element={{ props: { columns: 2, gap: "md" } }}>
      <GridItem label="Item 1" />
      <GridItem label="Item 2" />
      <GridItem label="Item 3" />
      <GridItem label="Item 4" />
    </Grid>
  ),
};

export const ThreeColumns: Story = {
  render: () => (
    <Grid element={{ props: { columns: 3, gap: "md" } }}>
      <GridItem label="Item 1" />
      <GridItem label="Item 2" />
      <GridItem label="Item 3" />
    </Grid>
  ),
};

export const SmallGap: Story = {
  render: () => (
    <Grid element={{ props: { columns: 2, gap: "sm" } }}>
      <GridItem label="Item 1" />
      <GridItem label="Item 2" />
    </Grid>
  ),
};
