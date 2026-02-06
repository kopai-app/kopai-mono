import type { Preview } from "@storybook/react";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0a0a0a" }],
    },
  },
  decorators: [
    (Story) => {
      document.documentElement.classList.add("dark");
      return Story();
    },
  ],
};

export default preview;
