import vitestBddPlugin from "@michaelhelvey/vitest-bdd";
import { Plugin, defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [vitestBddPlugin() as Plugin],
});
