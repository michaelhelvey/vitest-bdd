import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["./src/plugin.ts", "./src/runtime.ts"],
    format: "esm",
    dts: true,
    sourcemap: true,
  },
  {
    entry: ["./src/ts-plugin.ts"],
    format: "cjs",
    failOnWarn: false,
    dts: false,
    sourcemap: true,
  },
]);
