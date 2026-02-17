import path from "node:path";
import { defineConfig } from "vitest/config";
import vitestBddPlugin from "./src/plugin.ts";

export default defineConfig({
  plugins: [vitestBddPlugin()],
  resolve: {
    alias: {
      "@michaelhelvey/vitest-bdd/runtime": path.resolve(__dirname, "src/runtime.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    mockReset: true,
    exclude: ["**/examples/**", "**/dist/**", "**/node_modules/**"],
  },
});
