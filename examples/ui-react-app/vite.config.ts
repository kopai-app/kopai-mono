import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [viteReact()],
  server: {
    proxy: {
      "/kopai-api": {
        target: "https://demo.kopai.app",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kopai-api/, ""),
      },
    },
  },
});
