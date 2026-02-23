import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    entry: {
      "test/server": "examples/clickhouse-observability-backend/server.ts",
    },
    format: ["esm"],
    dts: false,
    clean: false,
    // Bundle all deps into the server for standalone Docker usage
    noExternal: [/.*/],
  },
]);
