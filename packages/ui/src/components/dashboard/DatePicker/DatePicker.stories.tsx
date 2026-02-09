import type { Meta, StoryObj } from "@storybook/react";
import { DatePicker } from "./index.js";

const meta: Meta<typeof DatePicker> = {
  title: "Dashboard/DatePicker",
  component: DatePicker,
};
export default meta;
type Story = StoryObj<typeof DatePicker>;

export const Default: Story = {
  args: {
    element: {
      props: {
        label: "Select Date",
        bindPath: "filters.date",
        placeholder: "Choose a date",
      },
    },
  },
};

export const NoLabel: Story = {
  args: {
    element: {
      props: {
        label: null,
        bindPath: "filters.startDate",
        placeholder: "Start date",
      },
    },
  },
};
