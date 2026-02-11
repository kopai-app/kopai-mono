import type { Preview } from "@storybook/react";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
  },
  decorators: [
    (Story) => {
      document.documentElement.classList.add("dark");
      document.body.style.backgroundColor = "hsl(0 0% 3.9%)";
      document.body.style.color = "hsl(0 0% 98%)";
      return Story();
    },
  ],
};

export default preview;
