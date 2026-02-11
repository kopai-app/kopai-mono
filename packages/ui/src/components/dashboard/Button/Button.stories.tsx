import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./index.js";

const meta: Meta<typeof Button> = {
  title: "Dashboard/Button",
  component: Button,
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: {
    element: {
      props: {
        label: "Primary",
        variant: "primary",
        size: "md",
        action: "click",
        disabled: null,
      },
    },
  },
};

export const Secondary: Story = {
  args: {
    element: {
      props: {
        label: "Secondary",
        variant: "secondary",
        size: "md",
        action: "click",
        disabled: null,
      },
    },
  },
};

export const Danger: Story = {
  args: {
    element: {
      props: {
        label: "Danger",
        variant: "danger",
        size: "md",
        action: "click",
        disabled: null,
      },
    },
  },
};

export const Ghost: Story = {
  args: {
    element: {
      props: {
        label: "Ghost",
        variant: "ghost",
        size: "md",
        action: "click",
        disabled: null,
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    element: {
      props: {
        label: "Disabled",
        variant: "primary",
        size: "md",
        action: "click",
        disabled: true,
      },
    },
  },
};

export const Small: Story = {
  args: {
    element: {
      props: {
        label: "Small",
        variant: "primary",
        size: "sm",
        action: "click",
        disabled: null,
      },
    },
  },
};

export const Large: Story = {
  args: {
    element: {
      props: {
        label: "Large",
        variant: "primary",
        size: "lg",
        action: "click",
        disabled: null,
      },
    },
  },
};
