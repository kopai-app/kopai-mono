import type { Meta, StoryObj } from "@storybook/react";
import { ServiceList } from "./index.js";
import { mockServices } from "../__fixtures__/services.js";

const meta: Meta<typeof ServiceList> = {
  title: "Observability/ServiceList",
  component: ServiceList,
};
export default meta;
type Story = StoryObj<typeof ServiceList>;

export const Default: Story = { args: { services: mockServices } };
export const Loading: Story = { args: { services: [], isLoading: true } };
export const Error: Story = {
  args: {
    services: [],
    error: new globalThis.Error("Failed to fetch services"),
  },
};
export const Empty: Story = { args: { services: [] } };
