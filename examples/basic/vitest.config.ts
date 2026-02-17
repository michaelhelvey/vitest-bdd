import vitestBddPlugin from "@michaelhelvey/vitest-bdd";
import { Plugin, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vitestBddPlugin() as Plugin],
});
